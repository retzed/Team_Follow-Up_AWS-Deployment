import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const projectHistory = html.slice(html.indexOf("} else if(m.kind==='history'){"), html.indexOf("} else if(m.kind==='global-history'){"));
const appHistory = html.slice(html.indexOf("} else if(m.kind==='global-history'){"), html.indexOf("} else if(m.kind==='archive'){", html.indexOf("} else if(m.kind==='global-history'){")));
assert.ok(projectHistory.includes("<th>${esc(tr('time'))}</th><th>${esc(tr('date'))}</th><th>${esc(tr('user'))}</th><th>${esc(tr('itemColumn'))}</th><th>${esc(tr('action'))}</th>"));
assert.ok(appHistory.includes("<th>${esc(tr('time'))}</th><th>${esc(tr('date'))}</th><th>${esc(tr('user'))}</th><th>${esc(tr('parentItem'))}</th><th>${esc(tr('childItem'))}</th><th>${esc(tr('action'))}</th>"));

const relatedTreeStart = html.indexOf('function treeActivity(parent){');
const relatedTreeEnd = html.indexOf('function timelineEvents(', relatedTreeStart);
assert.ok(relatedTreeStart >= 0 && relatedTreeEnd > relatedTreeStart, 'The related-item hierarchy renderer must exist.');
const relatedTree = html.slice(relatedTreeStart, relatedTreeEnd);
assert.ok(relatedTree.includes('childrenOf(parent.id).sort(newestCreatedFirst)') &&
          relatedTree.includes('childrenOf(item.id).sort(newestCreatedFirst)'),
  'Related items and nested follow-ups are sorted newest-created first at every hierarchy level.');

assert.equal((projectHistory.match(/id="historyQuery"/g)||[]).length, 1, 'Project history renders one shared search box.');
assert.equal((appHistory.match(/id="historyQuery"/g)||[]).length, 1, 'Application history renders one shared search box.');
assert.doesNotMatch(html, /historyItemQuery/, 'No second item-only search box exists.');
assert.match(projectHistory, /historyActionLabel\(e\)/, 'Project history renders action-only labels.');
assert.match(appHistory, /historyActionLabel\(e\)/, 'Application history renders action-only labels.');
assert.match(appHistory, /subject\.isParent\?'<span class="history-dash">—<\/span>':historySubjectMarkup/, 'Parent-level application events use the wide dash for Child Item.');

// Test the actual shared helper functions with a small deterministic workspace.
const helperStart = html.indexOf('function historySubjectMarkup(name,type){');
const helperEnd = html.indexOf('\nfunction renderModal(preserveExisting=true)', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Could not isolate history helpers.');
const itemMap = new Map([
  ['p1',{id:'p1',type:'project',name:'Platform Refresh',rootParentId:'p1'}],
  ['t1',{id:'t1',type:'task',name:'Define API Contract',parentId:'p1',rootParentId:'p1'}],
  ['f1',{id:'f1',type:'followup',name:'Review API Contract',parentId:'t1',rootParentId:'p1'}]
]);
const users = [{id:'u1',name:'Ava Singh',role:'AWS Engineer'}];
const context = {
  ui:{lang:'en'},
  historySearchCache:new Map(),
  data:{users},
  allItem:id=>itemMap.get(String(id))||null,
  rootParent:item=>item?.type==='project'||item?.type==='job'?item:(itemMap.get(String(item?.rootParentId||''))||null),
  ensureActivityRootSnapshotIndex:()=>new Map([['p1',{name:'Platform Refresh',type:'project'}]]),
  person:id=>users.find(u=>u.id===id)||{id:'unknown',name:'Unknown user',role:'Team member'},
  tr:key=>({project:'Project',job:'Job',task:'Task',followup:'Follow-up',actionCreated:'Created',actionDeleted:'Deleted',actionRestored:'Restored',actionArchived:'Archived',actionUpdated:'Updated',name:'name',description:'description',statusLabel:'status',assignedTo:'assignee',dueDate:'due date',priorityLabel:'priority',type:'type'}[key]||key),
  typeName:type=>({project:'Project',job:'Job',task:'Task',followup:'Follow-up'}[type]||String(type||'')),
  esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  activityText:event=>String(event.action||event.summary||''),
  dateKey:value=>String(value||'').slice(0,10),
  fmtDate:(value,options={})=>options.month==='long'?'14 October 2026':options.month==='short'?'14 Oct 2026':'14 Oct 2026',
  fmtTime:()=> '10:00',
  fmtDateTime:()=> '14 Oct 2026 · 10:00',
};
vm.runInNewContext(html.slice(helperStart,helperEnd)+';this.historySubjectData=historySubjectData;this.historyActionLabel=historyActionLabel;this.historyQueryMatches=historyQueryMatches;this.historySubjectMarkup=historySubjectMarkup;this.stableNewestFirst=stableNewestFirst;this.newestCreatedFirst=newestCreatedFirst;',context);

const creationOrder = [
  {id:'older',createdAt:'2026-10-12T12:00:00.000Z'},
  {id:'newer',createdAt:'2026-10-15T12:00:00.000Z'},
  {id:'middle',createdAt:'2026-10-14T12:00:00.000Z'}
].sort(context.newestCreatedFirst).map(item=>item.id);
assert.deepEqual(creationOrder,['newer','middle','older'],
  'The related-item comparator orders creation timestamps newest to oldest.');
const projectEvent={id:'e1',itemId:'p1',itemName:'Platform Refresh',itemType:'project',rootParentId:'p1',rootParentName:'Platform Refresh',rootParentType:'project',userId:'u1',action:'Updated description for project: Platform Refresh.',kind:'update',at:'2026-10-14T10:00:00.000Z'};
const childEvent={id:'e2',itemId:'t1',itemName:'Define API Contract',itemType:'task',rootParentId:'p1',rootParentName:'Platform Refresh',rootParentType:'project',parentId:'p1',userId:'u1',action:'Created task: Define API Contract',kind:'create',at:'2026-10-14T10:00:00.000Z'};
const parentSubject=context.historySubjectData(projectEvent);
assert.equal(parentSubject.isParent,true);
assert.equal(parentSubject.childName,'');
assert.equal(parentSubject.parentName,'Platform Refresh');
const childSubject=context.historySubjectData(childEvent);
assert.equal(childSubject.isParent,false);
assert.equal(childSubject.parentName,'Platform Refresh');
assert.equal(childSubject.childName,'Define API Contract');
assert.match(context.historySubjectMarkup(childSubject.childName,childSubject.childType),/Define API Contract[\s\S]*Task/,'Item type is rendered beside item name.');
assert.equal(context.historyActionLabel(childEvent),'Created','Action column displays the action, not a duplicated item name.');
assert.ok(context.historyQueryMatches(childEvent,'2026-10-14 Ava Contract Created',true),'Application search spans date, user, item and action in one query.');
assert.ok(!context.historyQueryMatches(childEvent,'Platform MissingTerm',true),'Every token must match the displayed row fields.');
assert.equal(context.historyActionLabel({...childEvent,action:'Restored task: Define API Contract',kind:'restore',affectedDescendantCount:2}),'Restored · 2 child items');

// Recent activity for the selected parent should use concise localized wording for its own events.
const activityTextStart=html.indexOf('function activityText(entry,contextItemId=');
const activityTextEnd=html.indexOf('\nfunction logActivity(',activityTextStart);
assert.ok(activityTextStart>=0&&activityTextEnd>activityTextStart,'Could not isolate the Recent activity formatter.');
const activityTextContext={ui:{lang:'en'},t:{ar:{completed:'مكتملة'}},localizedUserNames:{u3:'لينا فوزي'}};
vm.runInNewContext(html.slice(activityTextStart,activityTextEnd)+';this.activityText=activityText;',activityTextContext);
const restoredParent={id:'evt-restore-p1',itemId:'p1',itemName:'01 · Architecture & AWS Foundation',itemType:'project',action:'Restored project: 01 · Architecture & AWS Foundation',actionAr:'تمت استعادة المشروع: 01 · Architecture & AWS Foundation',kind:'restore',affectedDescendantCount:8};
assert.equal(activityTextContext.activityText(restoredParent,'p1'),'Restored the project (and 8 child items)','Recent activity should omit the selected project name when the project itself was restored.');
assert.match(activityTextContext.activityText(restoredParent,'p2'),/01 · Architecture & AWS Foundation/,'Other history contexts must retain the full item name.');
activityTextContext.ui.lang='ar';
assert.equal(activityTextContext.activityText(restoredParent,'p1'),'تمت استعادة المشروع (مع 8 من العناصر الفرعية)','Arabic Recent activity should also omit the selected project name and retain the child count.');
activityTextContext.ui.lang='en';
assert.equal(activityTextContext.activityText({...restoredParent,action:'Updated details for project: 01 · Architecture & AWS Foundation'},'p1'),'Updated details for the project');
const sameTimeA={id:'evt-a',at:'2026-10-14T10:00:00.000Z'};
const sameTimeB={id:'evt-b',at:'2026-10-14T10:00:00.000Z'};
assert.ok(context.stableNewestFirst(sameTimeB,sameTimeA)<0,'Equal-time history records have deterministic ID ordering.');

const compareStart=html.indexOf("function compareByDateMode(a,b,mode,source='application'){");
const compareEnd=html.indexOf('\nfunction parentDateForMode(',compareStart);
const childSortStart=html.indexOf('function sortChildrenByDate(items){');
const childSortModeStart=html.indexOf('function childDateSortMode(mode=ui.childDateMode){');
const childSortEnd=html.indexOf('\nfunction childCard(',childSortStart);
assert.ok(compareStart>=0&&compareEnd>compareStart&&childSortModeStart>=0&&childSortStart>=childSortModeStart&&childSortEnd>childSortStart,'Could not isolate the list sort helpers and their child-mode mapper.');
const sortContext={activityTimestamp:(item,mode)=>Date.parse(mode==='updated'?(item.latestActivityAt||item.updatedAt):(item.createdAt))||0,ui:{childDateMode:'updated'}};
vm.runInNewContext(html.slice(compareStart,compareEnd)+';this.compareByDateMode=compareByDateMode;'+html.slice(childSortModeStart,childSortEnd)+';this.childDateSortMode=childDateSortMode;this.sortChildrenByDate=sortChildrenByDate;',sortContext);
const freshRestored={id:'restored-task',updatedAt:'2026-10-01T10:00:00.000Z',latestActivityAt:'2026-10-14T10:00:00.000Z',createdAt:'2026-10-01T10:00:00.000Z'};
const oldItem={id:'old-task',updatedAt:'2026-10-13T10:00:00.000Z',createdAt:'2026-10-01T09:00:00.000Z'};
assert.ok(sortContext.compareByDateMode(freshRestored,oldItem,'updated')<0,'An item with newer canonical activity sorts ahead even if its stored updatedAt is stale.');
assert.deepEqual(Array.from(sortContext.sortChildrenByDate([oldItem,freshRestored]),x=>x.id),['restored-task','old-task'],'Child ordering reflects fresh restoration timestamps.');


const dateModeHelperStart=html.indexOf('function dateModeOptions(){');
const dateModeHelperEnd=html.indexOf('\nfunction applyTheme(',dateModeHelperStart);
assert.ok(dateModeHelperStart>=0&&dateModeHelperEnd>dateModeHelperStart,'The shared Date-list options helper must exist.');
const dateModeHelperSource=html.slice(dateModeHelperStart,dateModeHelperEnd);
const dateModeContext={tr:key=>key,esc:value=>String(value??'')};
vm.runInNewContext(dateModeHelperSource+';this.dateModeOptions=dateModeOptions;this.dateModeOptionsMarkup=dateModeOptionsMarkup;',dateModeContext);
assert.deepEqual(Array.from(dateModeContext.dateModeOptions(),option=>option[0]),['updated','last-created','created','due'],'Due date must be appended after the existing Updated/Created modes.');
const dueModeOptionMarkup=dateModeContext.dateModeOptionsMarkup('due');
assert.ok(dueModeOptionMarkup.lastIndexOf('value="due"')>dueModeOptionMarkup.lastIndexOf('value="created"')&&dueModeOptionMarkup.includes('selected'),'The Due date option must render last and remain selected when active.');
assert.ok(html.includes("setSelectOptions($('#parentSortFilter'),dateModeOptions(),ui.parentDateMode)")&&html.includes("dateModeOptionsMarkup(ui.childDateMode,!isJob&&ui.childType!=='followup')")&&html.includes("dateModeOptionsMarkup(ui.accountAssignedDateMode,ui.accountAssignedType!=='followup')")&&html.includes('dateModeOptionsMarkup(ui.accountSearchDateMode)'),'Workspace parent, workspace child, Profile Assigned Items, and Profile Search Date lists must share the same choices; Job Overview disables the otherwise shared Due date option.');
const dueDateStart=html.indexOf('function dueDateKey(item){');
const dueDateEnd=html.indexOf('\nfunction parentDate(item){',dueDateStart);
const dueCompareStart=html.indexOf("function compareByDateMode(a,b,mode,source='application'){");
const dueCompareEnd=html.indexOf('\nfunction parentDateForMode(',dueCompareStart);
const dueMatchesDateStart=html.indexOf('function matchesDate(item,mode,from,to,source=',dueCompareEnd);
const dueMatchesDateEnd=html.indexOf('function matchesStatusFilter(',dueMatchesDateStart);
const dueChildSortModeStart=html.indexOf('function childDateSortMode(mode=ui.childDateMode){');
const dueChildSortStart=html.indexOf('function sortChildrenByDate(items){',dueChildSortModeStart);
const dueChildSortEnd=html.indexOf('\nfunction childCard(',dueChildSortStart);
assert.ok(dueDateStart>=0&&dueDateEnd>dueDateStart&&dueCompareStart>=0&&dueCompareEnd>dueCompareStart&&dueMatchesDateStart>=0&&dueMatchesDateEnd>dueMatchesDateStart&&dueChildSortModeStart>=0&&dueChildSortEnd>dueChildSortStart,'Could not isolate Due date parsing, filtering, and ordering helpers.');
const dueSortContext={activityTimestamp:(item,mode)=>Date.parse(mode==='updated'?(item.latestActivityAt||item.updatedAt):(item.createdAt))||0,dateKey:value=>String(value||'').slice(0,10),ui:{childDateMode:'due'}};
vm.runInNewContext(html.slice(dueDateStart,dueDateEnd)+html.slice(dueCompareStart,dueCompareEnd)+html.slice(dueMatchesDateStart,dueMatchesDateEnd)+';this.compareByDateMode=compareByDateMode;this.matchesDate=matchesDate;'+html.slice(dueChildSortModeStart,dueChildSortEnd)+';this.childDateSortMode=childDateSortMode;this.sortChildrenByDate=sortChildrenByDate;',dueSortContext);
const dueItems=[{id:'later',dueDate:'2026-12-01'},{id:'no-due'},{id:'nearest',dueDate:'2026-11-10'},{id:'middle',dueDate:'2026-11-20'}];
assert.deepEqual(Array.from(dueItems.slice().sort((a,b)=>dueSortContext.compareByDateMode(a,b,'due')),item=>item.id),['nearest','middle','later','no-due'],'Due date sorting must place the nearest due date first and undated items last.');
assert.deepEqual(Array.from(dueItems.filter(item=>dueSortContext.matchesDate(item,'due','2026-11-01','2026-11-30')),item=>item.id),['nearest','middle'],'Due date range filtering must include only items whose due dates fall within the selected range.');
assert.equal(dueSortContext.matchesDate({id:'no-due'},'due','',''),false,'Items without a due date must be excluded when Due date mode is selected.');
assert.deepEqual(Array.from(dueSortContext.sortChildrenByDate(dueItems),item=>item.id),['nearest','middle','later','no-due'],'Child lists must use nearest-due-date-first ordering when Due date mode is selected.');
const dueTreeStart=html.indexOf('function childTreeFiltered(parent){');
const dueTreeEnd=html.indexOf('\nfunction renderChildList(',dueTreeStart);
assert.ok(dueTreeStart>=0&&dueTreeEnd>dueTreeStart&&html.slice(dueTreeStart,dueTreeEnd).includes("ui.childDateMode==='due'"),'Due date mode must activate child filtering so nested follow-ups without due dates cannot leak into the results.');
assert.ok(html.includes("if(ui.parentDateMode==='due'){sidebarQuerySequence++;return;}"),'The workspace must keep due-date sorting local and invalidate stale Updated/Created API query responses.');

const css = html.slice(html.indexOf('<style id="history-layout-revision">'), html.indexOf('</style>', html.indexOf('<style id="history-layout-revision">')));
assert.ok(css.includes('.application-history-table{min-width:1080px!important}'));
assert.ok(html.includes('.application-history-table{width:100%!important;min-width:1120px!important;table-layout:fixed!important}'),'The final app-wide history sizing reserves room for wider Parent and Child columns.');
assert.ok(css.includes('.project-history-table col:nth-child(3){width:17%}'));
assert.ok(css.includes('.project-history-table col:nth-child(4){width:35%}')&&css.includes('.project-history-table col:nth-child(5){width:26%}'),'Per-item history allocates 35% to Item and 26% to Actions.');
assert.ok(projectHistory.includes('<colgroup><col style="width:9%"><col style="width:13%"><col style="width:17%"><col style="width:35%"><col style="width:26%"></colgroup>'),'Per-item history inline column widths match the Item 35% / Actions 26% layout so inline styles cannot override the intended widths.');
assert.ok(css.includes('overflow:auto;overscroll-behavior:contain'), 'History grid scrolls inside its wrapper instead of clipping later entries.');
assert.ok(css.includes('border-inline-end:1px solid var(--border)'), 'History columns have visible separators instead of appearing to overlap.');
assert.ok(html.includes('.history-event-datetime > span { display: flex; flex-direction: column; gap: 2px;'), 'Mobile history cards separate Time and Date labels from their values.');
const targetedCssStart=html.indexOf('<style id="targeted-history-and-child-search-polish">');
const targetedCssEnd=html.indexOf('</style>',targetedCssStart);
assert.ok(targetedCssStart>=0&&targetedCssEnd>targetedCssStart,'Targeted layout overrides are present.');
const targetedCss=html.slice(targetedCssStart,targetedCssEnd);
assert.ok(targetedCss.includes('.application-history-table col:nth-child(4){width:28%!important}')&&targetedCss.includes('.application-history-table col:nth-child(5){width:28%!important}')&&targetedCss.includes('.application-history-table col:nth-child(6){width:auto!important}'),'Parent and Child columns each receive 28%; Action takes only the remaining 14%.');
assert.ok(targetedCss.includes('grid-template-areas:"query users count"')&&targetedCss.includes('grid-template-areas:"query count" "users users"!important'),'History controls explicitly place the user filter and keep the event count beside search on mobile.');
assert.ok(html.includes('id="historyUserFilter"')&&html.includes("historyUserFilter:'all'")&&html.includes("allUsers:'All users'"),'Application history has a user dropdown defaulting to All users.');
assert.ok(projectHistory.includes("tr('searchParentHistory')")&&appHistory.includes("tr('searchApplicationHistory')"),'Each history popup names the searchable fields for its own scope.');
assert.ok(projectHistory.includes('class="history-search-hint"')&&projectHistory.includes("tr('searchParentHistory')")&&appHistory.includes('class="history-search-hint"')&&appHistory.includes("tr('searchApplicationHistory')"),'Each history popup exposes a wrapped field hint on narrow screens so long placeholders are not the only cue.');
assert.ok(html.includes("searchParentHistory:'Search date/time, user/role, item name/type, or action…'")&&html.includes("searchApplicationHistory:'Search date/time, user/role, project/job, parent/child item name/type, or action…'"),'English history search hints enumerate searchable fields.');
assert.ok(html.includes("searchParentHistory:'ابحث بالتاريخ/الوقت أو المستخدم/المسمى الوظيفي أو اسم/نوع العنصر أو الإجراء…'")&&html.includes("searchApplicationHistory:'ابحث بالتاريخ/الوقت أو المستخدم/المسمى الوظيفي أو المشروع/العمل المؤقت أو اسم/نوع العنصر الرئيسي/الفرعي أو الإجراء…'"),'Arabic history search hints enumerate searchable fields.');
assert.match(html,/class="[^"]*child-search-field[^"]*"[^>]*>[\s\S]*?id="childQuery"[^>]*>[\s\S]*?class="(?=[^"]*\bsubtle-btn\b)(?=[^"]*\bchild-clear-button\b)(?=[^"]*\bchild-mobile-clear-button\b)[^"]*"/,'The mobile Clear action is nested beside the child search input and retains its required behavior classes.');
assert.match(html,/id="childDateFrom"[^>]*>[\s\S]*?id="childDateTo"/,'Child-item From and To date inputs are both present in the search toolbar.');
const mobileClearCssStart=html.indexOf('<style id="production-mobile-clear-and-history-search-hints">');
const mobileClearCssEnd=html.indexOf('</style>',mobileClearCssStart);
assert.ok(mobileClearCssStart>=0&&mobileClearCssEnd>mobileClearCssStart,'Mobile Clear layout override is present.');
const mobileClearCss=html.slice(mobileClearCssStart,mobileClearCssEnd);
assert.ok(mobileClearCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;'),'Mobile filter rows retain two shrinkable columns.');
assert.ok(mobileClearCss.includes('.child-toolbar .child-filter-actions { display: none !important; }'),'The desktop Clear action row is hidden on mobile to avoid a duplicate row.');
assert.ok(mobileClearCss.includes('.history-search-hint { display: none !important; }'),'Redundant search-filter hint labels are hidden on mobile history popups.');
const mobileSizingCssStart=html.indexOf('<style id="mobile-date-input-overflow-fix-v3">');
const mobileSizingCssEnd=html.indexOf('</style>',mobileSizingCssStart);
assert.ok(mobileSizingCssStart>=0&&mobileSizingCssEnd>mobileSizingCssStart,'Final mobile date-control sizing overrides are present.');
const mobileSizingCss=html.slice(mobileSizingCssStart,mobileSizingCssEnd);
assert.ok(mobileSizingCss.includes('#mainContent .child-toolbar.expanded > .child-search-field > .child-mobile-clear-button')&&mobileSizingCss.includes('grid-column: 2 !important;'),'The mobile Clear action sits in the second column beside the child search input.');
assert.ok(mobileSizingCss.includes('#mainContent .child-toolbar .child-date-row #childDateFrom')&&mobileSizingCss.includes('#mainContent .child-toolbar .child-date-row #childDateTo')&&mobileSizingCss.includes('max-inline-size: 100% !important;'),'Both child date inputs are constrained to their shrinkable grid columns.');
assert.ok(html.includes("if(ev.target.id==='historyUserFilter'&&ui.modal?.kind==='global-history')"),'Changing the user dropdown filters only application-wide activity.');
assert.ok(html.includes('data-tab="overview"')&&html.includes("parent.type==='job'?'jobOverview':'projectOverview'"),'Overview tab title reflects Project or Job type.');
assert.ok(!html.includes('Nothing is expanded by default.'),'Activity-tab hierarchy hint no longer says that nothing is expanded by default.');
const timelineStart=html.indexOf('function timelineEvents(parent,limit=8){');
const timelineEnd=html.indexOf('\nfunction renderActivity(parent)',timelineStart);
assert.ok(timelineStart>=0&&timelineEnd>timelineStart,'Could not isolate Recent activity timeline renderer.');
const timelineRenderer=html.slice(timelineStart,timelineEnd);
assert.ok(timelineRenderer.includes('activityText(e,parent.id)'),'Recent activity action text is rendered with selected-parent context.');
assert.ok(!timelineRenderer.includes('esc(item.name)')&&!timelineRenderer.includes('item.id!==parent.id'),'Recent activity metadata must not repeat child-item names already present in the action sentence.');
assert.ok(html.includes('tree-direct-type')&&html.includes("${esc(typeName(item.type))}</span>") ,'Direct hierarchy items carry their Task/Follow-up type labels.');
const treeStart=html.indexOf('function childTreeFiltered(parent){');
const treeEnd=html.indexOf('\nfunction renderChildList(',treeStart);
assert.ok(treeStart>=0&&treeEnd>treeStart,'Dashboard must define the child-tree filtering function used by rendering.');
console.log('Unified activity-history tests passed: shared schemas, one search per view, action-only labels, type tags, global field search, parent dashes, stable equal-time history and restore ordering, and fixed non-overlapping columns.');


// Child-item metadata order, mobile assignee width, and hierarchy text layout.
const childCardStart = html.indexOf('function childCard(');
const childCardEnd = html.indexOf('\nfunction renderOverview(', childCardStart);
assert.ok(childCardStart >= 0 && childCardEnd > childCardStart, 'Child-card renderer must exist as one bounded function.');
const childCardSource = html.slice(childCardStart, childCardEnd);
const priorityBeforeStatus = childCardSource.indexOf("\${item.priority?priorityPill(item.priority):''}");
const statusAfterPriority = childCardSource.indexOf("\${item.type!=='followup'?statusPill(item.status):''}");
assert.ok(priorityBeforeStatus >= 0 && statusAfterPriority > priorityBeforeStatus, 'Child-card priority must be rendered before the conditional status pill.');
assert.ok((html.match(/<div class="child-meta">\$\{item\.priority\?priorityPill\(item\.priority\):''\}\$\{item\.type!==\x27followup\x27\?statusPill\(item\.status\):''\}/g) || []).length === 2, 'Normal and archived child cards must render priority before the conditional status pill.');

const childHierarchyFixStart = html.indexOf('<style id="child-item-mobile-metadata-and-hierarchy-layout-fix-v2">');
const childHierarchyFixEnd = html.indexOf('</style>', childHierarchyFixStart);
assert.ok(childHierarchyFixStart >= 0 && childHierarchyFixEnd > childHierarchyFixStart, 'Final child-item and hierarchy layout overrides must be present.');
const childHierarchyFixCss = html.slice(childHierarchyFixStart, childHierarchyFixEnd);
assert.ok(childHierarchyFixCss.includes('#mainContent .child-meta > .child-assignee') && childHierarchyFixCss.includes('flex: 0 0 100% !important;') && childHierarchyFixCss.includes('width: 100% !important;'), 'On mobile, the child assignee pill must occupy the full child metadata row.');
assert.ok(html.includes('class="tree-followups-summary"'), 'The Follow-ups disclosure summary must have a dedicated layout hook.');
assert.ok(childHierarchyFixCss.includes('grid-template-columns: 18px minmax(120px, 1fr) auto 18px !important;') && childHierarchyFixCss.includes('white-space: nowrap !important;') && childHierarchyFixCss.includes('text-overflow: ellipsis !important;'), 'The hierarchy Follow-ups label must retain a usable text column instead of wrapping one character per line.');
assert.ok(childHierarchyFixCss.includes('.tree-task-wrap .tree-child-main > .tree-child-name') && childHierarchyFixCss.includes('grid-column: 2 / 4 !important;') && childHierarchyFixCss.includes('overflow-wrap: anywhere !important;'), 'Nested hierarchy item names must receive a full-width title row with controls moved below on mobile.');
assert.ok(childHierarchyFixCss.includes('.tree-task-wrap .tree-direct-main > .tree-name-type') && childHierarchyFixCss.includes('grid-template-rows: auto auto !important;'), 'Direct hierarchy item names must have a dedicated title row before status and Edit controls.');


// Workspace assignment rules and mobile hierarchy must remain consistent across views.
const assignableStart = html.indexOf('function assignableUsers(){');
const assignableEnd = html.indexOf('\nfunction isAssignableUserId(', assignableStart);
assert.ok(assignableStart >= 0 && assignableEnd > assignableStart, 'Assignable-user filtering must exist as a bounded helper.');
const assignableSource = html.slice(assignableStart, assignableEnd);
assert.ok(assignableSource.includes("id!=='root'") && assignableSource.includes("toLowerCase()==='root'") && assignableSource.includes('systemFlag'), 'Root/system identities must be excluded from every assignee selector.');

const assigneeControlStart = html.indexOf('function assigneeControlMarkup(type,selectedIds=[],selectionMode=\'selected\'){');
const assigneeControlEnd = html.indexOf('\nfunction updateAssigneePicker(', assigneeControlStart);
assert.ok(assigneeControlStart >= 0 && assigneeControlEnd > assigneeControlStart, 'The type-aware assignee control renderer must exist.');
const assigneeControlSource = html.slice(assigneeControlStart, assigneeControlEnd);
assert.ok(!assigneeControlSource.includes("if(type==='followup')") && !assigneeControlSource.includes('<select id="formOwner"') && assigneeControlSource.includes('name="assigneeIds"') && assigneeControlSource.includes('type="checkbox"'), 'Follow-ups must use the same multi-assignee checklist as other items.');
assert.ok(assigneeControlSource.includes('name="assigneeIds"') && assigneeControlSource.includes('type="checkbox"'), 'Projects, jobs, and Tasks must use a multi-assignee checklist.');
assert.ok(assigneeControlSource.includes('data-assignee-mode="all"') && assigneeControlSource.includes('data-assignee-mode="none"') && assigneeControlSource.includes('name="assigneeMode"'), 'The checklist must persist distinct All Users and None modes.');

const assigneeIdsStart=html.indexOf('function itemAssigneeIds(item){');
const assigneeIdsEnd=html.indexOf('\nfunction parentCreatorAssigneeId(',assigneeIdsStart);
assert.ok(assigneeIdsStart>=0&&assigneeIdsEnd>assigneeIdsStart,'The canonical assignee ID helper must exist.');
const assigneeIdsSource=html.slice(assigneeIdsStart,assigneeIdsEnd);
assert.ok(assigneeIdsSource.includes('return ids;')&&!assigneeIdsSource.includes('slice(0,1)'),'Follow-up assignee IDs must not be truncated to the primary owner.');
const submittedIdsStart=html.indexOf('function submittedAssigneeIds(type,formData){');
const submittedIdsEnd=html.indexOf('\nfunction sameAssigneeIds(',submittedIdsStart);
assert.ok(submittedIdsStart>=0&&submittedIdsEnd>submittedIdsStart,'The submitted multi-assignee helper must exist.');
const submittedIdsSource=html.slice(submittedIdsStart,submittedIdsEnd);
assert.ok(submittedIdsSource.includes("formData.getAll('assigneeIds')")&&submittedIdsSource.includes("mode==='all'")&&!submittedIdsSource.includes('slice(0,1)'),'Follow-up form submissions must preserve every selected assignee and All Users selection.');
const assigneeSyncStart=html.indexOf('function syncAssigneeControl(type,parentChanged=false,typeChanged=false){');
const assigneeSyncEnd=html.indexOf('\nfunction positionAssigneeMenu(',assigneeSyncStart);
assert.ok(assigneeSyncStart>=0&&assigneeSyncEnd>assigneeSyncStart,'The shared assignee-control refresh function must exist.');
assert.ok(html.slice(assigneeSyncStart,assigneeSyncEnd).includes('assigneeControlMarkup(type,selected,mode)'),'Changing item type or parent must re-render the shared multi-assignee picker.');
assert.ok(assigneeControlSource.includes('class="assignee-picker-menu" hidden') && assigneeControlSource.includes('data-assignee-menu-toggle'), 'The checklist must open as a collapsed popover rather than expanding the form.');
const assigneeMarkupStart = html.indexOf('function assigneeMarkup(');
const assigneeMarkupEnd = html.indexOf('\nfunction assigneeControlMarkup(', assigneeMarkupStart);
assert.ok(assigneeMarkupStart >= 0 && assigneeMarkupEnd > assigneeMarkupStart, 'The shared per-item Assignee label renderer must exist.');
const assigneeMarkupSource = html.slice(assigneeMarkupStart, assigneeMarkupEnd);
assert.ok(assigneeMarkupSource.includes('ids.length>1') && assigneeMarkupSource.includes("peopleMarkup(ids[0])") && assigneeMarkupSource.includes("(ids.length-1)"), 'More than one assignee must display only the first assignee followed by + (assignee count minus one).');
assert.ok(assigneeMarkupSource.includes("const clickable=ids.length>1&&!allUsers") && assigneeMarkupSource.includes('role="button" tabindex="0"') && assigneeMarkupSource.includes('data-assignee-popup'), 'Multi-assignee labels must be keyboard-accessible clickable controls without replacing their existing pill wrapper.');
assert.ok(assigneeMarkupSource.includes('data-assignee-ids=') && assigneeMarkupSource.includes('JSON.stringify(ids)'), 'The label must retain its exact selected assignee IDs for the details popup.');
const assigneePopupStart = html.indexOf('function toggleAssigneeDetailsPopup(');
const assigneePopupEnd = html.indexOf('\nfunction handleAssigneePopupDocumentClick(', assigneePopupStart);
assert.ok(assigneePopupStart >= 0 && assigneePopupEnd > assigneePopupStart, 'The per-item Assignee details popup renderer must exist.');
const assigneePopupSource = html.slice(assigneePopupStart, assigneePopupEnd);
assert.ok(assigneePopupSource.includes('JSON.parse(trigger.dataset.assigneeIds') && assigneePopupSource.includes('ids.map(id=>') && assigneePopupSource.includes('userAvatar(id)'), 'The popup must list every assignee with their existing avatar.');
assert.ok(assigneePopupSource.includes("user.name||tr('unknownUser')") && assigneePopupSource.includes("user.role||tr('role')"), 'Each popup entry must display the teammate name and role.');
assert.ok(assigneePopupSource.includes("tr('assigneesTitle')") && assigneePopupSource.includes('assignee-details-list'), 'The popup must have a translated heading and a dedicated assignee list.');
assert.ok(html.includes("assigneesTitle:'Assignees'") && html.includes("assigneesTitle:'الأعضاء المكلّفون'"), 'The popup heading must be translated in English and Arabic.');
assert.ok(html.includes("document.addEventListener('click',handleAssigneePopupDocumentClick,true)") && html.includes("document.addEventListener('keydown',handleAssigneePopupDocumentKeydown,true)"), 'The popup must support outside-click dismissal and keyboard activation/dismissal.');
const assigneeDetailsCssStart = html.indexOf('<style id="assignee-details-popup">');
const assigneeDetailsCssEnd = html.indexOf('</style>', assigneeDetailsCssStart);
assert.ok(assigneeDetailsCssStart >= 0 && assigneeDetailsCssEnd > assigneeDetailsCssStart, 'The theme-aware Assignee details popup stylesheet must exist.');
const assigneeDetailsCss = html.slice(assigneeDetailsCssStart, assigneeDetailsCssEnd);
assert.ok(assigneeDetailsCss.includes('background:var(--panel)') && assigneeDetailsCss.includes('border:1px solid var(--border)') && assigneeDetailsCss.includes('color:var(--text)'), 'The popup must inherit the current application theme.');
assert.ok(assigneeDetailsCss.includes('.assigned-owner.assignee-popup-trigger:hover') && assigneeDetailsCss.includes('filter:brightness') && !assigneeDetailsCss.includes('text-decoration'), 'The Assignee label must use lighting/dimming feedback without underlining.');
const assigneePickerUpdateStart = html.indexOf('function updateAssigneePicker(');
const assigneePickerUpdateEnd = html.indexOf('\nfunction currentAssigneeMode(', assigneePickerUpdateStart);
assert.ok(assigneePickerUpdateStart >= 0 && assigneePickerUpdateEnd > assigneePickerUpdateStart, 'Assignee mode selection synchronization must exist.');
const assigneePickerUpdateSource = html.slice(assigneePickerUpdateStart, assigneePickerUpdateEnd);
assert.ok(assigneePickerUpdateSource.includes('const allChecked=checks.length>0&&selected.length===checks.length;') && assigneePickerUpdateSource.includes("requestedMode==='all'||allChecked"), 'Manually checking every listed user must automatically activate the All Users mode.');

assert.ok(assigneePickerUpdateSource.includes("requestedMode==='all'") && assigneePickerUpdateSource.includes("checks.forEach(input=>{input.checked=true;})"), 'Choosing All Users must check every listed user.');
assert.ok(assigneePickerUpdateSource.includes("requestedMode==='none'") && assigneePickerUpdateSource.includes("checks.forEach(input=>{input.checked=false;})"), 'Choosing None must clear every user checkbox.');
assert.ok(assigneePickerUpdateSource.includes("mode==='all'?tr('allUsersOption')") && assigneePickerUpdateSource.includes(":'none'"), 'The selected mode must display the exact All Users or None label in the control.');
assert.ok(html.includes("?'<span class=\"assigned-person\">'+esc(tr('allUsersOption'))+'</span>'"), 'Items assigned to All Users must display All Users in the Assignee label.');
assert.ok(html.includes("allUsersOption:'All Users'") && html.includes("none:'None'"), 'All Users and None must have explicit English labels.');
const assigneePickerCssStart = html.indexOf('<style id="assignee-picker-popover">');
const assigneePickerCssEnd = html.indexOf('</style>', assigneePickerCssStart);
assert.ok(assigneePickerCssStart >= 0 && assigneePickerCssEnd > assigneePickerCssStart, 'The assignee popover stylesheet must exist.');
const assigneePickerCss = html.slice(assigneePickerCssStart, assigneePickerCssEnd);
assert.ok(assigneePickerCss.includes('position:fixed') && assigneePickerCss.includes('overflow-y:auto') && assigneePickerCss.includes('max-height:'), 'The checklist must scroll inside a viewport-bounded fixed overlay without resizing the form.');
const assigneePositionStart = html.indexOf('function positionAssigneeMenu(){');
const assigneePositionEnd = html.indexOf('\nfunction setAssigneeMenuOpen(', assigneePositionStart);
assert.ok(assigneePositionStart >= 0 && assigneePositionEnd > assigneePositionStart, 'The assignee popover viewport positioning helper must exist.');
const assigneePositionSource = html.slice(assigneePositionStart, assigneePositionEnd);
assert.ok(assigneePositionSource.includes('menu.getBoundingClientRect().height') && !assigneePositionSource.includes('menu.scrollHeight'), 'Popover placement must use its rendered constrained height, not the full checklist scroll height.');
assert.ok(html.includes('setAssigneeMenuOpen(false);trigger?.focus({preventScroll:true});return;'), 'Escape must collapse the assignee checklist before closing the item form.');
const syncAssigneeStart = html.indexOf('function syncAssigneeControl(type,parentChanged=false,typeChanged=false){');
const syncAssigneeEnd = html.indexOf('\nfunction positionAssigneeMenu(', syncAssigneeStart);
assert.ok(syncAssigneeStart >= 0 && syncAssigneeEnd > syncAssigneeStart, 'Assignee control synchronization must be bounded.');
const syncAssigneeSource = html.slice(syncAssigneeStart, syncAssigneeEnd);
assert.ok(syncAssigneeSource.includes("modal?.kind==='new-child'&&type==='followup'&&!selected.length") && syncAssigneeSource.includes('parentCreatorAssigneeId(parent)') && !syncAssigneeSource.includes('parentChanged||typeChanged||!selected.length'), 'New Follow-ups may default to their parent creator only when no assignee has already been selected.');
const followupPickerStart=html.indexOf('function assigneeControlMarkup(');
const followupPickerEnd=html.indexOf('\nfunction updateAssigneePicker(',followupPickerStart);
const submittedFollowupStart=html.indexOf('function submittedAssigneeIds(');
const submittedFollowupEnd=html.indexOf('\nfunction submittedAssigneeMode(',submittedFollowupStart);
assert.ok(followupPickerStart>=0&&followupPickerEnd>followupPickerStart&&submittedFollowupStart>=0&&submittedFollowupEnd>submittedFollowupStart,'Could not isolate the shared assignee picker and submission helpers.');
const followupPickerSource=html.slice(followupPickerStart,followupPickerEnd);
const followupUsers=[{id:'u1'},{id:'u2'},{id:'u3'}];
const followupPickerContext={assignableUsers:()=>followupUsers,isAssignableUserId:id=>followupUsers.some(user=>user.id===String(id)),person:id=>({name:String(id),role:'User'}),esc:value=>String(value??''),tr:key=>key,icon:()=>''};
const followupPickerMarkup=vm.runInNewContext(followupPickerSource+';assigneeControlMarkup("followup",["u2","u3"],"selected");',followupPickerContext);
assert.ok(followupPickerMarkup.includes('value="u2" checked')&&followupPickerMarkup.includes('value="u3" checked'),'The Follow-up picker must render multiple independently checked assignees.');
const submittedFollowupContext={assignableUsers:()=>followupUsers,isAssignableUserId:id=>followupUsers.some(user=>user.id===String(id)),formData:{get:key=>key==='assigneeMode'?'selected':'',getAll:key=>key==='assigneeIds'?['u2','u3']:[]}};
const submittedFollowupIds=vm.runInNewContext(html.slice(submittedFollowupStart,submittedFollowupEnd)+';submittedAssigneeIds("followup",formData);',submittedFollowupContext);
assert.deepEqual(Array.from(submittedFollowupIds),['u2','u3'],'Submitting a Follow-up must preserve every selected assignee.');
const followupSyncContext={rendered:'',$:selector=>selector==='#formAssigneeControl'?{set innerHTML(value){followupSyncContext.rendered=value;}}:{classList:{remove(){}}},currentModalItem:()=>null,ui:{modal:{kind:'new-child',parentId:'project-1'}},currentAssigneeSelection:()=>['u2','u3'],currentAssigneeMode:()=> 'selected',itemAssigneeIds:()=>[],allItem:()=>({id:'project-1'}),parentCreatorAssigneeId:()=> 'u1',assigneeControlMarkup:(type,ids,mode)=>JSON.stringify({type,ids:Array.from(ids),mode})};
vm.runInNewContext(syncAssigneeSource+';syncAssigneeControl("followup",true,false);',followupSyncContext);
assert.deepEqual(JSON.parse(followupSyncContext.rendered).ids,['u2','u3'],'Changing a Follow-up parent must not silently replace an existing multi-assignee selection.');
followupSyncContext.currentAssigneeSelection=()=>[];
followupSyncContext.currentAssigneeMode=()=> 'none';
vm.runInNewContext(syncAssigneeSource+';syncAssigneeControl("followup",true,false);',followupSyncContext);
assert.deepEqual(JSON.parse(followupSyncContext.rendered).ids,[],'Selecting None for a new Follow-up must remain unassigned instead of inheriting its parent creator.');

const submitStart = html.indexOf('async function handleItemSubmit(form){');
const submitEnd = html.indexOf('\nfunction ', submitStart + 10);
assert.ok(submitStart >= 0 && submitEnd > submitStart, 'The item form submit handler must exist.');
const submitSource = html.slice(submitStart, submitEnd);
assert.ok(submitSource.includes('submittedAssigneeMode(type,fd)') && submitSource.includes("assigneeMode:assigneeMode||'none'"), 'Follow-ups must persist an explicit None assignment without requiring a selected user.');
assert.doesNotMatch(submitSource,/assigneeRequired|at least one team member/i,'A Follow-up with None assignees must be accepted.');
assert.ok(submitSource.includes('submittedAssigneeMode(type,fd)') && submitSource.includes("assigneeMode:assigneeMode||'none'"), 'New Projects, Jobs, and Tasks must explicitly persist None unless another assignment mode is selected.');
assert.ok(submitSource.includes('item.assigneeIds=assigneeIds') && submitSource.includes('item.ownerId=ownerId'), 'The canonical assignee list and legacy primary owner must both be persisted.');

assert.ok(html.includes("mode==='all'?tr('allUsersOption')") && html.includes("allUsersOption:'All Users'"), 'All Users must have a dedicated picker label without changing Activity history filtering.');
const selectedDefault = syncAssigneeSource.includes("modal?.kind==='new-child'&&type==='followup'") && syncAssigneeSource.includes('parentCreatorAssigneeId(parent)') && syncAssigneeSource.includes("mode=selected.length?'selected':'none'");
assert.ok(selectedDefault, 'New Follow-ups must default to their immediate parent creator while retaining the shared picker.');
const pickerCssStart = html.indexOf('<style id="assignee-picker-popover">');
const pickerCssEnd = html.indexOf('</style>',pickerCssStart);
assert.ok(pickerCssStart>=0&&pickerCssEnd>pickerCssStart&&html.slice(pickerCssStart,pickerCssEnd).includes('position:fixed')&&html.slice(pickerCssStart,pickerCssEnd).includes('overflow-y:auto'), 'The checklist popover must stay within the viewport and scroll without resizing the form.');
assert.equal(submitSource.split("assigneeMode:assigneeMode||'none'").length - 1, 2, 'Both newly created parent and child records must explicitly default to None.');
const assignedFilterStart = html.indexOf('function filteredAssignedItems(');
const assignedFilterEnd = html.indexOf('\nfunction assignmentContextMarkup(', assignedFilterStart);
assert.ok(assignedFilterStart >= 0 && assignedFilterEnd > assignedFilterStart, 'Assigned Items filter must exist.');
assert.ok(html.slice(assignedFilterStart, assignedFilterEnd).includes("itemAssigneeIds(item).includes(String(ui.actingUserId||''))"), 'Secondary assignees must see the item in Assigned Items.');
const accountUserMatchStart = html.indexOf('function accountSearchUserMatches(');
const accountUserMatchEnd = html.indexOf('function accountSearchResultsMarkup(', accountUserMatchStart);
assert.ok(accountUserMatchStart >= 0 && accountUserMatchEnd > accountUserMatchStart, 'Account search assignee matching helper must exist.');
assert.ok(html.slice(accountUserMatchStart, accountUserMatchEnd).includes('item.assigneeIds'), 'Search user filters must recognize every assigned team member.');

const accountSearchRendererStart=html.indexOf('function accountSearchResultsMarkup(){');
const accountSearchRendererEnd=html.indexOf('function refreshAccountSearchResults(',accountSearchRendererStart);
assert.ok(accountSearchRendererStart>=0&&accountSearchRendererEnd>accountSearchRendererStart,'Profile Search must keep its own result filtering and rendering function.');
const accountSearchRendererSource=html.slice(accountSearchRendererStart,accountSearchRendererEnd);
assert.ok(accountSearchRendererSource.includes('displayRows.map(accountAssignedItemRow)')&&accountSearchRendererSource.includes("ui.lang==='ar'&&item.nameArabic"),'Profile Search parent results must reuse the Assigned Items row renderer while preserving Arabic parent names.');
assert.ok(accountSearchRendererSource.includes('class="account-item-list"')&&!accountSearchRendererSource.includes('<article class="parent-card">'),'Profile Search parent results must use the Assigned Items card layout instead of the legacy parent-card template.');

assert.ok(html.includes('function mobileSearchToggleMarkup()') && html.includes('mobileSearchToggle.innerHTML=mobileSearchToggleMarkup()') && html.includes('mobileToggle.innerHTML=mobileSearchToggleMarkup()'), 'The Projects & Jobs search toggle must render its state chevron in mobile and workspace layouts.');
const workspaceFixStart = html.indexOf('<style id="workspace-assignees-hierarchy-toggle-and-scroll-fixes">');
const workspaceFixEnd = html.indexOf('</style>', workspaceFixStart);
assert.ok(workspaceFixStart >= 0 && workspaceFixEnd > workspaceFixStart, 'The final workspace hierarchy and toggle stylesheet must exist.');
const workspaceFixCss = html.slice(workspaceFixStart, workspaceFixEnd);
assert.ok(workspaceFixCss.includes('grid-template-columns:22px minmax(132px,1fr)') && workspaceFixCss.includes('minmax(132px,1fr)') && workspaceFixCss.includes('overflow-wrap:break-word !important;') && workspaceFixCss.includes('writing-mode:horizontal-tb !important;'), 'Hierarchy rows must preserve a usable text column and horizontal text flow on phones.');
assert.ok(workspaceFixCss.includes('.mobile-search-toggle[aria-expanded="true"]') && workspaceFixCss.includes('.mobile-search-toggle[aria-expanded="false"]') && workspaceFixCss.includes('mobile-search-toggle-state svg'), 'The search toggle must visually distinguish expanded and collapsed states.');
assert.ok(workspaceFixCss.includes('position:fixed !important; top:86px !important; bottom:auto !important;') && workspaceFixCss.includes('top:78px !important;'), 'The scroll-to-top button must stay at the top edge of the workspace below the sticky header.');


const followupOrderCardStart=html.indexOf('function childCard(item,parent');
const followupOrderCardEnd=html.indexOf('\nfunction childTreeFiltered(',followupOrderCardStart);
assert.ok(followupOrderCardStart>=0&&followupOrderCardEnd>followupOrderCardStart,'The child card renderer must exist.');
const followupOrderCardSource=html.slice(followupOrderCardStart,followupOrderCardEnd);
assert.ok(followupOrderCardSource.indexOf("assigneeMarkup(item,'child-assignee')")>=0&&followupOrderCardSource.indexOf("assigneeMarkup(item,'child-assignee')")<followupOrderCardSource.indexOf('item.dueDate?'), 'Child cards must display the Assignee label before the Due date.');
assert.ok(followupOrderCardSource.includes('class="meta-piece child-due-date"')&&html.includes('.child-meta>.child-assignee{order:3}')&&html.includes('.child-meta>.child-due-date{order:4}'),'Child-card visual ordering must keep the complete Assignee label immediately before the Due date regardless of responsive wrapping.');

const assignedRowStart=html.indexOf('function accountAssignedItemRow(item){');
const assignedRowEnd=html.indexOf('\nfunction filteredAccountAssignedItems(',assignedRowStart);
assert.ok(assignedRowStart>=0&&assignedRowEnd>assignedRowStart,'Assigned Items must have a dedicated row renderer so Pinned Items retain their existing layout.');
const assignedRowSource=html.slice(assignedRowStart,assignedRowEnd);
assert.ok(assignedRowSource.includes('account-assigned-context-row')&&assignedRowSource.includes('account-assigned-parent-name')&&assignedRowSource.includes('typeLabel'), 'Task and Follow-up rows must show their type and immediate parent in the first metadata row.');
assert.ok(assignedRowSource.includes("priorityPill(item.priority||'medium')")&&assignedRowSource.includes("item.type==='followup'?'':statusPill(item.status)")&&assignedRowSource.includes("item.type==='followup'?'':'")&&assignedRowSource.includes('account-assigned-due'), 'Assigned rows must show priority for Follow-ups and status/due date only for types that support them.');
assert.ok(assignedRowSource.includes('isParent')&&assignedRowSource.includes('data-history-scope="item"')&&assignedRowSource.includes('statusPill(item.status)'), 'Project and Job rows must show type, status, and due date together and request item-only history.');
assert.ok(assignedRowSource.includes('data-action="select-assigned"')&&assignedRowSource.includes('pinActionMarkup(id)')&&assignedRowSource.includes('data-action="history"'), 'The Assigned Items row must retain its existing Work, Activity, and Pin actions.');

const assignedHydratorStart=html.indexOf('async function hydrateAccountAssignedParentNames(');
const assignedHydratorEnd=html.indexOf('\nfunction accountAssignedItemRow(',assignedHydratorStart);
assert.ok(assignedHydratorStart>=0&&assignedHydratorEnd>assignedHydratorStart,'Immediate parent-name hydration must be isolated from the display renderer.');
const assignedHydratorSource=html.slice(assignedHydratorStart,assignedHydratorEnd);
assert.ok(assignedHydratorSource.includes('api.resolveItems')&&assignedHydratorSource.includes('offset+=100')&&assignedHydratorSource.includes('assignedParentName'), 'Missing immediate parent names must be resolved in bounded batches and attached as display metadata.');
assert.ok(assignedHydratorSource.includes('catch(error)')&&assignedHydratorSource.includes('return rows;'), 'Optional parent-name hydration failures must not block Assigned Items loading.');

const assignedVisibilityStart=html.indexOf('function accountAssignedSectionVisibility(){');
const assignedGroupsEnd=html.indexOf('\nfunction accountAssignedSectionMarkup(',assignedVisibilityStart);
assert.ok(assignedVisibilityStart>=0&&assignedGroupsEnd>assignedVisibilityStart,'Assigned Items must define explicit section visibility and grouping rules.');
const assignedGroupsSource=html.slice(assignedVisibilityStart,assignedGroupsEnd);
function assignedGroupsFor(type,priority){
 const allRows=[
  {id:'t1',type:'task'},{id:'f1',type:'followup'},
  {id:'p1',type:'project'},{id:'j1',type:'job'}
 ];
 const rows=allRows.filter(item=>(type==='all'||item.type===type)&&(priority==='all'||item.type==='task'||item.type==='followup'));
 return vm.runInNewContext(assignedGroupsSource+'; accountAssignedSections(rows);',{
  ui:{accountAssignedType:type,accountAssignedPriority:priority},rows
 });
}
const allAssignedGroups=assignedGroupsFor('all','all');
assert.equal(allAssignedGroups.taskFollowups.length,2,'The first section must contain Tasks and Follow-ups when no type filter is selected.');
assert.equal(allAssignedGroups.projectsJobs.length,2,'The second section must contain Projects and Jobs when no type or priority filter is selected.');
const priorityAssignedGroups=assignedGroupsFor('all','high');
assert.equal(priorityAssignedGroups.taskFollowups.length,2,'Priority filtering must retain the Tasks & Follow-ups section.');
assert.equal(priorityAssignedGroups.projectsJobs.length,0,'Priority filtering must hide the Projects & Jobs section.');
const projectAssignedGroups=assignedGroupsFor('project','all');
assert.equal(projectAssignedGroups.taskFollowups.length,0,'An explicit Project type filter must hide Tasks & Follow-ups.');
assert.equal(projectAssignedGroups.projectsJobs.length,1,'An explicit Project type filter must retain only the matching parent section rows.');
const followupAssignedGroups=assignedGroupsFor('followup','all');
assert.equal(followupAssignedGroups.taskFollowups.length,1,'An explicit Follow-up type filter must retain only Follow-ups.');
assert.equal(followupAssignedGroups.projectsJobs.length,0,'An explicit Follow-up type filter must hide Projects & Jobs.');
const assignedResultsStart=html.indexOf('function accountAssignedResultsMarkup(){');
const assignedResultsEnd=html.indexOf('\nfunction refreshAccountAssignedResults(',assignedResultsStart);
assert.ok(assignedResultsStart>=0&&assignedResultsEnd>assignedResultsStart,'The two-section Assigned Items result renderer must exist.');
const assignedResultsSource=html.slice(assignedResultsStart,assignedResultsEnd);
assert.ok(assignedResultsSource.includes("accountAssignedSectionMarkup('taskFollowups'")&&assignedResultsSource.includes("accountAssignedSectionMarkup('projectsJobs'")&&assignedResultsSource.indexOf("accountAssignedSectionMarkup('taskFollowups'")<assignedResultsSource.indexOf("accountAssignedSectionMarkup('projectsJobs'"), 'Tasks & Follow-ups must render before Projects & Jobs.');
assert.ok(assignedResultsSource.includes('filteredAccountAssignedItems()')&&assignedResultsSource.includes('accountAssignedSections(rows)'), 'Both sections must use the same filtered row set.');

const assignedHistoryStart=html.indexOf('function openHistory(');
const assignedHistoryEnd=html.indexOf('\nfunction openApplicationHistory(',assignedHistoryStart);
assert.ok(assignedHistoryStart>=0&&assignedHistoryEnd>assignedHistoryStart,'The item history opener must exist.');
const assignedHistorySource=html.slice(assignedHistoryStart,assignedHistoryEnd);
assert.ok(assignedHistorySource.includes("requestedScope==='item'")&&assignedHistorySource.includes("const assignedTask=item.type==='task'&&ui.accountTab==='assigned'")&&assignedHistorySource.includes("historyScope=item.type==='followup'||requestedScope==='item'||assignedTask?'item':'all'"), 'Assigned Items Task history must default to This item only, while other item scopes retain their requested/default history behavior.');
assert.ok(html.includes("actionEl.dataset.historyScope||''"), 'The Activity action handler must forward the requested history scope.');

assert.ok(html.includes("assignedTasksFollowups:'Tasks & Follow-ups'")&&html.includes("assignedProjectsJobs:'Projects & Jobs'"), 'The two Assigned Items section headings must be translated in English.');
assert.ok(html.includes("assignedTasksFollowups:'المهام والمتابعات'")&&html.includes("assignedProjectsJobs:'المشروعات والأعمال المؤقتة'"), 'The two Assigned Items section headings must be translated in Arabic.');
assert.ok(html.includes('id="account-assigned-sections-layout"')&&html.includes('.account-item-row .account-item-actions'), 'The new section metadata styling must leave the shared, existing action-row layout in place.');

const pinnedSectionsStart=html.indexOf('function accountPinnedSections(rows){');
const pinnedSectionsEnd=html.indexOf('\nfunction orderedPinnedItems(',pinnedSectionsStart);
assert.ok(pinnedSectionsStart>=0&&pinnedSectionsEnd>pinnedSectionsStart,'Pinned Items must have its own active-only section grouper.');
const pinnedSectionsSource=html.slice(pinnedSectionsStart,pinnedSectionsEnd);
function pinnedGroupsFor(rows){
 return vm.runInNewContext(pinnedSectionsSource+'; accountPinnedSections(rows);',{rows,isActiveItem:item=>!item?.deletedAt&&!item?.archivedAt&&!item?.archiveId});
}
const pinnedGroups=pinnedGroupsFor([
 {id:'f1',type:'followup'},{id:'p1',type:'project'},
 {id:'j1',type:'job'},{id:'t1',type:'task'}
]);
assert.deepEqual(pinnedGroups.taskFollowups.map(x=>x.id),['f1','t1'],'Pinned Tasks & Follow-ups must include both child types without applying Assigned Items filters.');
assert.deepEqual(pinnedGroups.projectsJobs.map(x=>x.id),['p1','j1'],'Pinned Projects & Jobs must include both parent types without applying Assigned Items filters.');
const activePinnedGroups=pinnedGroupsFor([{id:'active',type:'task'},{id:'archived',type:'followup',archivedAt:'2026-11-07T00:00:00.000Z'}]);
assert.deepEqual(activePinnedGroups.taskFollowups.map(x=>x.id),['active'],'Archived pins must not be rendered in Pinned Items.');

const pinOrderStart=html.indexOf('function orderedPinnedItems(ids,found){');
const pinOrderEnd=html.indexOf('\nfunction accountAssignedResultsMarkup(',pinOrderStart);
assert.ok(pinOrderStart>=0&&pinOrderEnd>pinOrderStart,'Pinned display ordering must be isolated in a testable helper.');
const pinOrderSource=html.slice(pinOrderStart,pinOrderEnd);
const pinOrderResult=vm.runInNewContext(pinOrderSource+'; orderedPinnedItems(ids,found);',{
 ids:['oldest','middle','newest','stale'],
 found:new Map([
  ['oldest',{id:'oldest'}],['middle',{id:'middle'}],['newest',{id:'newest'}]
 ])
});
assert.deepEqual(pinOrderResult.validIds,['oldest','middle','newest'],'Stale pin cleanup must preserve the persisted oldest-to-newest pin sequence.');
assert.deepEqual(pinOrderResult.rows.map(x=>x.id),['newest','middle','oldest'],'Pinned Items must render newest pins first based on the append-ordered pin-date list.');

const pinnedLoaderStart=html.indexOf('async function loadAccountPinnedItems(){');
const pinnedLoaderEnd=html.indexOf('\nasync function ',pinnedLoaderStart+20);
assert.ok(pinnedLoaderStart>=0&&pinnedLoaderEnd>pinnedLoaderStart,'Pinned Items loading must remain isolated.');
const pinnedLoaderSource=html.slice(pinnedLoaderStart,pinnedLoaderEnd);
assert.ok(pinnedLoaderSource.includes('hydrateAccountAssignedParentNames(rows.filter(isActiveItem),api,hydration)')&&pinnedLoaderSource.includes('orderedPinnedItems(ids,found)'), 'Pinned child rows must resolve immediate parent names and use pin-order display sequencing.');
assert.ok(pinnedLoaderSource.includes('updateMyPins(orderedPins.validIds)'), 'Stale-pin cleanup must persist the original sequence, not the reversed display order.');

const pinnedPanelStart=html.indexOf('const activePinnedRows=(ui.accountPinnedRows||[]).filter(isActiveItem);const pinnedSections=accountPinnedSections(activePinnedRows);');
const pinnedPanelEnd=html.indexOf("\n }\n if(ui.accountTab==='search')",pinnedPanelStart);
assert.ok(pinnedPanelStart>=0&&pinnedPanelEnd>pinnedPanelStart,'The Pinned Items panel must render its two sections independently of search filters.');
const pinnedPanelSource=html.slice(pinnedPanelStart,pinnedPanelEnd);
assert.ok(pinnedPanelSource.includes("accountAssignedSectionMarkup('taskFollowups',pinnedSections.taskFollowups)")&&pinnedPanelSource.includes("accountAssignedSectionMarkup('projectsJobs',pinnedSections.projectsJobs)")&&pinnedPanelSource.includes('account-assigned-sections'), 'Pinned Items must reuse the same section headings, row renderer, and layout as Assigned Items.');
assert.ok(!pinnedPanelSource.includes('account-search-controls')&&!pinnedPanelSource.includes('accountAssignedType')&&!pinnedPanelSource.includes('accountAssignedPriority'), 'Pinned Items must not inherit Assigned Items filters.');

const assignedStyleStart=html.indexOf('<style id="account-assigned-sections-layout">');
const assignedStyleEnd=html.indexOf('</style>',assignedStyleStart);
assert.ok(assignedStyleStart>=0&&assignedStyleEnd>assignedStyleStart,'The shared Assigned/Pinned row styles must exist.');
const assignedStyleSource=html.slice(assignedStyleStart,assignedStyleEnd);
for(const status of ['status-not-started','status-in-progress','status-on-hold','status-completed']){
 assert.ok(assignedStyleSource.includes('status-pill.'+status),'Account item rows must explicitly restore the default '+status+' text/background colors.');
}
for(const priority of ['priority-urgent','priority-high','priority-medium','priority-low']){
 assert.ok(assignedStyleSource.includes('priority-pill.'+priority),'Account item rows must explicitly restore the default '+priority+' text/background colors.');
}
assert.ok(assignedStyleSource.includes('color-mix(in srgb,var(--amber) 68%,var(--muted))')&&assignedStyleSource.includes('color-mix(in srgb,var(--amber-bg) 70%,var(--panel-2))'), 'On Hold must use a dimmed amber treatment distinct from Medium priority.');

