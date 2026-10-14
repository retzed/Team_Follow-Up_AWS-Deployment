import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const targetedStart = html.indexOf('<style id="targeted-history-and-child-search-polish">');
const targetedEnd = html.indexOf('</style>', targetedStart);
assert.ok(targetedStart >= 0 && targetedEnd > targetedStart, 'Targeted refinements stylesheet must exist.');
const targetedCss = html.slice(targetedStart, targetedEnd);
for (const [col, width] of [[4,28],[5,28]]) {
  assert.ok(targetedCss.includes(`.application-history-table col:nth-child(${col}){width:${width}%!important}`), `Application history column ${col} must be ${width}%.`);
  assert.ok(targetedCss.includes(`.application-history-table th:nth-child(${col}),.application-history-table td:nth-child(${col}){width:${width}%!important;min-width:0!important}`), `Application history cells in column ${col} must respect its width.`);
}
assert.ok(targetedCss.includes('.application-history-table col:nth-child(6){width:auto!important}'), 'Application history Action column must consume remaining space after assigning 28% to each item column.');
assert.ok(targetedCss.includes('.application-history-table col:nth-child(2){width:10%!important}') && targetedCss.includes('.application-history-table col:nth-child(3){width:12%!important}'), 'Date and User columns stay compact to make room for Parent and Child.');
assert.ok(targetedCss.includes('.application-history-table th:nth-child(6),.application-history-table td:nth-child(6){width:auto!important;min-width:0!important}'), 'Application history Action cells must remain auto-sized.');
assert.ok(targetedCss.includes('.application-history-table{width:100%!important;min-width:1120px!important;table-layout:fixed!important}'), 'Application-wide history reserves room for wider Parent and Child columns.');

const renderActivityStart = html.indexOf('function renderActivity(parent){');
const renderActivityEnd = html.indexOf('\nfunction renderDetail()', renderActivityStart);
assert.ok(renderActivityStart >= 0 && renderActivityEnd > renderActivityStart, 'Activity panel renderer must exist.');
const renderActivity = html.slice(renderActivityStart, renderActivityEnd);
assert.ok(!renderActivity.includes("tr('relatedItemsHint')") && !renderActivity.includes("tr('recentActivityHint')"), 'Activity panel must omit the unnecessary descriptions.');
assert.ok(!html.includes('Expand an item to see the items beneath it') && !html.includes('A chronological record of edits and status changes.'), 'Obsolete English activity descriptions must be removed.');
assert.ok(!html.includes('Choose the project, job, or task this item belongs to.') && !html.includes('اختر المشروع أو العمل المؤقت أو المهمة المرتبط بها هذا العنصر.'), 'Choose-parent helper text must be removed in both languages.');

const searchStart = html.indexOf('function renderParentSearchList(list){');
const searchEnd = html.indexOf('\nfunction sidebarQueryOptions(', searchStart);
assert.ok(searchStart >= 0 && searchEnd > searchStart, 'Parent search renderer must exist.');
const searchRenderer = html.slice(searchStart, searchEnd);
assert.ok(!searchRenderer.includes('p.createdBy') && !searchRenderer.includes('fmtDateTime(p.createdAt)'), 'Parent Search cards must not repeat creator/time metadata.');
const assignedStart = html.indexOf('function renderAssignedList(listOverride=null){');
const assignedEnd = html.indexOf('\nfunction renderParentSearchList(', assignedStart);
assert.ok(assignedStart >= 0 && assignedEnd > assignedStart, 'Assigned-to-me renderer must exist.');
const assignedRenderer = html.slice(assignedStart, assignedEnd);
assert.ok(!assignedRenderer.includes('created-label parent-created-label') && !assignedRenderer.includes('fmtDateTime(item.createdAt)'), 'Assigned to me cards must omit redundant creator/date metadata for parents, tasks and follow-ups.');

const childStart = html.indexOf('function childCard(item,parent,{nested=false,filteredNested=null}={}){');
const childEnd = html.indexOf('\nfunction renderOverview(parent)', childStart);
assert.ok(childStart >= 0 && childEnd > childStart, 'Child card renderer must exist.');
const childRenderer = html.slice(childStart, childEnd);
assert.ok(childRenderer.includes('class="owner-pill assigned-owner child-assignee"') && childRenderer.includes("${esc(tr('assignee'))}:") && childRenderer.includes('roleLabel(item.ownerId)'), 'Child assignee matches parent Assigned to styling but uses the localized Assignee label.');
assert.ok(html.includes('class="owner-pill assigned-owner child-assignee"') && html.includes('roleLabel(assigneeId)'), 'Archived child assignee uses the same owner pill styling.');
assert.ok(html.includes('class="parent-card-title" dir="auto"') && html.includes('class="child-title" dir="auto"') && html.includes('class="detail-title" dir="auto"'), 'User-entered item names derive text direction from their own first strong character in cards and the dashboard.');
assert.ok(html.includes('class="history-subject-name" dir="auto"') && html.includes('<bdi dir="auto">${esc(parent.name)}</bdi>') && html.includes('unicode-bidi: plaintext;'), 'Activity history and archive item-name contexts isolate mixed Arabic/Latin names from the UI language direction.');
assert.ok(html.includes('id="mixed-script-content-direction-fix"') && html.includes('.history-search-hint { display: none !important; }'), 'Mobile history search-filter hint labels stay hidden and mixed-script names get a final bidi safeguard.');
assert.ok(html.includes(':root[lang="en"] { --mixed-content-align: left; }') && html.includes(':root[lang="ar"] { --mixed-content-align: right; }') && html.includes('text-align: var(--mixed-content-align) !important;') && !html.includes('unicode-bidi: plaintext; text-align: start;'), 'Mixed Arabic/Latin text keeps content-based bidi ordering while its alignment follows the selected interface language.');
assert.ok(html.includes('function assignmentContextMarkup(item)') && html.includes('<bdi dir="auto">${esc(root.name)}</bdi>'), 'Names embedded in Assigned to me card context are isolated from UI-direction changes.');
assert.ok(html.includes('id="formName" name="name" dir="auto"') && html.includes('id="formDescription" name="description" dir="auto"') && html.includes('<option dir="auto" value="${esc(p.id)}"'), 'Editing fields and parent selector use content-driven direction for mixed Arabic/Latin text.');

const modalStart = html.indexOf('function renderModal(){');
const modalEnd = html.indexOf('\nlet toastTimer;', modalStart);
assert.ok(modalStart >= 0 && modalEnd > modalStart, 'Modal renderer must exist.');
const modalRenderer = html.slice(modalStart, modalEnd);
assert.ok(modalRenderer.includes("const formLead=m.kind==='new-child'?`${typeField}${nameField}${relationshipField}`"), 'Child creation places Name beside Type before the full-width relationship selector.');
assert.ok(modalRenderer.includes("if(m.focusNameOnOpen){m.focusNameOnOpen=false;const nameInput=$('#formName');if(nameInput)nameInput.focus({preventScroll:true});}"), 'Create modal focuses Name once, without stealing focus during later rerenders.');
assert.ok(html.includes("focusNameOnOpen:true"), 'Parent and child create actions must request name-field focus.');
assert.ok(!modalRenderer.includes("tr('chooseParentHint')"), 'Child modal must not render the removed relationship helper.');
assert.ok(modalRenderer.includes("subtitle='';"), 'Relationship descriptions are removed from the modal header.');
assert.ok(modalRenderer.includes("tr('childRelationshipHint'):tr('parentRelationshipHint')"), 'The relationship explanation remains at the bottom of the form.');
assert.ok(!modalRenderer.includes("class=\"modal-note\">${esc(tr('childRelationshipHint'))}"), 'The extra child relationship note next to Type is removed.');

const childListStart = html.indexOf('function renderChildList(parent){');
const childListEnd = html.indexOf('\nfunction treeActivity(', childListStart);
assert.ok(childListStart >= 0 && childListEnd > childListStart, 'Child search result renderer must exist.');
const childListRenderer = html.slice(childListStart, childListEnd);
assert.equal((childListRenderer.match(/'noResults'/g) || []).length, 1, 'Filtered empty child search renders the no-results label only once.');
assert.ok(childListRenderer.includes("?'':`<p>${esc(tr('noChildHint'))}</p>`"), 'Only the default empty state shows the lower hint paragraph.');
assert.ok(html.includes("const showGroupAction=group.items.length>1||(!archivedRoot&&group.items.some(x=>x.type==='task'||x.type==='followup'));"), 'Archive shows Select all in hierarchy even when only child items are selectable.');

const actionStart = html.indexOf('function historyActionLabel(event){');
const actionEnd = html.indexOf('\nfunction historySearchText(', actionStart);
assert.ok(actionStart >= 0 && actionEnd > actionStart, 'History action label function must exist.');
const actionSource = html.slice(actionStart, actionEnd);
const actionContext = {
  ui: { lang: 'en' },
  tr: (key) => ({ actionCreated: 'Created', actionDeleted: 'Deleted', actionRestored: 'Restored', actionArchived: 'Archived', statusLabel: 'Status', assignee: 'Assignee', assignedTo: 'Assigned to', name: 'Name', description: 'Description', dueDate: 'Due date', priorityLabel: 'Priority', type: 'Type', archive: 'Archive' })[key] ?? key
};
vm.runInNewContext(`${actionSource}; this.historyActionLabel = historyActionLabel;`, actionContext);
assert.equal(actionContext.historyActionLabel({ action: 'Updated Assigned to for task: Weekly review.' }), 'Updated Assignee', 'Legacy “Updated Assigned to” events normalize to “Updated Assignee”.');
assert.equal(actionContext.historyActionLabel({ action: 'Status changed from In progress to Not started.' }), 'Updated Status', 'Status transitions normalize to “Updated Status”.');
assert.equal(actionContext.historyActionLabel({ action: 'Status changed: In progress → Not started' }), 'Updated Status', 'Legacy arrow-style status actions normalize to “Updated Status”.');
actionContext.ui.lang = 'ar';
actionContext.tr = (key) => ({ actionCreated: 'إنشاء', actionDeleted: 'حذف', actionRestored: 'استعادة', actionArchived: 'أرشفة', statusLabel: 'الحالة', assignee: 'المكلّف', assignedTo: 'مكلّف إلى', name: 'الاسم', description: 'الوصف', dueDate: 'موعد التسليم', priorityLabel: 'الأولوية', type: 'النوع', archive: 'الأرشيف' })[key] ?? key;
assert.equal(actionContext.historyActionLabel({ action: 'Updated Assigned to for task: Weekly review.' }), 'تم تحديث المكلّف', 'Arabic legacy assignment events use the localized Assignee label.');
assert.equal(actionContext.historyActionLabel({ action: 'Status changed from In progress to Not started.' }), 'تم تحديث الحالة', 'Arabic status-change events use the localized Updated Status label.');

const activityStart = html.indexOf('function activityText(entry,contextItemId=');
const activityEnd = html.indexOf('\nfunction logActivity(', activityStart);
assert.ok(activityStart >= 0 && activityEnd > activityStart, 'Recent activity formatter must exist.');
const activityContext = {
  ui: { lang: 'en' },
  t: { ar: { completed: 'مكتملة' } },
  localizedUserNames: { u3: 'لينا فوزي' }
};
vm.runInNewContext(`${html.slice(activityStart, activityEnd)}; this.activityText = activityText;`, activityContext);
assert.equal(activityContext.activityText({ action: 'Status changed from In progress to Not started.' }, 'p1'), 'Updated Status', 'Recent activity normalizes status events too.');
assert.equal(activityContext.activityText({ action: 'Updated Assigned to for task: Review.' }, 'p1'), 'Updated Assignee for task: Review.', 'Recent activity normalizes legacy assignee action text.');
activityContext.ui.lang = 'ar';
assert.equal(activityContext.activityText({ action: 'Status changed from In progress to Not started.' }, 'p1'), 'تم تحديث الحالة', 'Recent activity status normalization is localized to Arabic.');
assert.equal(activityContext.activityText({ action: 'Updated Assigned to for task: Review.' }, 'p1'), 'تم تحديث المكلّف', 'Recent activity legacy assignee normalization is localized to Arabic.');

const mobileFixStart = html.indexOf('<style id="mobile-input-and-history-fixes">');
const mobileFixEnd = html.indexOf('</style>', mobileFixStart);
const mobileFixStyle = mobileFixStart >= 0 && mobileFixEnd > mobileFixStart ? html.slice(mobileFixStart, mobileFixEnd + '</style>'.length) : '';
assert.ok(mobileFixStyle.includes('input, select, textarea { font-size: 16px !important; }'), 'Mobile sign-in and app controls use a 16px minimum effective font size to prevent iOS focus zoom.');
assert.ok(mobileFixStyle.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);') && mobileFixStyle.includes('grid-template-columns: minmax(0, 1fr) !important;'), 'From/to date filters constrain their grid tracks and stack on narrow phones.');
assert.ok(mobileFixStyle.includes('height: 100dvh !important;') && mobileFixStyle.includes('position: fixed !important;') && mobileFixStyle.includes('.modal.project-history-modal') && mobileFixStyle.includes('.modal.application-history-modal'), 'Both activity history dialog types occupy the top-to-bottom mobile viewport.');
assert.ok(mobileFixStyle.includes('html[dir="rtl"] #signOutButton svg') && mobileFixStyle.includes('transform: scaleX(-1);'), 'Sign-out icon direction is mirrored in RTL on both desktop and mobile.');

const mobileV2Start = html.indexOf('<style id="mobile-history-space-and-date-filter-fix-v2">');
const mobileV2End = html.indexOf('</style>', mobileV2Start);
const mobileV2Style = mobileV2Start >= 0 && mobileV2End > mobileV2Start
  ? html.slice(mobileV2Start, mobileV2End + '</style>'.length)
  : '';
assert.ok(mobileV2Start > mobileFixEnd, 'Final mobile overrides load after the earlier responsive fix block.');
assert.ok(
  mobileV2Style.includes('.modal.project-history-modal .history-card-list') &&
  mobileV2Style.includes('.modal.application-history-modal .history-card-list') &&
  mobileV2Style.includes('flex: 1 1 0 !important;') &&
  mobileV2Style.includes('max-height: none !important;') &&
  mobileV2Style.includes('overflow-y: auto !important;'),
  'Both mobile history card lists expand into the full remaining popup height and scroll internally.'
);
assert.ok(
  mobileV2Style.includes('.date-filter,') &&
  mobileV2Style.includes('grid-template-columns: minmax(0, 1fr) !important;') &&
  mobileV2Style.includes('.date-filter input[type="date"]') &&
  mobileV2Style.includes('width: 100% !important;'),
  'Mobile sidebar From/To filters use a single full-width column with intrinsic date-input overflow constrained.'
);
assert.ok(
  mobileV2Style.includes('#mainContent .child-toolbar .child-date-row') &&
  mobileV2Style.includes('#mainContent .child-toolbar .child-date-row > .child-filter-field') &&
  mobileV2Style.includes('.child-mobile-clear-button') &&
  mobileV2Style.includes('grid-row: auto !important;'),
  'Mobile child-item From/To filters use separate full-width rows and the Clear button moves below them.'
);

console.log('UI refinement tests passed: history widths/action labels, bilingual helper removal, concise sidebar cards, labeled child assignees, modal focus/layout and English/Arabic normalization across history views.');
