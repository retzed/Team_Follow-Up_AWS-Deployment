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
assert.deepEqual(sortContext.sortChildrenByDate(sortFixtures).map(item=>item.id),
  ['created-later-updated-earlier','created-earlier-updated-later'],
  'Last created must sort by creation time descending even when update-time order is the opposite.');
sortContext.ui.childDateMode='created';
assert.deepEqual(sortContext.sortChildrenByDate(sortFixtures).map(item=>item.id),
  ['created-earlier-updated-later','created-later-updated-earlier'],
  'Created must retain its oldest-first ordering.');
sortContext.ui.childDateMode='updated';
assert.deepEqual(sortContext.sortChildrenByDate(sortFixtures).map(item=>item.id),
  ['created-earlier-updated-later','created-later-updated-earlier'],
  'Last updated must continue to sort by update time descending.');

console.log('Child search labels, date sorting, context-aware activity summaries, and Arabic activity localization tests passed.');
