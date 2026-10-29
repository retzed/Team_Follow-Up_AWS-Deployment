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


const assignedFilterFunctionStart = html.indexOf('function filteredAccountAssignedItems(){');
const assignedFilterFunctionEnd = html.indexOf('\nfunction accountAssignedResultsMarkup()', assignedFilterFunctionStart);
assert.ok(assignedFilterFunctionStart >= 0 && assignedFilterFunctionEnd > assignedFilterFunctionStart, 'Assigned Items must have an isolated filter function.');
const assignedFilterFunction = html.slice(assignedFilterFunctionStart, assignedFilterFunctionEnd);
assert.ok(assignedFilterFunction.includes('ui.accountAssignedQuery') && assignedFilterFunction.includes("type!=='all'") && assignedFilterFunction.includes('matchesStatusFilter(item.status,status)') && assignedFilterFunction.includes("matchesDate(item,dateMode,dateFrom,dateTo,'application')"), 'Assigned Items filters must cover query, type, status, and date range.');
assert.ok(assignedFilterFunction.includes('compareByDateMode(a,b,dateMode)'), 'Assigned Items sort order must follow the selected Date list mode.');
for (const filterId of ['accountAssignedQuery','accountAssignedType','accountAssignedStatus','accountAssignedDateMode','accountAssignedDateFrom','accountAssignedDateTo']) {
  assert.ok(html.includes(`id="${filterId}"`), `Assigned Items must render the ${filterId} control.`);
  assert.ok(html.includes(`ev.target.id==='${filterId}'`), `Assigned Items must respond to changes in ${filterId}.`);
}
assert.ok(html.includes('data-action="clear-account-assigned-filters"') && html.includes("case 'clear-account-assigned-filters':"), 'Assigned Items Clear must reset its independent filters.');
assert.ok(html.includes('id="account-assigned-filters-layout"') && html.includes('.account-assigned-controls') && html.includes('"from to"'), 'Assigned Items filters must use the responsive desktop/mobile layout.');

const modalStart = html.indexOf('function renderModal(preserveExisting=true){');
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
  'The legacy mobile date-filter fallback remains covered; the final override defines the effective paired layout.'
);
assert.ok(
  mobileV2Style.includes('#mainContent .child-toolbar .child-date-row') &&
  mobileV2Style.includes('#mainContent .child-toolbar .child-date-row > .child-filter-field') &&
  mobileV2Style.includes('.child-mobile-clear-button') &&
  mobileV2Style.includes('grid-row: auto !important;'),
  'The legacy child-filter fallback remains covered; the final override defines the effective paired layout.'
);


const mobileV3Start = html.indexOf('<style id="mobile-date-input-overflow-fix-v3">');
const mobileV3End = html.indexOf('</style>', mobileV3Start);
const mobileV3Style = mobileV3Start >= 0 && mobileV3End > mobileV3Start
  ? html.slice(mobileV3Start, mobileV3End + '</style>'.length)
  : '';
assert.ok(
  mobileV3Start > html.indexOf('<style id="mixed-script-content-direction-fix">') &&
  mobileV3Start < html.lastIndexOf('</body>'),
  'Final date-layout overrides load after the legacy responsive styles.'
);
assert.ok(
  mobileV3Style.includes('.sidebar-content > .date-filter > .field') &&
  mobileV3Style.includes('display: grid !important;') &&
  mobileV3Style.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') &&
  mobileV3Style.includes('width: auto !important;') &&
  mobileV3Style.includes('overflow: visible !important;'),
  'Sidebar From/To fields use equal, shrinkable columns instead of oversized full-width rows.'
);
assert.ok(
  mobileV3Style.includes('input[type="date"]') &&
  mobileV3Style.includes('min-inline-size: 0 !important;') &&
  mobileV3Style.includes('max-inline-size: 100% !important;') &&
  mobileV3Style.includes('box-sizing: border-box !important;'),
  'Native date controls stay within their available width, including popup date controls.'
);
assert.ok(
  mobileV3Style.includes('#mainContent .child-toolbar .child-date-row') &&
  mobileV3Style.includes('display: grid !important;') &&
  mobileV3Style.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') &&
  mobileV3Style.includes('grid-column: 1 / -1 !important;') &&
  mobileV3Style.includes('grid-row: 2 !important;') &&
  mobileV3Style.includes('.child-mobile-clear-button'),
  'Child From/To filters use two equal columns and Clear occupies the row below, not a third column.'
);
assert.ok(
  mobileV3Style.includes('.modal .form-grid > .field') &&
  mobileV3Style.includes('grid-template-columns: minmax(0, 1fr) !important;'),
  'Create/edit popup fields cannot expand the form grid or date input beyond the viewport.'
);


const modalDirectionFixStart=html.indexOf('<style id="activity-history-recovery-and-rtl-fixes">');
const modalDirectionFixEnd=html.indexOf('</style>',modalDirectionFixStart);
assert.ok(modalDirectionFixStart>=0&&modalDirectionFixEnd>modalDirectionFixStart,'The final activity-history recovery stylesheet must exist.');
const modalDirectionFix=html.slice(modalDirectionFixStart,modalDirectionFixEnd);
assert.ok(modalDirectionFix.includes('#modalRoot .modal-head{direction:ltr!important;flex-direction:row!important}'),'RTL must not reverse the modal header row on the first render.');
assert.ok(modalDirectionFix.includes('#modalRoot .modal-head>button[data-action="close-modal"]{margin-inline-start:auto!important;flex:0 0 auto}'),'The modal close button must anchor to the right edge independently of RTL heading text.');

assert.ok(
  html.includes("const footerNode=existingModal.querySelector(':scope > .modal-footer');") &&
  html.includes("footerNode.replaceWith(nextFooter)") &&
  !html.includes("if(footerNode)footerNode.innerHTML=footer;"),
  'Re-rendering a modal replaces its footer element instead of nesting footer markup and duplicating divider lines.'
);
assert.ok(
  html.includes('.history-table tbody tr:last-child td{border-bottom:1px solid var(--border)}'),
  'The final history-table row retains its bottom divider when fewer rows are shown.'
);

const check = (condition, message) => assert.ok(condition, message);

// Execute the real user-matching predicate against demo and canonical AWS-shaped records.
const userMatchStart=html.indexOf('function accountSearchUserMatches(item,userId)');
const userMatchEnd=html.indexOf('function accountSearchResultsMarkup()',userMatchStart);
assert.ok(userMatchStart>=0&&userMatchEnd>userMatchStart,'The user-matching predicate must be available for direct regression checks.');
const accountUserMatches=vm.runInNewContext('('+html.slice(userMatchStart,userMatchEnd)+')');
assert.equal(accountUserMatches({createdByUserId:'u2'},'u2'),true,'Canonical creator IDs must match.');
assert.equal(accountUserMatches({updatedByUserId:'u3'},'u3'),true,'Canonical updater IDs must match.');
assert.equal(accountUserMatches({ownerId:'u4',assignedTo:'u4'},'u4'),true,'Owner/assignee fields must match.');
assert.equal(accountUserMatches({assignees:[{userId:'u5'}]},'u5'),true,'Object-shaped assignee records must match.');
assert.equal(accountUserMatches({createdByUserId:'u2'},'u3'),false,'Unrelated user IDs must not match.');
assert.equal(accountUserMatches({createdByUserId:'u2'},'all'),false,'The all-users sentinel must not be treated as an associated identity.');
// Model aliases and mobile interaction safety.
check(html.includes('item.createdByUserId') && html.includes('item.updatedByUserId') &&
      html.includes('item.assignedToUserId') && html.includes('item.assigneeUserId'),
  'User search covers both demo aliases and the canonical AWS user-ID fields.');
const searchMarkupStart=html.indexOf('function accountSearchResultsMarkup()');
const searchMarkupEnd=html.indexOf('function refreshAccountSearchResults()',searchMarkupStart);
const searchMarkup=html.slice(searchMarkupStart,searchMarkupEnd);
check(!searchMarkup.includes('<article class="parent-card" tabindex="0">'),
  'Search result cards are not falsely keyboard-focusable without a card-level action.');
check(html.includes('@media(max-width:820px){.account-search-controls{grid-template-columns:repeat(2,minmax(0,1fr))}') &&
      html.includes('.account-search-controls .account-search-query-field{grid-column:1/-1}'),
  'Account Search filters collapse to a two-column, shrink-safe layout on tablet and mobile widths.');
const assignAfterLoad=html.indexOf('void ensureRootChildrenLoaded(selectedRootId).then(()=>{');
const assignAfterLoadEnd=html.indexOf("break;}  case 'open-archive':",assignAfterLoad);
const assignAfterLoadBody=html.slice(assignAfterLoad,assignAfterLoadEnd);
check(assignAfterLoadBody.includes('seenAfterLoad') && assignAfterLoadBody.includes("if(ancestor.type==='task')ui.expanded.add(String(ancestor.id))"),
  'Assigned/Pinned navigation recalculates and expands task ancestors after root child hydration.');
// Account Search, navigation, and profile-layout regression coverage.
check(html.includes("labelArabicLabel:'Label (Arabic)'") &&
      html.includes("labelArabicLabel:'المسمى (بالعربية)'") &&
      !html.includes("Label (Arabic, optional)") &&
      !html.includes('id="accountPrivilege"'),
  'The profile omits its redundant privilege field and uses the concise bilingual Arabic Label text.');
const profileRolePos=html.indexOf('for="accountRole"');
const profileRoleArabicPos=html.indexOf('for="accountRoleArabic"');
const profileIconPos=html.indexOf('for="accountIcon"');
check(profileRolePos>=0 && profileRoleArabicPos>profileRolePos && profileIconPos>profileRoleArabicPos,
  'Profile Label fields remain adjacent with Profile icon as the final personal-detail field.');
const personStart=html.indexOf('function person(id)');
const personEnd=html.indexOf('function currentUser()',personStart);
const personSource=html.slice(personStart,personEnd);
check(personStart>=0 && personEnd>personStart && personSource.includes('nameArabic') &&
      personSource.includes('raw.name||') && personSource.includes('roleArabic') && personSource.includes('raw.role||') &&
      !personSource.includes('localizedUserNames') && !personSource.includes('localizedUserRoles'),
  'Missing Arabic user names and labels fall back to their exact English values in Arabic view.');
check(html.includes("placeholder=\"${esc(user.name||") &&
      html.includes("placeholder=\"${esc(user.role||") &&
      html.includes('function refreshAccountProfileForForm()') &&
      html.includes("if(next==='profile')void refreshAccountProfileForForm()") &&
      html.includes('preserveExistingTranslations:true'),
  'Profile Arabic inputs show English fallback placeholders and refresh the logged-in profile while preserving available translations.');
for(const control of ['accountSearchDateMode','accountSearchDateFrom','accountSearchDateTo','accountSearchUser','clear-account-search']) {
  check(html.includes(control), `Account Search exposes its date and user filter control: ${control}.`);
}
check(html.includes("user.privilege==='User'?'':"),
  'The duplicate standard User badge is suppressed at the Profile heading.');
const passwordStart=html.indexOf("<form id='accountPasswordForm'>");
const passwordEnd=html.indexOf('</form>',passwordStart);
const passwordMarkup=html.slice(passwordStart,passwordEnd);
check(passwordStart>=0 && passwordEnd>passwordStart &&
      passwordMarkup.includes("class='account-field full'><label for='passwordCurrent'") &&
      passwordMarkup.indexOf("for='passwordNew'")<passwordMarkup.indexOf("for='passwordConfirm'"),
  'Current password spans a row, with New and Confirm following as the desktop two-column pair.');
check(html.includes('id="mobile-profile-search-date-width-fix"') &&
      html.includes('#accountPage .account-search-controls > .account-search-date-from-field,') &&
      html.includes('overflow: hidden !important;') &&
      html.includes('max-inline-size: 100% !important;'),
  'Mobile From/To inputs are shrink-constrained to their equal-width grid columns.');

check(html.includes('function accountSearchUserMatches') &&
      !html.includes("function accountSearchUserMatches(item,userId){if(!userId||userId==='all')return true;") &&
      html.includes("if(userId!=='all'&&!accountSearchUserMatches(item,userId))return false;") &&
      html.includes('function accountSearchResultsMarkup()') &&
      html.includes("if(!matchesDate(item,dateMode,dateFrom,dateTo,'application'))return false;"),
  'Account Search filters by user and date range without treating every user as related to every result.');
const accountSearchStart=html.indexOf('function accountSearchResultsMarkup()');
const accountSearchEnd=html.indexOf('function refreshAccountSearchResults()',accountSearchStart);
check(accountSearchStart>=0 && accountSearchEnd>accountSearchStart &&
      html.slice(accountSearchStart,accountSearchEnd).includes('data-action="select-parent"') &&
      html.slice(accountSearchStart,accountSearchEnd).includes('data-action="history"') &&
      !html.slice(accountSearchStart,accountSearchEnd).includes('<article class="parent-card" data-action="select-parent"'),
  'Search results use explicit Open in workspace and Activity history buttons rather than selecting on card click.');
check(html.includes('data-action="history" data-item-id="${esc(id)}"') &&
      html.includes('data-action="select-assigned" data-id="${esc(id)}"'),
  'Assigned and pinned item rows expose both workspace navigation and item activity history.');
const parentActionStart=html.indexOf("case 'select-parent':");
const sidebarModeActionStart=html.indexOf("case 'sidebar-mode':",parentActionStart);
const parentAction=html.slice(parentActionStart,sidebarModeActionStart);
check(parentAction.includes("ui.page='workspace'") && parentAction.includes('applyTranslations()') &&
      parentAction.includes('void ensureRootChildrenLoaded(id)'),
  'Opening a Search result switches to the visible workspace and preserves lazy child loading.');
const assignedActionStart=html.indexOf("case 'select-assigned':");
const archiveActionStart=html.indexOf("case 'open-archive':",assignedActionStart);
const assignedAction=html.slice(assignedActionStart,archiveActionStart);
check(assignedAction.includes("ui.page='workspace'") && assignedAction.includes('applyTranslations()') &&
      assignedAction.includes('void ensureRootChildrenLoaded(selectedRootId)'),
  'Opening an assigned or pinned item switches to the visible workspace and hydrates its root.');
const sidebarActionStart=html.indexOf("case 'sidebar-toggle':");
const pinActionStart=html.indexOf("case 'toggle-pin':",sidebarActionStart);
const sidebarAction=html.slice(sidebarActionStart,pinActionStart);
check(sidebarAction.includes('setWorkspaceSidebarCollapsed(!ui.sidebarCollapsed)') &&
      sidebarAction.includes('const shouldExpand=ui.sidebarCollapsed') &&
      sidebarAction.includes('renderDetail()') && sidebarAction.includes('void ensureRootChildrenLoaded(selectedId)'),
  'The Search toggle uses a dedicated state transition and restores selected workspace detail only when expanding.');

// Workspace Search sidebar close/reopen regression coverage.
const uiDeclarationStart=html.indexOf('const ui={');
const uiDeclarationEnd=html.indexOf('\n',uiDeclarationStart);
check(uiDeclarationStart>=0 && uiDeclarationEnd>uiDeclarationStart &&
      html.slice(uiDeclarationStart,uiDeclarationEnd).includes('sidebarCollapsed:true,') &&
      html.includes('data-action="sidebar-toggle" aria-expanded="false"'),
  'Workspace Search starts collapsed, including its initial accessible expanded state.');
check(html.includes('function syncWorkspaceSidebarVisibility()') &&
      html.includes('function setWorkspaceSidebarCollapsed(collapsed)') &&
      html.includes('sidebarQuerySequence++') &&
      html.includes('token!==sidebarQuerySequence') &&
      html.includes('sidebarQueryTimer=null;'),
  'Closing Search cancels a queued sidebar refresh and invalidates in-flight result renders.');
check(!html.includes('ui.sidebarCollapsed=false;applyTranslations();') &&
      html.includes('previousMobileSidebarViewport=mobile;syncWorkspaceSidebarVisibility();'),
  'Viewport changes preserve the user-selected collapsed state instead of forcibly reopening Search.');
const collapsedLayoutStart=html.indexOf('.layout.sidebar-is-collapsed{');
const collapsedLayoutEnd=html.indexOf('}',collapsedLayoutStart);
const collapsedLayoutCss=collapsedLayoutStart>=0&&collapsedLayoutEnd>collapsedLayoutStart?html.slice(collapsedLayoutStart,collapsedLayoutEnd+1):'';
check(collapsedLayoutCss.includes('grid-template-columns:minmax(0,1fr)!important') &&
      !collapsedLayoutCss.includes('grid-template-columns:0 minmax(0,1fr)') &&
      html.includes('.layout.sidebar-is-collapsed>.sidebar{display:none!important}') &&
      html.includes('<main class="main" id="mainContent"'),
  'When Search is collapsed, the hidden sidebar is removed and the main workspace keeps a full-width grid column instead of landing in a zero-width track.');
check(parentAction.includes("const enteringWorkspace=ui.page==='account'") &&
      parentAction.includes('if(enteringWorkspace)setWorkspaceSidebarCollapsed(true);') &&
      assignedAction.includes("const enteringWorkspace=ui.page==='account'") &&
      assignedAction.includes('if(enteringWorkspace)setWorkspaceSidebarCollapsed(true);'),
  'Workspace navigation from Account starts with Search collapsed, while workspace-to-workspace navigation keeps the chosen state.');

const sidebarHelpersStart=html.indexOf('function syncWorkspaceSidebarVisibility(){');
const sidebarHelpersEnd=html.indexOf('\nfunction renderParentList(',sidebarHelpersStart);
assert.ok(sidebarHelpersStart>=0 && sidebarHelpersEnd>sidebarHelpersStart,
  'Workspace sidebar state helpers must be defined before the list renderer.');
const sidebarHelpers=html.slice(sidebarHelpersStart,sidebarHelpersEnd);
const sidebarNodes={
  layout:{collapsed:false,classList:{toggle(name,value){if(name==='sidebar-is-collapsed')sidebarNodes.layout.collapsed=value;}}},
  content:{hidden:false},
  toggle:{hidden:false,title:'',attributes:{},innerHTML:'',setAttribute(name,value){this.attributes[name]=value;}}
};
const clearedSidebarTimers=[];
const sidebarContext={
  ui:{sidebarCollapsed:false,page:'workspace'},
  isMobileSidebarViewport:()=>false,
  $:(selector)=>selector==='.layout'?sidebarNodes.layout:selector==='#sidebarContent'?sidebarNodes.content:selector==='#sidebarToggleFloat'?sidebarNodes.toggle:null,
  tr:(key)=>({expandSidebar:'Expand project search',collapseSidebar:'Collapse project search'})[key]||key,
  icon:()=>'<svg></svg>',
  clearTimeout:(timer)=>clearedSidebarTimers.push(timer)
};
vm.runInNewContext(`let sidebarQueryTimer=77,sidebarQuerySequence=10;\n${sidebarHelpers}\nthis.setSidebarCollapsed=setWorkspaceSidebarCollapsed;this.readSidebarInternals=()=>({timer:sidebarQueryTimer,sequence:sidebarQuerySequence});`,sidebarContext);
sidebarContext.setSidebarCollapsed(true);
assert.equal(sidebarContext.ui.sidebarCollapsed,true,'Collapsing Search updates the single source of truth.');
assert.equal(sidebarNodes.layout.collapsed,true,'Collapsing Search applies the zero-width sidebar layout.');
assert.equal(sidebarNodes.content.hidden,true,'Collapsing Search hides its content panel.');
assert.equal(sidebarNodes.toggle.attributes['aria-expanded'],'false','The toggle reports the collapsed state accessibly.');
assert.deepEqual(clearedSidebarTimers,[77],'Closing Search clears a queued sidebar timer.');
assert.equal(sidebarContext.readSidebarInternals().timer,null,'Closing Search clears the stored timer handle.');
assert.equal(sidebarContext.readSidebarInternals().sequence,11,'Closing Search invalidates queued/in-flight search responses.');
sidebarContext.setSidebarCollapsed(false);
assert.equal(sidebarContext.ui.sidebarCollapsed,false,'Expanding Search updates the same state source.');
assert.equal(sidebarNodes.layout.collapsed,false,'Expanding Search restores the workspace grid.');
assert.equal(sidebarNodes.content.hidden,false,'Expanding Search restores its content panel.');
assert.equal(sidebarNodes.toggle.attributes['aria-expanded'],'true','The toggle reports the expanded state accessibly.');

// Mobile-only Search toggle and account/assigned card width regressions.
check(html.includes('id="mobileSearchToggle" class="mobile-search-toggle"') &&
      html.includes("mobileToggle.hidden=ui.page==='account'||!isMobileSidebarViewport();") &&
      html.includes("toggle.hidden=ui.page==='account'||isMobileSidebarViewport();"),
  'The labelled Search projects & Jobs control is mobile-only, while the floating icon is desktop-only.');
check(html.includes('.mobile-search-toggle:not([hidden]){display:flex;') &&
      html.includes('.account-search-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));') &&
      html.includes('.account-search-controls input,.account-search-controls select,.account-search-controls button{width:100%;min-width:0;max-width:100%;box-sizing:border-box}'),
  'Mobile Account Search controls stay inside shrink-safe grid columns and cannot exceed the available width.');
check(html.includes('.account-item-row{display:grid;grid-template-columns:32px minmax(0,1fr);') &&
      html.includes('.account-item-actions{grid-column:1/-1;grid-row:2;display:flex;flex-wrap:wrap;') &&
      html.includes('.account-item-actions .btn,.account-item-actions button{display:inline-flex;'),
  'Assigned and pinned Account rows use a shrink-safe two-column layout with wrapped actions instead of narrow vertical text.');
check(html.includes('.assigned-card .parent-card-copy{display:block!important;flex:1 1 0!important;width:0!important;min-width:0!important;') &&
      html.includes('.assigned-card .parent-card-title,.assigned-card .parent-card-type{display:block!important;width:100%;') &&
      html.includes('.assigned-card .mini-updated{display:flex!important;width:100%;'),
  'Workspace Assigned-mode cards keep readable titles and metadata within the mobile viewport.');


const mobileDateRowFix = html.match(/<style id="mobile-profile-date-row-width-fix">([\\s\\S]*?)<\\/style>/)?.[1] || '';
check(mobileDateRowFix.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;') &&
      mobileDateRowFix.includes('"from to"') &&
      mobileDateRowFix.includes('min-inline-size: 0 !important;') &&
      mobileDateRowFix.includes('max-inline-size: 100% !important;') &&
      mobileDateRowFix.includes('@media (max-width: 380px)') &&
      mobileDateRowFix.includes('#accountPage .account-assigned-controls'),
  'Profile Search and Assigned Items keep From/To side by side and constrain date inputs to half-width grid columns on mobile, including narrow phones.');

console.log('UI refinement tests passed: activity history, bilingual UI, profile/Search filters, workspace navigation, desktop/mobile Search toggles, and responsive Account/Assigned layouts.');
