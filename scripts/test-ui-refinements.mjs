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
  const wrapperStart = html.lastIndexOf('<div class="account-search-date-range">', fromPos);
  const wrapperEnd = html.indexOf('</div>', toPos);
  assert.ok(wrapperStart >= 0 && wrapperEnd > toPos, `${name} From/To inputs must be enclosed by one shared date-range wrapper.`);
  assert.ok(html.slice(wrapperStart, wrapperEnd).includes('account-search-date-from-field') && html.slice(wrapperStart, wrapperEnd).includes('account-search-date-to-field'), `${name} must preserve distinct From and To labels inside the paired wrapper.`);
}
assert.equal((html.match(/<div class="account-search-date-range">/g) || []).length, 2, 'Only Search and Assigned Items should each render one paired date-range wrapper.');
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
assert.ok(html.includes("isParent||item.type==='task'?' data-history-scope=\"item\"'"), 'Assigned-item Task history must open scoped to the selected item.');
assert.ok(html.includes('id="scroll-to-top-centered"') || html.includes('left:50%!important;right:auto!important'), 'The scroll-to-top button must be horizontally centered.');
