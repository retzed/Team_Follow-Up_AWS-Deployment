import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html = await readFile('index.html', 'utf8');
assert.match(html, /const bulkMatch=action\.match\(\/\^\(Deleted\|Restored\) \(project\|job\|task\|follow-\?up\)/, 'Activity text should recognize bulk deletion/restoration for all item types.');
assert.match(html, /const arType=\{project:'المشروع',job:'العمل المؤقت',task:'المهمة',followup:'المتابعة'\}/, 'Context-aware activity summaries need Arabic item-type labels.');
assert.match(html, /Moved\|Archived/, 'Archive-related activity verbs should have localized output.');
assert.match(html, /childSearchExpanded:false/, 'Child search must start collapsed on mobile.');
assert.match(html, /data-action="toggle-child-search"[^>]+aria-expanded="\$\{ui\.childSearchExpanded\?/, 'Child search disclosure button must reflect expanded state.');
for (const id of ['childQuery','childTypeFilter','childStatusFilter','childPriorityFilter','childSortFilter','childDateFrom','childDateTo']) {
  const at = html.indexOf(`id="${id}"`, html.indexOf('function renderOverview'));
  assert.ok(at >= 0, `Missing child search control ${id}`);
  const before = html.slice(Math.max(0, at - 300), at);
  assert.match(before, /<label[^>]+for="/ , `Missing compact label above ${id}`);
}
assert.match(html, /\.child-toolbar\{display:none;grid-template-columns/, 'Child search controls should be hidden by default on mobile.');
assert.match(html, /\.child-toolbar\.expanded\{display:grid\}/, 'Expanded mobile child search controls should be visible.');
assert.match(html, /class="searchbox child-search-box"/, 'Child-search textbox must use a dedicated class rather than conflicting with its mobile wrapper rules.');
assert.match(html, /\.child-search-field \.child-search-box\{[^}]*height:41px;min-height:41px;flex:0 0 41px/, 'Child-search textbox must retain a full 41px hit area and must not shrink inside its filter grid.');
assert.match(html, /\.child-search-field \.child-search-box input\{[^}]*height:100%;min-height:0/, 'Child-search input must fill its visual textbox container.');
assert.doesNotMatch(html, /class="searchbox child-search"/, 'The old conflicting child-search class must not remain on the textbox.');

assert.match(html, /case 'toggle-child-search':ui\.childSearchExpanded=!ui\.childSearchExpanded;renderDetail\(\);break;/, 'Disclosure button must toggle the search UI.');
const start = html.indexOf('function activityText(entry,contextItemId=');
const end = html.indexOf('\nfunction statusName', start);
assert.ok(start >= 0 && end > start, 'Could not isolate activityText for localization test.');
const context = { ui: { lang: 'ar' }, t: { ar: { project: 'مشروع', job: 'عمل مؤقت', task: 'مهمة', followup: 'متابعة', completed: 'مكتملة', notStarted: 'لم تبدأ', inProgress: 'قيد التنفيذ', onHold: 'معلقة' } }, localizedUserNames: { u3: 'نادين' } };
vm.runInNewContext(html.slice(start, end) + ';this.activityText=activityText;', context);
assert.equal(context.activityText({ action: 'Restored followup: API contract review' }), 'تمت استعادة المتابعة: API contract review.');
assert.equal(context.activityText({ action: 'Restored task: Define indexes' }), 'تمت استعادة المهمة: Define indexes.');
assert.equal(context.activityText({ action: 'Restored project: AWS MVP' }), 'تمت استعادة المشروع: AWS MVP.');
assert.equal(context.activityText({ action: 'Deleted followup: API contract review' }), 'تم حذف متابعة: API contract review');
assert.equal(context.activityText({ id:'delete-root-en',itemId:'p1',action:'Updated details for project: 05 · AWS Lambda Application API.' },'p1'), 'تم تحديث تفاصيل المشروع');
context.ui.lang='en';
assert.equal(context.activityText({ id:'update-root-en',itemId:'p1',action:'Updated details for project: 05 · AWS Lambda Application API.' },'p1'), 'Updated details for the project');
assert.equal(context.activityText({ id:'update-task',itemId:'t1',action:'Updated details for task: Define indexes.' },'t1'), 'Updated details for the task');
assert.equal(context.activityText({ id:'update-child',itemId:'t1',action:'Updated details for task: Define indexes.' },'p1'), 'Updated details for task: Define indexes.', 'A child event keeps its item context when shown under the selected project.');
context.ui.lang='ar';
assert.equal(context.activityText({ id:'update-root-job',itemId:'j1',action:'Updated details for job: Weekly Operations.' },'j1'), 'تم تحديث تفاصيل العمل المؤقت');

const sortModeStart=html.indexOf('function childDateSortMode(');
const sortModeEnd=html.indexOf('function childCard(',sortModeStart);
const compareStart=html.indexOf('function compareByDateMode(');
const compareEnd=html.indexOf('function parentDateForMode(',compareStart);
assert.ok(sortModeStart>=0&&sortModeEnd>sortModeStart,'Child date sorting helpers must exist.');
assert.ok(compareStart>=0&&compareEnd>compareStart,'The shared date comparator must exist.');
assert.match(html,/const order=\(a,b\)=>compareByDateMode\(a\.item,b\.item,childDateSortMode\(\)\)/,
  'The top-level child-item results must use the selected child sort mode.');
assert.match(html,/const kids= item\.type==='task' \? sortChildrenByDate\(filteredNested\?\?childrenOf\(item\.id\)\) : \[\];/,
  'Nested follow-ups must use the same selected child sort mode whether or not other filters are active.');
const sortContext={ui:{childDateMode:'last-created'},activityTimestamp:(item,mode)=>Date.parse(mode==='updated'?item.updatedAt:item.createdAt)};
vm.runInNewContext(
  html.slice(compareStart,compareEnd)+'\n'+html.slice(sortModeStart,sortModeEnd)+
  '\nthis.childDateSortMode=childDateSortMode;this.sortChildrenByDate=sortChildrenByDate;',
  sortContext
);
const sortFixtures=[
  {id:'created-earlier-updated-later',createdAt:'2026-10-01T08:00:00Z',updatedAt:'2026-10-05T08:00:00Z'},
  {id:'created-later-updated-earlier',createdAt:'2026-10-04T08:00:00Z',updatedAt:'2026-10-02T08:00:00Z'}
];
assert.deepEqual(Array.from(sortContext.sortChildrenByDate(sortFixtures),item=>item.id),
  ['created-later-updated-earlier','created-earlier-updated-later'],
  'Last created must sort by creation time descending even when update-time order is the opposite.');
sortContext.ui.childDateMode='created';
assert.deepEqual(Array.from(sortContext.sortChildrenByDate(sortFixtures),item=>item.id),
  ['created-earlier-updated-later','created-later-updated-earlier'],
  'Created must retain its oldest-first ordering.');
sortContext.ui.childDateMode='updated';
assert.deepEqual(Array.from(sortContext.sortChildrenByDate(sortFixtures),item=>item.id),
  ['created-earlier-updated-later','created-later-updated-earlier'],
  'Last updated must continue to sort by update time descending.');


const timestampStart=html.indexOf('function activityTimestamp(');
const timestampEnd=html.indexOf('function parentDate(',timestampStart);
assert.ok(timestampStart>=0&&timestampEnd>timestampStart,'The indexed activity timestamp helper must exist.');
let rootLookupCount=0;
const slowRootEvent={};
Object.defineProperty(slowRootEvent,'itemId',{get(){throw new Error('Child sorting scanned the entire Project/Job activity timeline.');}});
const timestampContext={
 ensureActivityIndex:()=>({
  byRoot:new Map([['p1',[slowRootEvent]]]),
  byId:new Map([['t1',[{id:'t1-created',itemId:'t1',at:'2026-10-05T08:00:00Z'}]]])
 }),
 rootParent:()=>{rootLookupCount++;throw new Error('A child sort should not resolve its root parent.');}
};
vm.runInNewContext(html.slice(timestampStart,timestampEnd)+'\nthis.activityTimestamp=activityTimestamp;',timestampContext);
const indexedChildTime=timestampContext.activityTimestamp(
 {id:'t1',type:'task',rootParentId:'p1',createdAt:'2026-10-01T08:00:00Z',updatedAt:'2026-10-02T08:00:00Z'},
 'updated','project'
);
assert.equal(indexedChildTime,Date.parse('2026-10-05T08:00:00Z'),
  'A child timestamp uses the latest event indexed for that child.');
assert.equal(rootLookupCount,0,
  'Sorting child items must not repeatedly walk top-level parents to resolve their root.');


const childMatchStart=html.indexOf('function childMatches(child){');
const childMatchEnd=html.indexOf('// The Not Completed metric',childMatchStart);
const childTreeStart=html.indexOf('function childTreeFiltered(parent){');
const childTreeEnd=html.indexOf('function renderChildList(parent)',childTreeStart);
assert.ok(childMatchStart>=0&&childMatchEnd>childMatchStart,'The item search predicates must exist.');
assert.ok(childTreeStart>=0&&childTreeEnd>childTreeStart,'The nested item-tree filter must exist.');
const filterFixture={
 ui:{childQuery:'',childType:'all',childStatus:'in-progress',childPriority:'all',childDateMode:'due',childDateFrom:'2026-11-01',childDateTo:'2026-11-30',childScope:'all'},
 matchesItemStatusFilter:(item,filter)=>filter==='all'||(item.type!=='followup'&&item.status===filter)||(filter==='not-completed'&&item.type!=='followup'&&item.status!=='completed'),
 matchesDate:(item,mode,from,to)=>{
  const value=String(mode==='due'?(item.dueDate||''):(item[mode==='created'?'createdAt':'updatedAt']||'')).slice(0,10);
  if(mode==='due'&&!value)return false;
  return !!value&&(!from||value>=from)&&(!to||value<=to);
 },
 childrenOf:id=>filterFixture.children.get(String(id))||[],
 compareByDateMode:(a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')),
 childDateSortMode:()=>filterFixture.ui.childDateMode,
 children:new Map()
};
const filterContext=filterFixture;
const tasks=[
 {id:'t-pass',type:'task',parentId:'p1',status:'in-progress',priority:'high',dueDate:'2026-11-20',createdAt:'2026-11-02',updatedAt:'2026-11-12',name:'Eligible task'},
 {id:'t-status-fail',type:'task',parentId:'p1',status:'completed',priority:'high',dueDate:'2026-11-20',createdAt:'2026-11-02',updatedAt:'2026-11-12',name:'Completed task'},
 {id:'t-due-fail',type:'task',parentId:'p1',status:'in-progress',priority:'high',dueDate:'2026-12-01',createdAt:'2026-11-02',updatedAt:'2026-11-12',name:'Task outside due range'}
];
const followups=[
 {id:'f-pass',type:'followup',parentId:'t-pass',priority:'high',createdAt:'2026-11-03',updatedAt:'2026-11-12',name:'Needle follow-up'},
 {id:'f-low-priority',type:'followup',parentId:'t-pass',priority:'low',createdAt:'2026-11-03',updatedAt:'2026-11-12',name:'Other follow-up'},
 {id:'f-status-parent-fail',type:'followup',parentId:'t-status-fail',priority:'high',createdAt:'2026-11-03',updatedAt:'2026-11-12',name:'Needle under completed task'},
 {id:'f-date-parent-fail',type:'followup',parentId:'t-due-fail',priority:'high',createdAt:'2026-11-03',updatedAt:'2026-11-12',name:'Needle under out-of-range task'}
];
filterFixture.children.set('p1',tasks);
filterFixture.children.set('t-pass',followups.filter(x=>x.parentId==='t-pass'));
filterFixture.children.set('t-status-fail',followups.filter(x=>x.parentId==='t-status-fail'));
filterFixture.children.set('t-due-fail',followups.filter(x=>x.parentId==='t-due-fail'));
vm.runInNewContext(
 html.slice(childMatchStart,childMatchEnd)+'\n'+
 html.slice(childTreeStart,childTreeEnd)+
 '\nthis.childTreeFiltered=childTreeFiltered;',
 filterContext
);
const filteredTaskRows=filterContext.childTreeFiltered({id:'p1'});
assert.deepEqual(Array.from(filteredTaskRows,item=>item.item.id),['t-pass'],
 'Status and Due date filters must still apply to the Task itself, not be bypassed by its nested Follow-ups.');
assert.deepEqual(Array.from(filteredTaskRows[0].nested,item=>item.id),['f-pass','f-low-priority'],
 'A Task that passes Status/Due date filters must retain its nested Follow-ups even though those Follow-ups have no Status or Due date.');

filterFixture.ui.childQuery='needle';
const queryRows=filterContext.childTreeFiltered({id:'p1'});
assert.deepEqual(Array.from(queryRows,item=>item.item.id),['t-pass'],
 'A matching Follow-up must not cause a Task that fails its own Status or Due date filter to appear.');
assert.deepEqual(Array.from(queryRows[0].nested,item=>item.id),['f-pass'],
 'Text search must continue to narrow nested Follow-ups independently of Task-only workflow filters.');

filterFixture.ui.childQuery='';
filterFixture.ui.childPriority='high';
const priorityRows=filterContext.childTreeFiltered({id:'p1'});
assert.deepEqual(Array.from(priorityRows[0].nested,item=>item.id),['f-pass'],
 'Priority remains applicable to nested Follow-ups.');

filterFixture.ui.childPriority='all';
filterFixture.ui.childDateMode='updated';
filterFixture.ui.childDateFrom='2026-11-10';
filterFixture.ui.childDateTo='2026-11-13';
const updatedRows=filterContext.childTreeFiltered({id:'p1'});
assert.deepEqual(Array.from(updatedRows[0].nested,item=>item.id),['f-pass','f-low-priority'],
 'Last updated date ranges remain applicable to nested Follow-ups; only the unsupported Due date filter is ignored.');

filterFixture.ui.childDateMode='created';
filterFixture.ui.childDateFrom='2026-11-01';
filterFixture.ui.childDateTo='2026-11-02';
const createdRows=filterContext.childTreeFiltered({id:'p1'});
assert.deepEqual(Array.from(createdRows[0].nested,item=>item.id),[],
 'Created date filters continue to apply to nested Follow-ups.');

console.log('Child search labels, date sorting, context-aware activity summaries, and Arabic activity localization tests passed.');
