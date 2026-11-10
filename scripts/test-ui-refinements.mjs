import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const femaleUserIcon = html.match(/'female-user':'([^']+)'/);
const genericUserIcon = html.match(/\buser:'([^']+)'/);
assert.ok(femaleUserIcon && genericUserIcon, 'Both Female User and generic User must exist in the inline SVG icon registry.');
const maleProfileIcon = html.match(/'profile-user':'([^']+)'/);
assert.ok(maleProfileIcon, 'The profile-specific male User icon must exist.');
assert.ok(maleProfileIcon[1].includes('M8.1 8.4c-.4-.8-.5-1.8-.2-2.7') && maleProfileIcon[1].includes('M8.2 6.9c1.1.1 2.1-.4 3-1.2') && maleProfileIcon[1].includes('M9.2 4.2c.7-.5'), 'Profile User must use a closely cropped, side-parted hairstyle with fine strand detail.');
assert.ok(maleProfileIcon[1].includes('M8.1 8.7c0-2.8 1.6-4.7') && maleProfileIcon[1].includes('M4 21v-.8') && !maleProfileIcon[1].includes('M9.05 11.25'), 'Profile User must have a defined face and shoulders rather than the old hanger-like outline.');
assert.ok(maleProfileIcon[1].includes('M8.1 10.1c-.4-.2-.7.1-.7.5') && maleProfileIcon[1].includes('M15.9 10.1c.4-.2.7.1.7.5'), 'Male profile icon ears remain narrow and close to the face.');
assert.notEqual(femaleUserIcon[1], genericUserIcon[1], 'Female User must have a distinct glyph rather than duplicating the generic User icon.');
assert.ok(femaleUserIcon[1].includes('M8.1 13.7C7.2 13 6.6 12 6.7 10.7') && femaleUserIcon[1].includes('M7.9 8.1C9.2 8.4 11 7.1') && femaleUserIcon[1].includes('M9.2 3.5C8.5 4.5 8.4 5.7 8 7.8') && femaleUserIcon[1].includes('.2 2.2-.8 2.8'), 'Female User bob keeps its original shape with the fringe, crown strands, and side locks joined into the outer hair contour.');
assert.ok(html.includes("'profile-user':'User ♂'") && html.includes("'female-user':'User ♀'"), 'Male and female profile icon names must include their globally recognizable gender symbols.');
assert.ok(!html.includes('const genderSymbol=') && !html.includes("const badge='<circle") && !html.includes("'profile-user':{stroke:") && !html.includes("'female-user':{stroke:"), 'Gender symbols belong in the icon names only; the original male and female SVG illustrations must remain unchanged.');
assert.ok(femaleUserIcon[1].includes('L12 18l2.8-2.6') && html.includes("{value:'female-user'}") && html.includes("'female-user':'User ♀'"), 'User ♀ must include its neckline and remain selectable with its explicit label.');
const targetedStart = html.indexOf('<style id="targeted-history-and-child-search-polish">');
const targetedEnd = html.indexOf('</style>', targetedStart);
assert.ok(targetedStart >= 0 && targetedEnd > targetedStart, 'Targeted refinements stylesheet must exist.');
const targetedCss = html.slice(targetedStart, targetedEnd);
for (const [col, width] of [[4,28],[5,28]]) {
  assert.ok(targetedCss.includes(`.application-history-table col:nth-child(${col}){width:${width}%!important}`), `Application history column ${col} must be ${width}%.`);
  assert.ok(targetedCss.includes(`.application-history-table th:nth-child(${col}),.application-history-table td:nth-child(${col}){width:${width}%!important;min-width:0!important}`), `Application history cells in column ${col} must respect its width.`);
}
assert.ok(targetedCss.includes('.application-history-table col:nth-child(6){width:auto!important}'), 'Application history Action column must consume remaining space after assigning 28% to each item column.');
const dateRangeStart = html.indexOf('<style id="account-date-range-structural-layout">');
const dateRangeEnd = html.indexOf('</style>', dateRangeStart);
assert.ok(dateRangeStart >= 0 && dateRangeEnd > dateRangeStart, 'The structural account date-range stylesheet must exist.');
const dateRangeCss = html.slice(dateRangeStart, dateRangeEnd);
const searchFromPos = html.indexOf('id="accountSearchDateFrom"');
const searchToPos = html.indexOf('id="accountSearchDateTo"');
const assignedFromPos = html.indexOf('id="accountAssignedDateFrom"');
const assignedToPos = html.indexOf('id="accountAssignedDateTo"');
for (const [name, fromPos, toPos] of [
  ['Profile Search', searchFromPos, searchToPos],
  ['Assigned Items', assignedFromPos, assignedToPos]
]) {
  assert.ok(fromPos >= 0 && toPos > fromPos, `${name} must contain both From and To date inputs.`);
  const wrapperStart = html.lastIndexOf('<div class="account-search-date-range', fromPos);
  const wrapperEnd = html.indexOf('</div>', toPos);
  assert.ok(wrapperStart >= 0 && wrapperEnd > toPos, `${name} From/To inputs must be enclosed by one shared date-range wrapper.`);
  assert.ok(html.slice(wrapperStart, wrapperEnd).includes('account-search-date-from-field') && html.slice(wrapperStart, wrapperEnd).includes('account-search-date-to-field'), `${name} must preserve distinct From and To labels inside the paired wrapper.`);
}
assert.equal((html.match(/<div class="account-search-date-range(?:\s|")/g) || []).length, 2, 'Only Search and Assigned Items should each render one paired date-range wrapper.');
assert.ok(dateRangeCss.includes('grid-template-columns:repeat(2,minmax(0,1fr))'), 'The paired date-range wrapper must use two shrinkable columns.');
assert.ok(dateRangeCss.includes('width:100% !important;') && dateRangeCss.includes('min-width:0 !important;') && dateRangeCss.includes('min-inline-size:0 !important;'), 'Both the date-range wrapper and its native inputs must be shrinkable and constrained to their assigned width.');
assert.ok(dateRangeCss.includes('-webkit-appearance:none !important;') && dateRangeCss.includes('appearance:none !important;'), 'The native date fields must opt out of iOS WebKit intrinsic sizing.');
assert.ok(dateRangeCss.includes('padding:0 !important;') && !dateRangeCss.includes('padding:0 5px'), 'Native date inputs must not have horizontal padding because iOS WebKit miscalculates their width when padding is applied.');
assert.ok(dateRangeCss.includes('::-webkit-date-and-time-value{') && dateRangeCss.includes('height:1.5em !important;'), 'The WebKit date-value pseudo-element must reserve height so empty date fields do not collapse.');
assert.ok(dateRangeCss.includes('"user dateMode"') && dateRangeCss.includes('"dateRange dateRange"'), 'Profile Search User and Date list stay adjacent while the paired date range gets its own full-width row.');
assert.ok(dateRangeCss.includes('"priority dateMode"'), 'Assigned Items Priority and Date list stay adjacent.');
assert.ok(dateRangeCss.includes('@media (max-width:360px)'), 'Only very narrow screens may stack the two date inputs to preserve legibility.');
assert.ok(!html.includes('#accountPage .account-search-controls > .account-search-date-from-field') && !html.includes('#accountPage .account-search-controls > .account-search-date-to-field'), 'Obsolete direct-child date selectors must be removed now that the date inputs share a wrapper.');
assert.ok(!html.includes('#accountPage .account-assigned-controls > .account-search-date-from-field') && !html.includes('#accountPage .account-assigned-controls > .account-search-date-to-field'), 'Assigned Items must use the same wrapper-based date layout without old direct-child overrides.');
assert.ok(!html.includes('id="mobile-profile-search-date-width-fix"') && !html.includes('id="mobile-profile-date-row-width-fix"'), 'Legacy mobile date stylesheets with direct-child placement and clipping rules must be removed.');
const dateRangeCssStart = html.indexOf('<style id="account-date-range-structural-layout">');
const dateRangeCssEnd = html.indexOf('</style>', dateRangeCssStart);
const finalDateRangeCss = html.slice(dateRangeCssStart, dateRangeCssEnd);
assert.ok(!finalDateRangeCss.includes('overflow: hidden') && !finalDateRangeCss.includes('padding:0 5px'), 'The final date stylesheet must not clip native date inputs or apply horizontal padding that triggers iOS width miscalculation.');
const childDateSizingStart = html.indexOf('<style id="mobile-account-date-input-sizing-fix">');
const childDateSizingEnd = html.indexOf('</style>', childDateSizingStart);
assert.ok(childDateSizingStart >= 0 && childDateSizingEnd > childDateSizingStart, 'Existing child-item mobile sizing rules must remain available.');
const childDateSizingCss = html.slice(childDateSizingStart, childDateSizingEnd);
assert.ok(childDateSizingCss.includes('#mainContent .child-toolbar.expanded .child-date-row .date-input'), 'The account date-field correction must not remove child-item date sizing.');

const profileStatusStart = html.indexOf('<span id="profileSaveStatus"');
const profileStatusEnd = html.indexOf('</span>', profileStatusStart);
const profileStatusMarkup = profileStatusStart >= 0 && profileStatusEnd > profileStatusStart ? html.slice(profileStatusStart, profileStatusEnd) : '';
assert.ok(profileStatusMarkup.includes('ui.accountMessageKey?tr(ui.accountMessageKey)'), 'Profile status must be rendered from a translation key so changing language updates the existing message.');
assert.ok(html.includes("profileSaved:'Profile saved.'") && html.includes("profileSaved:'تم حفظ الملف الشخصي.'"), 'Profile saved status must have English and Arabic translations.');
const saveProfileStart = html.indexOf('async function saveCurrentProfile(form){');
const saveProfileEnd = html.indexOf('let currentPasswordVerificationSequence=', saveProfileStart);
assert.ok(saveProfileStart >= 0 && saveProfileEnd > saveProfileStart, 'Profile save handler must exist as one bounded function.');
const saveProfileSource = html.slice(saveProfileStart, saveProfileEnd);
const validationPosition = saveProfileSource.indexOf('if(!payload.name||!payload.role)');
const savingPosition = saveProfileSource.indexOf('ui.accountSaving=true');
assert.ok(validationPosition >= 0 && savingPosition > validationPosition, 'Client-side validation must complete before entering the saving state.');
assert.ok(saveProfileSource.includes('ui.accountProfileDraft=payload;'), 'Profile edits must remain in the form draft when the API rejects invalid data.');
assert.ok(saveProfileSource.includes('finally{') && saveProfileSource.includes('ui.accountSaving=false;') && saveProfileSource.includes('activeButton.disabled=false;'), 'The profile saving state and submit button must always be released in finally, including rejected API requests.');
assert.ok(saveProfileSource.includes("activeButton.innerHTML=`${icon('check',13)} ${esc(tr('saveProfile'))}`;"), 'After any save outcome, the submit button must return to its localized Save label.');
const preferenceStart = html.indexOf('async function changeUserPreference(key,value){');
const preferenceEnd = html.indexOf('function render(){', preferenceStart);
assert.ok(preferenceStart >= 0 && preferenceEnd > preferenceStart, 'The user preference handler must exist.');
assert.ok(html.slice(preferenceStart, preferenceEnd).includes("if(key==='lang'){ui.lang=value;render();}"), 'Changing language must re-render the profile so success and error message keys are translated immediately.');
assert.ok(!html.includes('id="sidebarSearchTab"') && !html.includes('class="sidebar-mode-tabs"') && !html.includes("$('#sidebarSearchTab')") && !html.includes("case 'sidebar-mode':"), 'The redundant Search tab button is removed from the expanded Projects & Jobs sidebar.');


const dateControlDesktop = dateRangeCss.match(/#accountPage \.account-search-date-range > \.account-search-field > input\[type="date"\]\{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(dateControlDesktop.includes('height:40px !important;') && dateControlDesktop.includes('min-height:40px !important;') && dateControlDesktop.includes('max-height:40px !important;'), 'Profile date controls must match the 40px account-filter control height.');
assert.ok(dateControlDesktop.includes('font-size:12px !important;'), 'Date values must use the same 12px desktop text scale as the other account filters.');
const dateMobileStart = dateRangeCss.indexOf('@media (max-width:820px)');
const dateMobileEnd = dateRangeCss.indexOf('@media (max-width:360px)', dateMobileStart);
assert.ok(dateMobileStart >= 0 && dateMobileEnd > dateMobileStart, 'Mobile-specific date presentation rules must exist independently of the narrow-screen layout.');
const dateMobileCss = dateRangeCss.slice(dateMobileStart, dateMobileEnd);
assert.ok(dateMobileCss.includes('font-size:16px !important;') && dateMobileCss.includes('text-align:center !important;'), 'Mobile date values must retain the no-zoom font size and use centered text alignment.');
assert.ok(dateMobileCss.includes('::-webkit-date-and-time-value') && dateMobileCss.includes('::-webkit-datetime-edit'), 'Mobile text alignment must cover the WebKit native date value and editable date segments.');
const buttonBaseStart = html.indexOf('.btn{');
const buttonBaseEnd = html.indexOf('.btn svg', buttonBaseStart);
const buttonBaseCss = html.slice(buttonBaseStart, buttonBaseEnd);
assert.ok(buttonBaseStart >= 0 && buttonBaseEnd > buttonBaseStart && !buttonBaseCss.includes('transform') && !buttonBaseCss.includes('translate'), 'Buttons must not move or animate with a translate transform on hover.');
const summaryTileStart = html.indexOf('.summary-tile-button{');
const summaryTileEnd = html.indexOf('#childrenSection', summaryTileStart);
const summaryTileCss = html.slice(summaryTileStart, summaryTileEnd);
assert.ok(summaryTileStart >= 0 && summaryTileEnd > summaryTileStart && !summaryTileCss.includes('transform') && !summaryTileCss.includes('translate'), 'Clickable summary tiles must not move on hover or press.');

const followupCardStart = html.indexOf('function childCard(');
const followupCardEnd = html.indexOf('function ', followupCardStart + 12);
const followupCardSource = html.slice(followupCardStart, followupCardEnd);
assert.ok(followupCardSource.includes("auditLabel(item,'mini-updated')"), 'Workspace child cards must restore the Last updated label.');
assert.ok(followupCardSource.includes("item.type!=='followup'?statusPill(item.status):''"), 'Follow-up cards must not render status.');
assert.ok(followupCardSource.includes("item.type!=='followup'&&item.dueDate"), 'Follow-up cards must not render due dates.');
assert.ok(html.includes('id="formStatusField"') && html.includes('id="formDueDateField"'), 'The editor must expose switchable status and due-date field wrappers.');
assert.ok(html.includes("function syncTypeSpecificFields(type)") && html.includes("st.value='not-started'"), 'Switching from Follow-up to Task must initialize Task status to Not Started.');
assert.ok(html.includes("type==='followup'?'':String(fd.get('status')||'not-started')") && html.includes("type==='followup'?'':String(fd.get('dueDate')||'')"), 'Follow-up submission must omit status and due date.');
assert.ok(html.includes("delete item.status;delete item.dueDate;"), 'Task-to-Follow-up conversion must remove stale task-only properties.');
assert.ok(html.includes("matchesItemStatusFilter(item,filter)"), 'Status filtering must distinguish Follow-ups, which have no status.');
assert.ok(html.includes("child.type!=='task'||child.status==='completed'"), 'Not Completed metrics must count Tasks only and must not infer a Follow-up status.');
assert.ok(html.includes("item.type==='followup'?'':'<span class=\"account-assigned-due\""), 'Assigned Items must not render a due date for Follow-ups.');
assert.ok(html.includes("item.type==='task'?' data-history-scope=\"item\"'"), 'Only Assigned Items Tasks should explicitly request item-only history.');
assert.ok(html.includes("set('justify-content', 'center');") &&
  html.includes("set('left', '0');") &&
  html.includes("set('right', '0');") &&
  html.includes('#scrollToTopPositioner {') &&
  html.includes('justify-content:center!important'),
  'The scroll-to-top control must use a full-width viewport flex host for horizontal centering.');

assert.ok(html.includes("function dateModeOptionsMarkup(current,includeDue=true)") && html.includes("value==='due'&&!includeDue?'disabled class=") && html.includes('is-filter-inapplicable-option'), 'Due-date filter options must remain visible but dimmed and disabled when the selected item type does not support due dates.');
assert.ok(html.includes("ui.childType==='followup'?'disabled':''") && html.includes("ui.accountAssignedType==='followup'?'disabled':''"), 'Status filters must be disabled when Follow-up is the selected type.');
assert.ok(html.includes("dateModeOptionsMarkup(ui.childDateMode,!isFollowup)") && html.includes("dateModeOptionsMarkup(ui.accountAssignedDateMode,ui.accountAssignedType!=='followup')"), 'Workspace and Assigned Items must retain a dimmed Due date option for Follow-ups.');
assert.ok(html.includes("if(ui.childType!=='followup'&&!matchesItemStatusFilter(child,ui.childStatus))return false;") && html.includes("if(!(type==='followup'&&item.type==='followup')&&!matchesItemStatusFilter(item,status))return false;"), 'Status selections must be preserved but ignored while Follow-up is selected.');
assert.ok(html.includes("ui.accountAssignedDateMode==='due'") && html.includes("ui.childDateMode==='due'"), 'Selecting Follow-up must reset an inapplicable Due date sort to Last updated.');
assert.ok(html.includes("unfinished.disabled=ui.childType==='followup'") && html.includes("if(ui.childType!=='followup')ui.childStatus="), 'The Not Completed metric must be disabled for Follow-ups, which have no status.');
assert.ok(html.includes("if(ui.childType==='followup'&&ui.childDateMode==='due')return true;") && html.includes("if(!(type==='followup'&&item.type==='followup'&&dateMode==='due')&&!matchesDate(item,dateMode,dateFrom,dateTo,'application'))return false;"), 'Due-date filters must remain selected but be ignored while Follow-up is selected.');
assert.ok(html.includes('data-filter="not-completed" ${ui.childType===\'followup\'?\'disabled\':\'\'} type="button"'), 'The Not Completed metric must be disabled in the initial Follow-up view.');
assert.ok(html.includes("ui.childDateFrom='';ui.childDateTo=''") && html.includes("ui.accountAssignedDateFrom='';ui.accountAssignedDateTo='';"), 'Switching from Due date to a supported Follow-up date mode must clear stale Due-date ranges.');
assert.ok(html.includes("${parent.type==='project'?`") && html.includes("data-filter=\"not-completed\""), 'Jobs must not render a Not Completed metric because their children are Follow-ups without status.');

assert.ok(html.includes("item?.updatedBy||item?.updatedByUserId||item?.updatedById||item?.createdBy||item?.createdByUserId"), 'Last updated labels must resolve updater metadata across API and local item shapes.');
const childCardStart=html.indexOf('function childCard(');
const childCardEnd=html.indexOf('\nfunction renderOverview',childCardStart);
assert.ok(childCardStart>=0&&childCardEnd>childCardStart,'The workspace child-card renderer must exist.');
const childCardSource=html.slice(childCardStart,childCardEnd);
const auditRowIndex=childCardSource.indexOf('<div class="child-last-updated-row">');
const nestedSectionIndex=childCardSource.indexOf("${item.type==='task'?");
assert.ok(auditRowIndex>nestedSectionIndex&&nestedSectionIndex>=0,
  'Child Last updated must be rendered after the nested section, at the bottom of the item card.');
const finalPositionStart=html.lastIndexOf('<style id="scroll-to-top-final-position">');
const finalPositionEnd=html.indexOf('</style>',finalPositionStart);
assert.ok(finalPositionStart>=0&&finalPositionEnd>finalPositionStart,'The final floating-control stylesheet must exist.');
const finalPositionCss=html.slice(finalPositionStart,finalPositionEnd);
assert.ok(finalPositionCss.includes('#mainContent .child-card .child-last-updated-row .mini-updated{') &&
  finalPositionCss.includes('display:inline-flex!important') &&
  finalPositionCss.includes('direction:ltr!important') &&
  finalPositionCss.includes('justify-content:flex-end!important') &&
  finalPositionCss.includes('text-align:right!important'),
  'Child Last updated must remain visible and aligned to the physical bottom-right of each item card.');
assert.ok(html.includes('id="childStatusFilterField"') && html.includes('child-filter-field'), 'The workspace status filter must have a type-aware field wrapper.');
assert.ok(html.includes('id="childStatusFilterField"') && html.includes("class=\"child-filter-field ${isJob||ui.childType==='followup'?'is-filter-inapplicable':''}\""), 'The workspace status filter must remain visible and dimmed when Follow-ups are selected or the current parent is a Job.');
assert.ok(html.includes("class=\"account-search-field account-search-status-field ${ui.accountAssignedType==='followup'?'is-filter-inapplicable':''}\""), 'The Assigned Items status filter must remain visible and dimmed for Follow-ups.');
assert.ok(html.includes("const assignedTask=item.type==='task'&&ui.accountTab==='assigned'"), 'Task history opened from Assigned Items must default to this task only, independent of the outer page state.');
assert.ok(html.includes("item.type==='task'?' data-history-scope=\"item\"':''"), 'Only Assigned Items Tasks should explicitly request item-only history.');
assert.ok(html.includes('top:calc(68px + 4px + env(safe-area-inset-top,0px))!important'), 'The mobile back-to-top button must sit with a clear gap below the fixed 68px header.');
assert.ok(html.includes("const workflowSearch=item.type==='followup'?'':[statusName(item.status,'en'),statusName(item.status,'ar')].join(' ');"), 'Workspace Assigned-list search must not match Follow-ups using legacy status values.');


// Follow-up workflow regression checks: status and due date exist only for
// Projects, Jobs, and Tasks, and type changes update the form immediately.
assert.ok(html.includes("...(type==='followup'?{}:{status,dueDate})"),
  'New Follow-ups must omit status and dueDate from the persisted item shape.');
assert.ok(html.includes("if(type==='followup'){delete item.status;delete item.dueDate;}"),
  'Editing or converting an item to Follow-up must remove both Task workflow attributes.');
assert.ok(html.includes("if(oldType==='followup'){item.status=status||'not-started';changed.push('status');item.dueDate=dueDate;if(dueDate)changed.push('due date');}"),
  'Follow-up-to-Task conversion must restore the selected status and due date and include them in the audit change set.');
assert.ok(html.includes("dateModeOptionsMarkup(ui.childDateMode,!isJob&&ui.childType!=='followup')"),
  'Workspace child filters must keep Due date visible but disabled while Follow-up is selected.');
assert.ok(html.includes("dateModeOptionsMarkup(ui.accountAssignedDateMode,ui.accountAssignedType!=='followup')"),
  'Assigned Items filters must keep Due date visible but disabled while Follow-up is selected.');
assert.ok(html.includes('followup-filter-mode') && html.includes('account-assigned-controls'), 'Assigned Items must retain its Follow-up-specific filter layout.');
assert.ok(finalPositionCss.includes('#modalRoot #formStatusField[hidden]') &&
  finalPositionCss.includes('#modalRoot #formDueDateField[hidden]') &&
  finalPositionCss.includes('display:none!important'),
  'Hidden type-specific form controls must be removed from layout, not merely disabled.');
assert.ok(finalPositionCss.includes('#accountPage .account-assigned-controls.followup-filter-mode') &&
  finalPositionCss.includes('"type status"'),
  'Follow-up Assigned Items filters must keep the dimmed Status control in the mobile grid.');
assert.ok(html.includes("const assignedTask=item.type==='task'&&ui.accountTab==='assigned';") &&
  html.includes("item.type==='task'?' data-history-scope=\"item\"':''"),
  'Assigned Task activity history must explicitly open with This item only selected.');

// Exercise the exact form type-change helper for both directions.
const typeSyncStart=html.indexOf('function syncTypeSpecificFields(type){');
const typeSyncEnd=html.indexOf('\n function syncAssigneeControl',typeSyncStart);
assert.ok(typeSyncStart>=0&&typeSyncEnd>typeSyncStart,'The type-specific form synchronizer must exist.');
const typeSyncNodes=new Map([
  ['#formStatusField',{hidden:false}],
  ['#formStatus',{disabled:false,value:'completed'}],
  ['#formDueDateField',{hidden:false}],
  ['#formDueDate',{disabled:false,value:'2026-11-20'}]
]);
const typeSyncContext={$:selector=>typeSyncNodes.get(selector)||null};
vm.runInNewContext(html.slice(typeSyncStart,typeSyncEnd)+'\nthis.syncTypeSpecificFields=syncTypeSpecificFields;',typeSyncContext);
typeSyncContext.syncTypeSpecificFields('followup');
assert.equal(typeSyncNodes.get('#formStatusField').hidden,true);
assert.equal(typeSyncNodes.get('#formStatus').disabled,true);
assert.equal(typeSyncNodes.get('#formDueDateField').hidden,true);
assert.equal(typeSyncNodes.get('#formDueDate').disabled,true);
assert.equal(typeSyncNodes.get('#formDueDate').value,'',
  'Switching to Follow-up must clear and disable the Task-only due date.');
typeSyncContext.syncTypeSpecificFields('task');
assert.equal(typeSyncNodes.get('#formStatusField').hidden,false);
assert.equal(typeSyncNodes.get('#formStatus').disabled,false);
assert.equal(typeSyncNodes.get('#formStatus').value,'not-started',
  'Switching back to Task must restore the status control with its default.');
assert.equal(typeSyncNodes.get('#formDueDateField').hidden,false);
assert.equal(typeSyncNodes.get('#formDueDate').disabled,false,
  'Switching back to Task must restore the due-date control.');

assert.ok(finalPositionCss.includes('#scrollToTopPositioner {') &&
  finalPositionCss.includes('display:flex!important') &&
  finalPositionCss.includes('justify-content:center!important') &&
  finalPositionCss.includes('#scrollToTopPositioner>.scroll-to-top') &&
  finalPositionCss.includes('position:relative!important') &&
  finalPositionCss.includes('transform:none!important'),
  'The top control must be centered by a full-width fixed flex host, not by a button offset or transform.');
assert.ok(finalPositionCss.includes('top:calc(76px + 2px + env(safe-area-inset-top,0px))!important') &&
  finalPositionCss.includes('top:calc(68px + 4px + env(safe-area-inset-top,0px))!important'),
  'The scroll-to-top control must sit below the fixed header at both desktop and mobile breakpoints.');


// Assignee labels use singular/plural forms everywhere they identify an item's
// assignee count, and Follow-ups keep their type, priority, and parent on one row.
assert.ok(html.includes("function assigneeLabelKey(count){return Number(count)===1?'assignee':'assignees';}"),
  'Assignee labels must be singular for one person and plural for zero or multiple people.');
assert.ok(html.includes("assigneeMarkup(parent)") && html.includes("const labelKey=assigneeLabelKey(ids.length);"),
  'Parent-item assignee labels must use the same count-aware wording as child items.');
assert.ok(html.includes('id="formAssigneeLabel"') && html.includes("tr(assigneeLabelKey(mode==='all'?assignableUsers().length:selected.length))"),
  'The item form must update its Assignee/Assignees label as the selection changes.');
assert.ok(!html.includes("tr('assignedTo')"),
  'Item ownership labels must no longer render the legacy “Assigned to” wording.');
assert.ok(html.includes('account-assigned-followup-row') &&
  html.includes("priorityPill(item.priority||'medium')") &&
  html.includes('data-parent-context-name=') &&
  html.includes("esc(parentName)+'</bdi></button>'"),
  'Assigned and Pinned Follow-ups must render Type, Priority, and a clickable parent name in one metadata row.');
assert.ok(html.includes('.account-assigned-followup-row .account-assigned-parent-name') &&
  html.includes('text-overflow:ellipsis!important'),
  'The single Follow-up metadata row must remain readable on narrow account cards.');

// Exercise the actual global-name preflight against every active root and Archive.
const nameValidationStart=html.indexOf('async function validateUniqueItemName(name,exceptId,form){');
const nameValidationEnd=html.indexOf('\nasync function handleItemSubmit(form){',nameValidationStart);
assert.ok(nameValidationStart>=0&&nameValidationEnd>nameValidationStart,
  'The asynchronous, paginated item-name preflight must exist before the submit handler.');
const nameValidationSource=html.slice(nameValidationStart,nameValidationEnd)+'\nthis.validateUniqueItemName=validateUniqueItemName;';
async function runNameValidation(routes,name,exceptId=''){
  const calls=[],messages=[];
  const context={
    window:{TeamFollowUpDataApi:{request:async(method,path)=>{
      calls.push({method,path});
      const parsed=new URL(path,'https://test.invalid');
      const route=routes[parsed.pathname];
      if(typeof route==='function')return route(Number(parsed.searchParams.get('offset')||0),method,path,parsed.searchParams);
      if(route!==undefined)return route;
      return {items:[],nextOffset:null};
    }}},
    URLSearchParams,
    $:()=>null,
    toast:(message)=>messages.push(message),
    tr:key=>key,
    console:{error:()=>{}}
  };
  vm.runInNewContext(nameValidationSource,context);
  const form={dataset:{},querySelectorAll:()=>[],querySelector:()=>null};
  const valid=await context.validateUniqueItemName(name,exceptId,form);
  return {valid,calls,messages,form};
}
const activeDuplicate=await runNameValidation({
  '/items':(offset,method,path,params)=>{
    if(params.get('scope')==='top-level')return {items:[{id:'root-1',name:'Root'}],nextOffset:null};
    if(params.get('rootParentId')==='root-1')return {items:[{id:'active-1',name:'  OPS   PLAN '}],nextOffset:null};
    return {items:[],nextOffset:null};
  }
},'ops plan');
assert.equal(activeDuplicate.valid,false,
  'Case and whitespace variants must be rejected against active child items.');
assert.deepEqual(activeDuplicate.messages,['nameTaken']);
const archivedDuplicate=await runNameValidation({
  '/items':(offset,method,path,params)=>params.get('scope')==='top-level'?{items:[],nextOffset:null}:{items:[],nextOffset:null},
  '/archive':{items:[{archiveId:'archived-1',name:'Ｒｅｐｏｒｔ'}],nextOffset:null}
},'Report');
assert.equal(archivedDuplicate.valid,false,
  'Unicode NFKC-equivalent names must be rejected against archived items.');
assert.ok(archivedDuplicate.calls.some(call=>call.path.startsWith('/archive?')),
  'Name validation must include archived records, not only currently active items.');
const selfEdit=await runNameValidation({
  '/items':(offset,method,path,params)=>{
    if(params.get('scope')==='top-level')return {items:[{id:'root-1',name:'Root'}],nextOffset:null};
    if(params.get('rootParentId')==='root-1')return {items:[{id:'current-item',name:'Existing Name'}],nextOffset:null};
    return {items:[],nextOffset:null};
  },
  '/archive':{items:[],nextOffset:null}
},' existing   name ','current-item');
assert.equal(selfEdit.valid,true,
  'Editing an item without changing its normalized name must exclude that item itself.');
const paginatedDuplicate=await runNameValidation({
  '/items':(offset,method,path,params)=>{
    if(params.get('scope')==='top-level')return {items:[{id:'root-1',name:'Root'}],nextOffset:null};
    if(params.get('rootParentId')==='root-1'&&offset===0)return {items:[],nextOffset:250};
    if(params.get('rootParentId')==='root-1')return {items:[{id:'late-item',name:'Later Match'}],nextOffset:null};
    return {items:[],nextOffset:null};
  }
},'later match');
assert.equal(paginatedDuplicate.valid,false,
  'Name validation must continue through subsequent active-root pages.');
assert.equal(paginatedDuplicate.calls.length,3);
const unavailableCheck=await runNameValidation({
  '/items':()=>{throw new Error('offline');}
},'New Item');
assert.equal(unavailableCheck.valid,false,
  'Name validation must fail closed when the active root list cannot be verified.');
assert.deepEqual(unavailableCheck.messages,['nameCheckFailed']);
assert.ok(html.includes("if(!(await validateUniqueItemName(name,currentId,form)))return;") &&
  html.includes('rollbackFailedItemMutation(mutation,isNew,previousItem);'),
  'The form must await global name validation and roll back optimistic writes rejected by the authoritative API.');

assert.ok(html.includes('"query query type status"') && html.includes('"type status"'), 'Follow-up mode must keep the Status filter in the desktop and mobile filter grids.');
const activePredicateStart=html.indexOf('function isActiveItem(item){');
const activePredicateEnd=html.indexOf('\n}',activePredicateStart);
assert.ok(activePredicateStart>=0&&activePredicateEnd>activePredicateStart,'The shared active-item predicate must exist.');
const activePredicate=html.slice(activePredicateStart,activePredicateEnd);
assert.ok(activePredicate.includes('recentlyArchivedItemIds')&&activePredicate.includes('archiveId')&&activePredicate.includes('archivedAt')&&activePredicate.includes('deletedAt'),'Archived and deleted records must be excluded from every account view.');
assert.ok(html.includes('ui.accountAssignedLoaded=false;ui.accountPinnedLoaded=false;'),'Deleting an item must invalidate cached Assigned and Pinned results so they are reloaded from active records.');
assert.ok(html.includes("function accountSearchResultsMarkup(){")&&html.includes("(data.parents||[]).filter(item=>isActiveItem(item))"),'Profile Search must render only active parent items.');
const assignedFilterStart=html.indexOf('function filteredAccountAssignedItems(){');
const assignedFilterEnd=html.indexOf('\nfunction accountAssignedSectionVisibility(',assignedFilterStart);
assert.ok(assignedFilterStart>=0&&assignedFilterEnd>assignedFilterStart&&html.slice(assignedFilterStart,assignedFilterEnd).includes('.filter(item=>isActiveItem(item))'),'Assigned Items filtering must reject archived records.');
assert.ok(html.includes('const activePinnedRows=(ui.accountPinnedRows||[]).filter(isActiveItem)'),'Pinned Items rendering must reject archived records even before a reload completes.');



// Follow-up assignments are optional; an explicit None must not be rejected
// by the item form or by any follow-up-specific submission guard.
const itemSubmitStart=html.indexOf('async function handleItemSubmit(form){');
const itemSubmitEnd=html.indexOf('\nfunction clearParentFilters()',itemSubmitStart);
assert.ok(itemSubmitStart>=0&&itemSubmitEnd>itemSubmitStart,'The shared item submit handler must exist.');
const itemSubmitSource=html.slice(itemSubmitStart,itemSubmitEnd);
assert.ok(!itemSubmitSource.includes("if(type==='followup'&&!assigneeIds.length)"),
  'Follow-ups must be allowed to have no assignees.');

// Parent/Task status invariants are enforced in the form, mutation path, and
// child-creation path, while the backend independently validates persisted state.
assert.ok(html.includes("const itemHasChildren=!!(item&&childrenOf(item.id).length);const status=item?.status==='not-started'&&itemHasChildren?'in-progress':"),
  'An item with children must not open its editor with Not started selected.');
assert.ok(itemSubmitSource.includes("if(type!=='followup'&&childrenOf(item.id).length&&status==='not-started')status='in-progress'"),
  'Saving an item with children must normalize Not started to In progress.');
assert.ok(
  itemSubmitSource.includes("const previousParent=p.status==='not-started'?copyWorkspace(p):null") ||
  itemSubmitSource.includes("const previousParent=!serverManagedParentActivation&&p.status==='not-started'?copyWorkspace(p):null"),
  'The demo client must promote a Not started parent locally, while the AWS client delegates activation to the transactional API.');
assert.ok(itemSubmitSource.includes("p.status='in-progress'") &&
  (itemSubmitSource.includes("serverManagedParentActivation=api?.mode==='api'") || itemSubmitSource.includes('persistItemMutation(p,false,parentStatusEvents,previousParent)')),
  'Child creation must switch a Not started parent to In progress locally or through the server-managed path.');

// Deleting an item must refresh the visible Assigned/Pinned account tab after
// the archive/pin writes finish, even when no list request was active at delete time.
assert.ok(html.includes("void Promise.all([Promise.resolve(deleteWrite),pinsWrite]).then(()=>{if(ui.page!=='account')return;if(ui.accountTab==='assigned'") &&
  html.includes("else if(ui.accountTab==='pinned'&&!ui.accountPinnedLoading)void loadAccountPinnedItems();"),
  'Archive completion must trigger a fresh authoritative Assigned or Pinned read for the active account tab.');
assert.ok(!html.includes('if(wasAssignedLoading)') && !html.includes('if(wasPinnedLoading)'),
  'Account-list refresh after delete must not depend on whether a request happened to be loading.');
assert.ok(html.includes("(data.parents||[]).filter(item=>isActiveItem(item))") &&
  html.includes(".filter(item=>isActiveItem(item))"),
  'Profile Search and Assigned Items must render from active item collections only.');

// The status and due-date filters remain present but dimmed when Follow-up is selected.
assert.ok(html.includes("class=\"child-filter-field ${isJob||ui.childType==='followup'?'is-filter-inapplicable':''}\"") &&
  html.includes("class=\"account-search-field account-search-status-field ${ui.accountAssignedType==='followup'?'is-filter-inapplicable':''}\""),
  'Workspace and Assigned Items keep the inapplicable Status controls visible and dimmed.');
assert.ok(!html.includes("id=\"childStatusFilterField\" hidden") && !html.includes("id=\"accountAssignedStatus\" hidden"),
  'Selecting Follow-up must not remove non-relevant filter controls.');

// Job overview edits jump only when the edited card changes index under the
// currently active filter; generic item jumps are centered on desktop.
assert.ok(html.includes('function jobOverviewChildOrder(parentId){') &&
  html.includes('const oldJobPosition=Array.isArray(oldJobOrder)?oldJobOrder.indexOf(String(item.id)):-1;') &&
  html.includes('newJobPosition!==oldJobPosition') &&
  html.includes('alignWorkspaceItemInViewport(movedCard)'),
  'Job overview editing must compare pre/post filtered order and jump only when the card moves.');
assert.ok(html.includes("function alignWorkspaceItemInViewport(target,itemId='',{alignToTop=false,highlight=true}={}){") &&
  html.includes('viewportCenter=usableTop+(usableBottom-usableTop)/2') &&
  html.includes('window.scrollY+targetCenter-viewportCenter'),
  'Item jumps must center the target in the usable desktop viewport.');
assert.ok(html.includes('const delta=alignToTop||!desktop?rect.top-(usableTop+12):targetCenter-viewportCenter;') &&
  html.includes('if(desktop&&!alignToTop){') &&
  html.includes("alignToTop:isRootItem,highlight:item.type!=='project'"),
  'Job root redirects align the actual detail-card start below the header; ordinary item jumps retain desktop centering.');
assert.ok(html.includes('window.scrollY+rect.top-headerBottom-12'),
  'Mobile item jumps must preserve top alignment below the fixed header.');
assert.ok(html.includes("alignWorkspaceItemInViewport(selectedTarget,isRootItem?'':selectedItemId,{alignToTop:isRootItem,highlight:item.type!=='project'})") &&
  html.includes("const rootTarget=document.querySelector('#mainContent .detail-card')||document.querySelector('#mainContent .detail-banner');alignWorkspaceItemInViewport(rootTarget,'',{alignToTop:parent.type==='job'||parent.type==='project',highlight:parent.type!=='project'})"),
  'Parent, assigned, and pinned destinations must use the same item-aware navigation.');
assert.ok(html.includes('workspace-jump-highlight') &&
  html.includes('consistent-card-hover-and-jump-highlight') &&
  html.includes(':hover{') ,
  'Cards must share a consistent hover highlight and temporary jump highlight.');
assert.ok(finalPositionCss.includes('justify-content:center!important') &&
  finalPositionCss.includes('top:calc(68px + 4px + env(safe-area-inset-top,0px))!important') &&
  finalPositionCss.includes('inset-inline-end:0!important'),
  'The back-to-top flex host must center the button and remain below the mobile header.');

const parentJumpStart=html.indexOf("case 'select-parent':");
const parentJumpEnd=html.indexOf("case 'select-assigned':",parentJumpStart);
assert.ok(parentJumpStart>=0&&parentJumpEnd>parentJumpStart&&html.slice(parentJumpStart,parentJumpEnd).includes("alignWorkspaceItemInViewport(rootTarget,'',{alignToTop:parent.type==='job'||parent.type==='project',highlight:parent.type!=='project'})"),'Selecting a parent aligns Job items to the beginning and preserves the existing Project behavior.');


const accountSearchMatcherStart=html.indexOf('function accountSearchUserMatches(item,userId){');
const accountSearchMatcherEnd=html.indexOf('function accountSearchResultsMarkup(){',accountSearchMatcherStart);
assert.ok(accountSearchMatcherStart>=0&&accountSearchMatcherEnd>accountSearchMatcherStart&&html.slice(accountSearchMatcherStart,accountSearchMatcherEnd).includes("const ids=itemAssigneeIds(item);if(wanted==='none')return ids.length===0;return ids.includes(wanted);"),'Profile Search filters by assigned users and supports None.');
assert.ok(html.includes("accountSearchUserLabel:'Assignee'")&&html.includes("accountSearchNoneAssignee:'None'")&&html.includes("assignableUsers().slice().sort("),'Profile Search labels the filter Assignee, offers None, and excludes root/system users.');
assert.ok(html.includes("ui.accountAssignedType==='project'||ui.accountAssignedType==='job'?'disabled':''")&&html.includes("if(ui.accountAssignedType==='project'||ui.accountAssignedType==='job')ui.accountAssignedPriority='all';"),'Assigned Items disables and resets Priority for Project and Job type selections.');
assert.ok(html.includes("workspaceTitle:'WORKSPACE'")&&html.includes("accountHubTitle:'USERSPACE'")&&html.includes("$('#workspaceTitle').hidden=ui.page!=='account';"),'Workspace and account headers use WORKSPACE and USERSPACE.');
assert.ok(html.includes("pendingTasks:'Pending Tasks'")&&html.includes("tr('pendingTasks')"),'Project overview labels its incomplete task metric Pending Tasks.');
const overviewRegressionStart=html.indexOf('function renderOverview(parent,summary=null){');
const overviewRegressionEnd=html.indexOf('\nfunction childTreeFiltered(parent){',overviewRegressionStart);
const overviewRegression=html.slice(overviewRegressionStart,overviewRegressionEnd);
assert.ok(overviewRegression.includes("const summaryCards=isJob?`\u0024{followupsCard}\u0024{urgentCard}\u0024{highCard}`"),'Job overview orders Follow-ups, Urgent, then High.');
assert.ok(overviewRegression.includes("icon('zap',15)")&&!overviewRegression.includes("icon('alert-circle',15)"),'The Job High metric must use an icon present in the inline icon registry.');
assert.ok(overviewRegression.includes("const childTypeOptions=isJob?[['followup',tr('followup')]]")&&overviewRegression.includes("id=\"childTypeFilter\" aria-label=\"${esc(tr('type'))}\" ${isJob?'disabled':''}")&&overviewRegression.includes("dateModeOptionsMarkup(ui.childDateMode,!isJob&&ui.childType!=='followup')"),'Job overview locks Type to Follow-ups, disables Type and Status, and disables Due date.');
assert.ok(html.includes("else if(filter==='high')")&&html.includes("high?.setAttribute('aria-pressed',String(ui.childPriority==='high'))"),'The High overview card applies and reflects the High filter.');
assert.ok(html.includes(":root[data-theme=\"light\"] .priority-urgent {\n  color: #d33d51")&&html.includes(":root[data-theme=\"dark\"] .priority-urgent {\n  color: #ffadb9")&&html.includes("priority-pill.priority-urgent{\n color:#d33d51!important"),'Urgent labels use the brighter High-level colors in both themes and Assigned Items.');
const editJumpStart=html.indexOf('async function handleItemSubmit(form){');
const editJumpEnd=html.indexOf('\nfunction clearParentFilters()',editJumpStart);
const editJumpSource=html.slice(editJumpStart,editJumpEnd);
assert.ok(editJumpStart>=0&&editJumpEnd>editJumpStart&&editJumpSource.includes('if(overviewJobId){')&&!editJumpSource.includes('if(overviewJobId&&oldJobPosition>=0)')&&editJumpSource.includes('if(newJobPosition>=0&&newJobPosition!==oldJobPosition)'), 'Job edits jump when a child newly enters or changes position in the active filter, but not when its position is unchanged or it leaves the result set.');
assert.ok(html.includes("const overflowY=window.getComputedStyle(node).overflowY;")&&html.includes("scrollContainer.scrollTo({top,behavior:reduceMotion?'instant':'smooth'});"),'Item navigation scrolls the nearest scrollable ancestor when one exists.');
assert.ok(html.includes("let positioner = document.getElementById('scrollToTopPositioner');") &&
  html.includes("if (button.parentElement !== positioner) positioner.appendChild(button);") &&
  html.includes("set('justify-content', 'center');") &&
  html.includes("set('left', '0');") &&
  html.includes("set('right', '0');"),
  'The fixed top control must be reparented into a viewport-wide flex host and centered independently of text direction.');

assert.ok(html.includes("function findWorkspaceItemCard(itemId){")&&html.includes("data-item-id=\"${esc(item.id)}\"")&&html.includes("resolveAttempts<12"),'Workspace navigation resolves direct child cards by stable item ID after asynchronous rendering.');
assert.ok(html.includes("void target.offsetWidth")&&html.includes("workspaceJumpHighlightGeneration"),'Repeated navigation restarts an existing card highlight without stale timers clearing the new highlight.');
assert.ok(html.includes("allUsersOption:'All Members'")&&html.includes("allUsersOption:'كل الأعضاء'"),'The assignee All Users selection label is renamed to All Members in both languages.');
assert.ok(html.includes("${esc(tr('allPriorities'))}</option><option value=\"urgent\""),'The Assigned Items priority filter starts with All priorities.');
assert.ok(html.includes(".top-title strong.account-page-heading")&&html.includes("font-weight:750 !important")&&html.includes("text-align:start !important"),'USERSPACE uses the same eyebrow font weight, typography, and alignment as WORKSPACE.');
assert.ok(html.includes('#accountPage [dir="auto"]')&&html.includes('unicode-bidi: plaintext')&&html.includes('text-align: start !important;'),'Profile tabs inherit the workspace mixed Arabic/English direction and alignment rules.');


const assignedRowStart=html.indexOf('function accountAssignedItemRow(item){');
const assignedRowEnd=html.indexOf('\nfunction filteredAccountAssignedItems(){',assignedRowStart);
const assignedRowSource=html.slice(assignedRowStart,assignedRowEnd);
assert.ok(assignedRowStart>=0&&assignedRowEnd>assignedRowStart &&
  assignedRowSource.includes('data-parent-context-name=') &&
  assignedRowSource.includes('data-parent-context-parent-name=') &&
  assignedRowSource.includes("title=\"'+esc(parentName)+'\""),
  'The shared Assigned/Pinned card renderer must expose parent and ancestor names and a native hover tooltip.');
assert.ok(assignedRowSource.includes('parentRecord?.parentId') &&
  assignedRowSource.includes("parentId!==rootId?rootId:''"),
  'A Follow-up under a Task must resolve and expose the Project/Job above its immediate parent.');
assert.ok(html.includes('function toggleAccountParentContextPopup(trigger){') &&
  html.includes('function positionAccountParentContextPopup(trigger,popup){') &&
  html.includes('data-parent-context-close') &&
  html.includes("trigger.setAttribute('aria-expanded','true');"),
  'The parent context popup must be positioned, dismissible, and expose its expanded state accessibly.');
assert.ok(html.includes('.account-parent-context-popup{') &&
  html.includes('background:var(--panel)') &&
  html.includes('color:var(--text)') &&
  html.includes('border:1px solid var(--border)'),
  'The parent context popup must use the active theme surface, text, and border tokens.');
assert.ok(html.includes('#accountPage .account-assigned-item-row .account-item-copy .account-assigned-parent-name{') &&
  html.includes('flex:1 1 0%!important') && html.includes('text-overflow:ellipsis!important') &&
  html.includes('white-space:nowrap!important') && html.includes('text-align:start!important'),
  'Only the parent name must take the remaining line width and truncate with an ellipsis aligned to the selected UI direction.');
assert.ok(html.includes('account-assigned-work-arrow.is-rtl') &&
  html.includes('transform:scaleX(-1)!important') &&
  html.includes("(ui.lang==='ar'?' is-rtl':'')"),
  'Open in workspace must mirror its directional arrow in Arabic.');
assert.ok(html.includes('rows.map(accountAssignedItemRow)') &&
  html.includes('function accountAssignedSectionMarkup(key,rows){'),
  'Assigned and Pinned Items must reuse the same parent-context card renderer.');


assert.ok(html.includes('parentContextRootLabel:"Grand Parent Item"') && html.includes("parentContextRootLabel:'العنصر الأعلى'"), 'English popup label is Grand Parent Item and Arabic translation remains unchanged.');
assert.ok(html.includes('<bdi dir="auto">') && html.includes('data-parent-context-parent-name=') && html.includes('<strong><bdi dir="auto">'), 'Assigned/Pinned parent names and popup values isolate mixed-direction text.');
assert.ok(html.includes('job-overview-summary-grid') && html.includes('>[data-filter="direct-followups"]') && html.includes('grid-template-columns:repeat(2,minmax(0,1fr))'), 'Mobile Job overview hides Follow-ups and places Urgent and High side by side.');
assert.ok(html.includes('<bdi dir="auto">') && html.includes('function auditLabel(item,extraClass=') && html.includes('unicode-bidi:isolate'), 'Last-updated labels isolate timestamps and names to prevent mixed-direction reordering.');
assert.ok(html.includes('.tree-task-row{display:grid!important;') && html.includes('.tree-task-wrap .tree-child-row,.tree-direct{display:block!important;') && html.includes('.tree-task-wrap .tree-child-main,.tree-direct-main{display:grid!important;'), 'Mobile timeline hierarchy uses explicit grid rows and block wrappers to prevent overlap.');
// RTL alignment and final cascade regression coverage.
assert.ok(html.includes("textDir=ui.lang==='ar'?'rtl':'ltr'") && html.includes('class="mini-updated" dir="${'),
  'Last-updated controls must explicitly follow the selected interface direction.');
assert.ok(html.includes('.account-parent-context-row>strong>bdi[dir="auto"]') &&
  html.includes('.account-assigned-item-row .account-item-copy .account-assigned-parent-name>bdi{') &&
  html.includes('<bdi dir="') && html.includes("ui.lang==='ar'?'rtl':'ltr'"),
  'Assigned/Pinned parent names must use the selected English/Arabic direction and block alignment in the card and popup.');
assert.ok(html.includes('<style id="timeline-mobile-edit-placement-and-jump-highlight-override">') &&
  html.includes('@media(max-width:820px)') &&
  html.includes('.tree-task-row{') &&
  html.includes('padding-inline-end:74px!important') &&
  html.includes('.tree-task-row>.tree-task-edit{') &&
  html.includes('position:absolute!important') &&
  html.includes('inset-inline-end:0!important') &&
  html.includes('.tree-task-row>.status-pill{'),
  'Mobile timeline reserves the action width and pins Edit at the top inline-end across the full mobile breakpoint.');
assert.ok(html.includes('@media(min-width:701px)') &&
  html.includes('.tree-created-meta .creator-line>.avatar') &&
  html.includes('flex:0 0 16px!important') &&
  html.includes('align-items:center!important'),
  'Desktop timeline creator icons must be compact and aligned with their metadata text.');
assert.ok(html.includes('.priority-pill.priority-urgent::before') &&
  html.includes('.priority-urgent-icon') &&
  html.includes('class="priority-urgent-icon"') &&
  html.includes('border:1px solid currentColor') &&
  !html.includes('border:2px solid currentColor!important'),
  'Urgent must use the standard priority frame while the Job overview reuses its circular exclamation marker.');

const pinnedCardStart = html.indexOf('function accountItemRow(item){');
const pinnedCardEnd = html.indexOf('async function hydrateAccountAssignedParentNames', pinnedCardStart);
assert.ok(pinnedCardStart >= 0 && pinnedCardEnd > pinnedCardStart, 'Pinned account-card rendering must remain available.');
const pinnedCardSource = html.slice(pinnedCardStart, pinnedCardEnd);
assert.ok(pinnedCardSource.includes("ui.lang==='ar'?'rtl':'ltr'") &&
  pinnedCardSource.includes('title="${esc(item.name||id)}"'),
  'Pinned item titles must align to the selected UI direction and expose the full name on hover.');

const assignedParentStart = html.indexOf('const parentNameMarkup=');
const assignedParentEnd = html.indexOf('function filteredAccountAssignedItems()', assignedParentStart);
assert.ok(assignedParentStart >= 0 && assignedParentEnd > assignedParentStart, 'Assigned item-card rendering must remain available.');
const assignedParentSource = html.slice(assignedParentStart, assignedParentEnd);
assert.ok(assignedParentSource.includes("ui.lang==='ar'?'rtl':'ltr'") &&
  assignedParentSource.includes("title=\"'+esc(parentName)+'\"") &&
  assignedParentSource.includes("class=\"account-assigned-parent-name\" dir=\"'+(ui.lang==="),
  'Assigned item and parent-context titles must use the selected UI direction.');

assert.ok(html.includes('#accountPage .account-item-row .account-item-copy>strong{') &&
  html.includes('white-space:normal!important') && html.includes('overflow:visible!important') &&
  html.includes('text-overflow:clip!important') && html.includes('overflow-wrap:anywhere!important'),
  'Assigned and Pinned item names must remain fully visible and wrap over multiple lines.');

assert.ok(html.includes('html[dir="rtl"] #mainContent .child-card .child-last-updated-row') &&
  html.includes('justify-content:flex-start!important'),
  'Arabic child-card Last updated labels must move to the physical left without changing their text formatting.');

const timelineOverrideStart=html.indexOf('<style id="timeline-mobile-edit-placement-and-jump-highlight-override">');
const timelineOverrideEnd=html.indexOf('</style>',timelineOverrideStart);
const timelineOverride=html.slice(timelineOverrideStart,timelineOverrideEnd);
assert.ok(timelineOverrideStart>=0 && timelineOverrideEnd>timelineOverrideStart &&
  timelineOverride.includes('@media(max-width:820px)') &&
  timelineOverride.includes('.tree-task-row.is-ltr{direction:ltr!important}') &&
  timelineOverride.includes('.tree-task-row.is-rtl{direction:rtl!important}') &&
  timelineOverride.includes('padding-inline-end:74px!important') &&
  timelineOverride.includes('position:absolute!important;inset-block-start:0!important;inset-inline-end:0!important'),
  'Timeline Edit is pinned in its own top inline-end slot, physically right in English and left in Arabic.');
const taskTreeRendererStart=html.indexOf('function treeActivity(parent){');
const taskTreeRenderer=html.slice(taskTreeRendererStart,taskTreeRendererStart+5000);
assert.ok(taskTreeRendererStart>=0 &&
  taskTreeRenderer.includes("class=\"tree-task-row ${ui.lang==='ar'?'is-rtl':'is-ltr'}\"") &&
  taskTreeRenderer.includes("</div>${statusPill(item.status)}<button class=\"subtle-btn tree-task-edit\""),
  'Timeline task status and Edit remain direct children so the mobile positioning rules cannot depend on nested wrappers.');
const hoverStylePosition=html.indexOf('<style id="consistent-card-hover-and-jump-highlight">');
const jumpOverridePosition=html.indexOf('<style id="timeline-mobile-edit-placement-and-jump-highlight-override">');
assert.ok(hoverStylePosition>=0 && jumpOverridePosition>hoverStylePosition &&
  timelineOverride.includes('.workspace-jump-highlight:is(.parent-card,.child-card,.nested-followup,.account-item-row,.tree-task-wrap,.tree-item,.tree-direct,.archive-row,.archive-child-card,.history-event-card):is(:hover,:focus-within)') &&
  timelineOverride.includes('box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 28%,transparent)!important'),
  'The redirected card retains the jump highlight above hover styling when the pointer is over it or moves elsewhere.');
const jumpHighlightFunctionStart=html.indexOf('function highlightWorkspaceCard(target){');
const jumpHighlightFunction=html.slice(jumpHighlightFunctionStart,html.indexOf('function findWorkspaceItemCard',jumpHighlightFunctionStart));
assert.ok(jumpHighlightFunction.includes("target.classList.add('workspace-jump-highlight')") &&
  jumpHighlightFunction.includes('workspaceJumpHighlightTimer=setTimeout(') &&
  jumpHighlightFunction.includes('},1850);'),
  'The hover correction does not shorten or otherwise interrupt the established temporary jump-highlight duration.');
assert.ok(html.includes('</div></div>\n    <span id="brandContextLabel" class="brand-context-label" aria-hidden="true"></span>\n    <div class="top-title">') &&
  html.includes("$('#brandContextLabel').textContent=ui.page==='account'?tr('accountHubTitle'):tr('workspaceEyebrow');") &&
  html.includes('.topbar>#brandContextLabel') &&
  html.includes('grid-template-columns:max-content minmax(0,1fr)!important') &&
  html.includes('justify-self:center!important') &&
  html.includes('pointer-events:none!important'),
  'Mobile WORKSPACE/USERSPACE is a non-interactive sibling of the brand, centered in the remaining header track.');
assert.ok(html.includes('input[type="date"],.date-input{text-align:center!important;text-align-last:center!important}') &&
  html.includes('::-webkit-datetime-edit-fields-wrapper') &&
  html.includes('justify-content:center!important'),
  'Sidebar and child-item From/To date values are centered, including native Chromium date segments.');
assert.ok(html.includes('#mainContent .tree-task-row .tree-title') &&
  html.includes('#mainContent .tree-child-row .tree-child-name') &&
  html.includes('font-weight:700!important') &&
  html.includes('#mainContent .timeline-meta{font-size:10px!important'),
  'Related hierarchy item names match Recent activity title weight, and Recent activity metadata matches the compact metadata scale.');
assert.ok(html.includes('function metaSeparatorMarkup(){') &&
  html.includes('function fmtDateTimeMarkup(date){') &&
  html.includes('class="meta-separator" aria-hidden="true">&nbsp;·&nbsp;</span>') &&
  html.includes('font-weight:1000!important') &&
  html.includes('-webkit-text-stroke:.18px currentColor') &&
  html.includes('gap:0!important'),
  'All metadata middots use the same bold inline spacing, including spacing within the underlined text run.');
assert.ok(html.includes('class="creator-copy"') &&
  html.includes('${fmtDateTimeMarkup(item.createdAt)}') &&
  html.includes('function timelineEvents(parent,limit=8)') &&
  html.includes('${metaSeparatorMarkup()}${fmtDateTimeMarkup(e.at)}'),
  'Created-by labels and Recent activity metadata share the structured date/time separator treatment.');
assert.ok(html.includes('#mainContent .child-description{font-size:12px!important}') &&
  html.includes('.archive-modal .archive-child-card .child-description{font-size:11px!important}'),
  'Item descriptions are slightly larger in the workspace and archive without changing other text.');
assert.ok(html.includes('class="view-full-history-arrow ${ui.lang===\'ar\'?\'is-rtl\':\'is-ltr\'}"') &&
  html.includes('.view-full-history-arrow.is-rtl svg{transform:scaleX(-1)!important'),
  'The Recent activity View full history arrow is mirrored in Arabic only.');


const unifiedMetadataFixStart=html.indexOf('<style id="rtl-clear-root-navigation-and-unified-metadata">');
const unifiedMetadataFixEnd=html.indexOf('</style>',unifiedMetadataFixStart);
const unifiedMetadataFix=html.slice(unifiedMetadataFixStart,unifiedMetadataFixEnd);
assert.ok(unifiedMetadataFixStart>=0 && unifiedMetadataFixEnd>unifiedMetadataFixStart &&
  unifiedMetadataFix.includes('font-size: 1em !important;') &&
  unifiedMetadataFix.includes('font-weight: 1000 !important;') &&
  unifiedMetadataFix.includes('-webkit-text-stroke: .30px currentColor !important;') &&
  unifiedMetadataFix.includes('white-space: pre !important;') &&
  unifiedMetadataFix.includes('.creator-copy,') &&
  unifiedMetadataFix.includes('#mainContent .timeline-meta .meta-separator') &&
  unifiedMetadataFix.includes('#mainContent .tree-created-meta .meta-separator') &&
  unifiedMetadataFix.includes('#mainContent .audit-link .meta-separator') &&
  unifiedMetadataFix.includes('#parentList .mini-updated .meta-separator') &&
  unifiedMetadataFix.includes('column-gap: 0 !important;') &&
  unifiedMetadataFix.includes('.timeline-meta > .timeline-user') &&
  unifiedMetadataFix.includes('.account-assigned-followup-row') &&
  unifiedMetadataFix.includes('.parent-card-meta'),
  'Created by, Last updated, Recent activity and hierarchy metadata use one fixed separator weight and spacing without duplicated flex gaps.');
assert.ok(html.includes('<span class="timeline-user">') &&
  html.includes('${userAvatar(e.userId)}<span>${esc(u.name)}</span></span>${metaSeparatorMarkup()}${fmtDateTimeMarkup(e.at)}'),
  'Recent activity groups the avatar and username so the shared separator spacing remains precise.');
assert.ok(html.includes("function alignWorkspaceItemInViewport(target,itemId='',{alignToTop=false,highlight=true}={}){") &&
  html.includes('if(highlight)highlightWorkspaceCard(activeTarget);') &&
  html.includes("alignToTop:parent.type==='job'||parent.type==='project',highlight:parent.type!=='project'") &&
  html.includes("alignToTop:isRootItem,highlight:item.type!=='project'"),
  'Project and Job roots align at the top from workspace and Profile redirects, while a Project root itself is not highlighted.');

const finalLayoutFixStart=html.indexOf('<style id="final-header-metadata-and-hierarchy-layout-fix">');
const finalLayoutFixEnd=html.indexOf('</style>',finalLayoutFixStart);
const finalLayoutFix=html.slice(finalLayoutFixStart,finalLayoutFixEnd);
assert.ok(finalLayoutFixStart>=0 && finalLayoutFixEnd>finalLayoutFixStart &&
  finalLayoutFix.includes('.meta-date-time{display:inline!important') &&
  finalLayoutFix.includes('text-decoration:inherit!important') &&
  finalLayoutFix.includes('.meta-separator{display:inline!important;margin-inline:0!important') &&
  finalLayoutFix.includes('gap:0!important') &&
  html.includes('&nbsp;·&nbsp;'),
  'Last-updated date/time remains inline and underlined, with separator whitespace inside the decorated text rather than outside margins.');
assert.ok(finalLayoutFix.includes('--activity-meta-font:var(--font-ui)') &&
  finalLayoutFix.includes('--activity-meta-size:10px') &&
  finalLayoutFix.includes('--activity-meta-weight:600') &&
  finalLayoutFix.includes('#mainContent .timeline-meta>span:last-child') &&
  finalLayoutFix.includes('#mainContent .tree-created-meta .creator-copy'),
  'Recent activity and hierarchy metadata share the same default UI font, size and weight.');
assert.ok(finalLayoutFix.includes('#mainContent .detail-description{font-size:12px!important'),
  'Project/Job descriptions use the same increased font size as child item descriptions.');
assert.ok(finalLayoutFix.includes('.tree-task-row>.tree-task-edit{') &&
  finalLayoutFix.includes('grid-column:3!important;grid-row:1!important') &&
  finalLayoutFix.includes('.tree-task-wrap .tree-child-main>button,.tree-direct-main>button{') &&
  finalLayoutFix.includes('grid-column:3!important;grid-row:1!important') &&
  finalLayoutFix.includes('.tree-child-main>.tree-child-name') &&
  finalLayoutFix.includes('.tree-direct-main>.tree-name-type'),
  'Every hierarchy Edit button (task, nested and direct items) has a dedicated first-row action column.');
assert.ok(finalLayoutFix.includes('.history-user,') &&
  finalLayoutFix.includes('.application-history-table .history-user,') &&
  finalLayoutFix.includes('align-items:center!important') &&
  finalLayoutFix.includes('.history-user-copy{align-self:center!important;justify-content:center!important') &&
  finalLayoutFix.includes('.history-user-name{') &&
  finalLayoutFix.includes('align-self:stretch!important') &&
  finalLayoutFix.includes('text-align:start!important'),
  'Activity-history names remain vertically aligned with avatars but their text stays start-aligned, not horizontally centered.');
const historyUserRendererStart=html.indexOf('function historyUserMarkup(event){');
const historyUserRenderer=html.slice(historyUserRendererStart,historyUserRendererStart+420);
assert.ok(historyUserRendererStart>=0 &&
  historyUserRenderer.includes('class="history-user"') &&
  historyUserRenderer.includes('class="history-user-copy"'),
  'History popup user name stays inside the flex-aligned avatar/name group.');

assert.ok(html.includes("function metaSeparatorMarkup(){return '<span class=\"meta-separator\" aria-hidden=\"true\">&nbsp;·&nbsp;</span>';") &&
  html.includes("function creatorLabel(item){") && html.includes("function auditLabel(item,extraClass=''){") &&
  html.includes("fmtDateTimeMarkup(p.updatedAt)}\u0024{metaSeparatorMarkup()}") &&
  html.includes("\u0024{metaSeparatorMarkup()}\u0024{fmtDateTimeMarkup(e.at)}"),
  'Created-by, Last updated, parent-list and recent-activity metadata all use the same adequately spaced separator helper.');
assert.ok(html.includes("const typeLabel='<span class=\"type-pill account-assigned-type-label\">'") &&
  html.includes("#accountPage .account-assigned-item-row .account-item-copy .account-assigned-type-label") &&
  html.includes("border: 1px solid var(--border) !important;") &&
  html.includes("justify-content: flex-start !important;"),
  'Profile Search and Assigned item types remain inside a bounded pill aligned with the start of the card copy.');
const rtlClearFixStart=html.indexOf('<style id="rtl-clear-root-navigation-and-unified-metadata">');
const rtlClearFixEnd=html.indexOf('</style>',rtlClearFixStart);
const rtlClearFix=html.slice(rtlClearFixStart,rtlClearFixEnd);
assert.ok(rtlClearFixStart>=0 && rtlClearFixEnd>rtlClearFixStart &&
  rtlClearFix.includes('justify-self: end !important;') &&
  rtlClearFix.includes('width: max-content !important;') &&
  rtlClearFix.includes('". . . clear" !important;') &&
  rtlClearFix.includes('grid-template-areas:') &&
  html.includes('html[dir="rtl"] #accountPage .account-search-controls > .account-search-clear-button') &&
  html.includes('html[dir="rtl"] #accountPage .account-assigned-controls > .account-search-clear-button'),
  'Profile Search and Assigned Clear controls occupy the physical left edge in RTL and the physical right edge in LTR at desktop and mobile widths.');
const mobileChildFixStart = html.indexOf('<style id="mobile-child-card-dynamic-flow-and-unified-metadata-separators">');
const mobileChildFixEnd = html.indexOf('</style>', mobileChildFixStart);
const mobileChildFix = html.slice(mobileChildFixStart, mobileChildFixEnd);
const mobileAssigneeStart = mobileChildFix.indexOf('#mainContent .child-card .child-meta > .child-assignee {');
const mobileAssigneeEnd = mobileChildFix.indexOf('}', mobileAssigneeStart) + 1;
const mobileAssigneeRule = mobileChildFix.slice(mobileAssigneeStart, mobileAssigneeEnd);
assert.ok(mobileChildFixStart >= 0 && mobileChildFixEnd > mobileChildFixStart &&
  mobileChildFix.includes('.child-title-row .child-title {') &&
  mobileChildFix.includes('display: inline !important;') &&
  mobileChildFix.includes('.child-title-row .type-pill {') &&
  mobileChildFix.includes('vertical-align: baseline !important;') &&
  mobileChildFix.includes('.child-top .child-description {') &&
  mobileChildFix.includes('grid-column: 2 / -1 !important;') &&
  mobileChildFix.includes('.child-top .child-meta {') &&
  mobileChildFix.includes('grid-column: 2 / -1 !important;') &&
  mobileChildFix.includes('grid-row: 2 !important;'),
  'On mobile, the type chip follows the item-name text and the description spans the full card width.');
assert.ok(mobileAssigneeStart >= 0 && mobileAssigneeEnd > mobileAssigneeStart &&
  mobileAssigneeRule.includes('flex: 0 1 auto !important;') &&
  mobileAssigneeRule.includes('width: fit-content !important;') &&
  mobileAssigneeRule.includes('align-self: flex-start !important;') &&
  mobileAssigneeRule.includes('direction: inherit !important;') &&
  !mobileAssigneeRule.includes('flex: 0 0 100%') &&
  !mobileAssigneeRule.includes('    width: 100% !important;'),
  'The mobile assignee pill uses content-sized width, expands only as required, wraps safely, and follows the page’s natural direction.');
assert.ok(mobileChildFix.includes('.meta-separator,') &&
  mobileChildFix.includes('.meta-dot,') &&
  mobileChildFix.includes('.account-assigned-meta-separator {') &&
  mobileChildFix.includes('font-weight: 1000 !important;') &&
  mobileChildFix.includes('-webkit-text-stroke: .22px currentColor !important;') &&
  mobileChildFix.includes('.parent-card-meta { column-gap: 0 !important; }') &&
  mobileChildFix.includes('.account-assigned-meta-row.account-assigned-context-row { gap: 0 !important; }'),
  'All visual metadata separators share the same weight, glyph treatment, and internal spacing without additional flex gaps.');
assert.ok(html.includes("return parts.join(metaSeparatorMarkup());") &&
  html.includes("class=\"parent-card-type parent-card-meta\"><span>${esc(typeName(p.type))}</span>${metaSeparatorMarkup()}") &&
  html.includes("metaSeparatorMarkup()+priorityPill(item.priority||'medium')") &&
  !html.includes('<span class="account-assigned-meta-separator">·</span>'),
  'Parent, sidebar and profile metadata use the shared metadata separator helper.');
assert.ok(finalLayoutFix.includes('@media(max-width:820px)') &&
  finalLayoutFix.includes('#mainContent .tree-created-meta{') &&
  finalLayoutFix.includes('margin-inline:0!important') &&
  finalLayoutFix.includes('.creator-line{') &&
  finalLayoutFix.includes('flex-wrap:nowrap!important') &&
  finalLayoutFix.includes('.creator-line>.creator-copy{') &&
  finalLayoutFix.includes('flex:1 1 auto!important'),
  'Mobile timeline creator metadata begins at the item-icon edge and keeps its avatar inline with the Created by label.');
assert.ok(finalLayoutFix.includes('.topbar>.brand .brand-copy strong{') &&
  finalLayoutFix.includes('width:max-content!important') &&
  finalLayoutFix.includes('overflow:visible!important;text-overflow:clip!important'),
  'The mobile app wordmark keeps its full width and is not clipped by the centered WORKSPACE/USERSPACE label.');

