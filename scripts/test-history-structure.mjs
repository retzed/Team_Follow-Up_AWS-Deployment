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
const statusAfterPriority = childCardSource.indexOf('\${statusPill(item.status)}');
assert.ok(priorityBeforeStatus >= 0 && statusAfterPriority > priorityBeforeStatus, 'Child-card priority must be rendered before status.');
assert.ok((html.match(/<div class="child-meta">\$\{item\.priority\?priorityPill\(item\.priority\):''\}\$\{statusPill\(item\.status\)\}/g) || []).length === 2, 'Normal and archived child cards must both render priority before status.');

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

const assigneeControlStart = html.indexOf('function assigneeControlMarkup(type,selectedIds=[]){');
const assigneeControlEnd = html.indexOf('\nfunction currentAssigneeSelection(', assigneeControlStart);
assert.ok(assigneeControlStart >= 0 && assigneeControlEnd > assigneeControlStart, 'The type-aware assignee control renderer must exist.');
const assigneeControlSource = html.slice(assigneeControlStart, assigneeControlEnd);
assert.ok(assigneeControlSource.includes("if(type==='followup')") && assigneeControlSource.includes('<select id="formOwner"') && assigneeControlSource.includes('required'), 'Follow-ups must use one required single-assignee select.');
assert.ok(assigneeControlSource.includes('name="assigneeIds"') && assigneeControlSource.includes('type="checkbox"'), 'Projects, jobs, and Tasks must use a multi-assignee checklist.');

const syncAssigneeStart = html.indexOf('function syncAssigneeControl(type,parentChanged=false,typeChanged=false){');
const syncAssigneeEnd = html.indexOf("$('#modalRoot').addEventListener('change'", syncAssigneeStart);
assert.ok(syncAssigneeStart >= 0 && syncAssigneeEnd > syncAssigneeStart, 'Assignee control synchronization must be bounded.');
const syncAssigneeSource = html.slice(syncAssigneeStart, syncAssigneeEnd);
assert.ok(syncAssigneeSource.includes('parentChanged||typeChanged||!owner') && syncAssigneeSource.includes('parentCreatorAssigneeId(parent)'), 'Changing the new child form to Follow-up must default to the immediate parent creator.');

const submitStart = html.indexOf('function handleItemSubmit(form){');
const submitEnd = html.indexOf('\nfunction ', submitStart + 10);
assert.ok(submitStart >= 0 && submitEnd > submitStart, 'The item form submit handler must exist.');
const submitSource = html.slice(submitStart, submitEnd);
assert.ok(submitSource.includes('if(!assigneeIds.length)') && submitSource.includes("tr('assigneeRequired')"), 'Saving an item without a valid assignee must be blocked.');
assert.ok(submitSource.includes('item.assigneeIds=assigneeIds') && submitSource.includes('item.ownerId=ownerId'), 'The canonical assignee list and legacy primary owner must both be persisted.');

const assignedFilterStart = html.indexOf('function filteredAssignedItems(');
const assignedFilterEnd = html.indexOf('\nfunction assignmentContextMarkup(', assignedFilterStart);
assert.ok(assignedFilterStart >= 0 && assignedFilterEnd > assignedFilterStart, 'Assigned Items filter must exist.');
assert.ok(html.slice(assignedFilterStart, assignedFilterEnd).includes('itemAssigneeIds(item).includes(String(ui.actingUserId||\\'\\'))'), 'Secondary assignees must see the item in Assigned Items.');
const accountUserMatchStart = html.indexOf('function accountSearchUserMatches(');
const accountUserMatchEnd = html.indexOf('function accountSearchResultsMarkup(', accountUserMatchStart);
assert.ok(accountUserMatchStart >= 0 && accountUserMatchEnd > accountUserMatchStart, 'Account search assignee matching helper must exist.');
assert.ok(html.slice(accountUserMatchStart, accountUserMatchEnd).includes('item.assigneeIds'), 'Search user filters must recognize every assigned team member.');

assert.ok(html.includes('function mobileSearchToggleMarkup()') && html.includes('mobileSearchToggle.innerHTML=mobileSearchToggleMarkup()') && html.includes('mobileToggle.innerHTML=mobileSearchToggleMarkup()'), 'The Projects & Jobs search toggle must render its state chevron in mobile and workspace layouts.');
const workspaceFixStart = html.indexOf('<style id="workspace-assignees-hierarchy-toggle-and-scroll-fixes">');
const workspaceFixEnd = html.indexOf('</style>', workspaceFixStart);
assert.ok(workspaceFixStart >= 0 && workspaceFixEnd > workspaceFixStart, 'The final workspace hierarchy and toggle stylesheet must exist.');
const workspaceFixCss = html.slice(workspaceFixStart, workspaceFixEnd);
assert.ok(workspaceFixCss.includes('grid-template-columns:22px minmax(132px,1fr)') && workspaceFixCss.includes('minmax(132px,1fr)') && workspaceFixCss.includes('overflow-wrap:break-word !important;') && workspaceFixCss.includes('writing-mode:horizontal-tb !important;'), 'Hierarchy rows must preserve a usable text column and horizontal text flow on phones.');
assert.ok(workspaceFixCss.includes('.mobile-search-toggle[aria-expanded="true"]') && workspaceFixCss.includes('.mobile-search-toggle[aria-expanded="false"]') && workspaceFixCss.includes('mobile-search-toggle-state svg'), 'The search toggle must visually distinguish expanded and collapsed states.');
assert.ok(workspaceFixCss.includes('.scroll-to-top { position:fixed !important; top:86px !important; bottom:auto !important;') && workspaceFixCss.includes('top:78px !important;'), 'The scroll-to-top button must stay at the top edge of the workspace below the sticky header.');
