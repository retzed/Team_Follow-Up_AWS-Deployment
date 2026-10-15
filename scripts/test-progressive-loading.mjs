import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const html = await readFile('index.html', 'utf8');
const check = (condition, message) => assert.ok(condition, message);

// Startup may retrieve team profiles and top-level Projects/Jobs only.
// Child items are fetched for the selected root; Activity is never part of bootstrap.
const bootstrapStart = html.indexOf('async function bootstrap(');
const bootstrapEnd = html.indexOf('function sameRecordFields', bootstrapStart);
check(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart, 'The data API must expose a standalone bootstrap function.');
const bootstrapBody = html.slice(bootstrapStart, bootstrapEnd);
const usersLoad = bootstrapBody.indexOf("await request('GET','/users')");
const parentLoad = bootstrapBody.indexOf("fetchPagedItems('/items?scope=top-level");
check(usersLoad >= 0 && parentLoad > usersLoad, 'Bootstrap must load users then the paginated top-level Project/Job list.');
for (const forbidden of ['/activity', 'queryActivity', 'queryGlobalActivity', 'rootParentId=']) {
  check(!bootstrapBody.includes(forbidden), `Bootstrap must not load Activity or descendants (${forbidden}).`);
}

check(html.includes('async function queryRootItems(') && html.includes('async function ensureRootChildrenLoaded('),
  'Descendants must be fetched through the dedicated root query, not during bootstrap.');
check(html.includes('void ensureRootChildrenLoaded(ui.selectedParentId)'),
  'After the top-level list appears, only the currently selected Project/Job should be hydrated.');
check(html.includes("case 'select-parent':") && html.includes('void ensureRootChildrenLoaded(id)'),
  'Selecting another Project/Job must trigger its own lazy child-item query.');
check(html.includes("case 'retry-data-load':if(ui.modal?.kind==='history')"),
  'Data-load retry must remain available and target the relevant view.');

const itemPopupStart = html.indexOf('function openHistory(itemId)');
const appPopupStart = html.indexOf('function openApplicationHistory()', itemPopupStart);
const editPopupStart = html.indexOf('function openEdit(', appPopupStart);
check(itemPopupStart >= 0 && appPopupStart > itemPopupStart, 'The item and application-wide history popup openers must exist.');
const itemPopup = html.slice(itemPopupStart, appPopupStart);
const appPopup = html.slice(appPopupStart, editPopupStart);
check(itemPopup.includes('renderModal();void refreshActivityFor(itemId,historyScope)'),
  'An item history request must start only after its history popup has opened.');
check(appPopup.includes('renderModal();void refreshApplicationHistory()'),
  'Application-wide Activity must be requested only when its popup opens.');
check(!appPopup.includes('refreshActivityFor('), 'The application-wide popup opener must not trigger unrelated item history.');

const tabHandlerStart = html.indexOf("case 'detail-tab':");
check(tabHandlerStart >= 0, 'The dashboard detail-tab handler must exist.');
const tabHandler = html.slice(tabHandlerStart, tabHandlerStart + 260);
check(!tabHandler.includes('refreshActivityFor('),
  'Switching to the dashboard Activity tab must not issue an Activity-table request.');
check(!html.includes("refreshActivityFor(ui.selectedParentId,'all')"),
  'No hidden route should fetch Activity history for the selected item after a routine interaction.');

const persistStart = html.indexOf('function persist()');
const persistEnd = html.indexOf('const localizedUserNames', persistStart);
check(persistStart >= 0 && persistEnd > persistStart, 'Workspace persistence must remain implemented.');
const persistBody = html.slice(persistStart, persistEnd);
check(!persistBody.includes('refreshActivityFor(') && !persistBody.includes('changedActivityRoots'),
  'Saving item changes must not trigger background Activity re-queries.');

check(html.includes('function refreshActivityFor(itemId,scope=') || html.includes('async function refreshActivityFor(itemId,scope='),
  'The item-history API loader must remain available for popup open, scope change, and retry.');
check(html.includes('async function refreshApplicationHistory('),
  'The application-wide history loader must remain available for popup open and retry.');
check(html.includes("ev.target.id==='historyScopeFilter'") && html.includes('void refreshActivityFor(itemId,scope)'),
  'Changing item-history scope inside the popup must fetch the newly selected scope.');
check(html.includes('function rootActivityReady(') && html.includes('||applicationHistoryReady'),
  'Activity loaded by the application-wide popup should be reusable by the already-open dashboard.');
check(html.includes("activityNotLoaded:'Open Activity History to load events.'") &&
      html.includes("activityNotLoaded:'افتح سجل النشاط لتحميل الأحداث.'"),
  'The dashboard Activity tab must show a translated unloaded state instead of an indefinite spinner.');
check(html.includes("activityNotLoaded'))}</div>"),
  'The dashboard Activity summary must not masquerade as an in-flight network request.');

check(html.includes('.loading-spinner') && html.includes('function spinnerMarkup(') && html.includes('function inlineSpinnerMarkup('),
  'The modern accessible loading spinner must remain available for asynchronous loading and errors.');
check(html.includes('async function listArchive(options={},onPage)') && html.includes('onPage(page,{loaded:all.length'),
  'Archive must continue to publish fetched pages progressively.');
check(html.includes('history-controls.has-scope') && html.includes('grid-template-areas:"scope count" "search search"'),
  'The existing mobile history controls layout must remain intact.');

if (html.includes('async function mockRoute(method,path,body)')) {
  check(html.includes("await new Promise(resolve=>{if(typeof setTimeout==='function')setTimeout(resolve,0);else resolve();})"),
    'The local demo API must yield before table work so the loading indicator can paint.');
}
console.log('Progressive-loading tests passed: lean bootstrap, selected-root child hydration, popup-only activity reads, retry safety, accessible spinners, archive pagination, and mobile history controls.');
