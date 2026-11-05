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
const mobileDateFixStart = html.indexOf('<style id="mobile-account-date-input-sizing-fix">');
const mobileDateFixEnd = html.indexOf('</style>', mobileDateFixStart);
assert.ok(mobileDateFixStart >= 0 && mobileDateFixEnd > mobileDateFixStart, 'Mobile profile date sizing override must exist.');
const mobileDateFixCss = html.slice(mobileDateFixStart, mobileDateFixEnd);
for (const area of ['.account-search-controls', '.account-assigned-controls']) {
  assert.ok(mobileDateFixCss.includes(`#accountPage ${area}`) && mobileDateFixCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'), `${area} must keep the From/To fields in two shrinkable mobile columns.`);
}
assert.ok(mobileDateFixCss.includes('height: 34px !important;') && mobileDateFixCss.includes('min-height: 34px !important;') && mobileDateFixCss.includes('max-height: 34px !important;'), 'Mobile profile date controls must use a compact 34px height.');
assert.ok(mobileDateFixCss.includes('width: min(100%, 128px) !important;') && mobileDateFixCss.includes('max-width: 128px !important;') && mobileDateFixCss.includes('justify-self: start !important;'), 'Mobile profile date controls must remain side by side at a compact maximum width.');
assert.ok(mobileDateFixCss.includes('min-inline-size: 0 !important;') && mobileDateFixCss.includes('max-inline-size: 100% !important;') && mobileDateFixCss.includes('width: 100% !important;'), 'Mobile profile date controls must shrink when their grid track is narrower than the width cap.');
assert.ok(mobileDateFixCss.includes('#mainContent .child-toolbar.expanded .child-search-field > .child-search-box') && mobileDateFixCss.includes('#mainContent .child-toolbar.expanded .child-filter-field > .child-filter-control') && mobileDateFixCss.includes('#mainContent .child-toolbar.expanded .child-date-row .date-input'), 'Mobile child-item search fields share the compact sizing override.');
assert.ok(mobileDateFixCss.includes('height: 34px !important;') && mobileDateFixCss.includes('min-height: 34px !important;'), 'Mobile child-item search controls are slightly shorter without changing their width.');
assert.ok(!html.includes('id="sidebarSearchTab"') && !html.includes('class="sidebar-mode-tabs"') && !html.includes("$('#sidebarSearchTab')") && !html.includes("case 'sidebar-mode':"), 'The redundant Search tab button is removed from the expanded Projects & Jobs sidebar.');
