import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';

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
check(itemPopup.includes('renderModal();void refreshActivityFor(key,historyScope)'),
  'An item history request must start only after its history popup has opened.');
check(itemPopup.includes('const item=loadedItem||{id:key,type:\'task\',name:key'),
  'An item history popup must still open with a safe fallback snapshot when the local hierarchy has not hydrated that item.');
check(appPopup.includes('renderModal();void refreshApplicationHistory()'),
  'Application-wide Activity must be requested only when its popup opens.');
check(!appPopup.includes('refreshActivityFor('), 'The application-wide popup opener must not trigger unrelated item history.');

const tabHandlerStart = html.indexOf("case 'detail-tab':");
check(tabHandlerStart >= 0, 'The dashboard detail-tab handler must exist.');
const tabHandler = html.slice(tabHandlerStart, tabHandlerStart + 260);
check(!tabHandler.includes('refreshActivityFor('),
  'Switching to the dashboard Activity tab must not issue an Activity-table request.');
check(html.includes("if(ui.selectedParentId){void ensureRootChildrenLoaded(ui.selectedParentId);void refreshActivityFor(ui.selectedParentId,'all');}"),
  'The initially selected Project/Job must preload its Activity history.');

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
const popupReadyStart=html.indexOf('function historyPopupReady(');
const popupReadyEnd=html.indexOf('function rootLoadingError(',popupReadyStart);
check(popupReadyStart>=0&&popupReadyEnd>popupReadyStart&&!html.slice(popupReadyStart,popupReadyEnd).includes('applicationHistoryReady'),
  'An application-wide Activity load must never mark every item-specific history popup as loaded.');
const itemHistoryBranch=html.slice(html.indexOf("} else if(m.kind==='history'){"),html.indexOf("} else if(m.kind==='global-history')"));
check(itemHistoryBranch.includes('const historyReady=historyPopupReady(m.itemId,historyScope);'),
  'The item popup must use exact item-and-scope readiness, independently of application-wide history.');
check(itemHistoryBranch.includes('spinnerMarkup(tr(\'loadingActivity\'),true)'),
  'A pending item-specific history request must display an accessible loading indicator.');

// Execute the real readiness helpers to prove the global-history flag cannot mark
// an unrequested item popup as loaded.
const readinessStart = html.indexOf('function rootActivityReady(');
const readinessEnd = html.indexOf('function rootLoadingError(', readinessStart);
assert.ok(readinessStart >= 0 && readinessEnd > readinessStart, 'History readiness helpers must be present.');
const readinessContext = {
  dataLoadState: { activityLoaded: new Set() },
  applicationHistoryReady: true
};
vm.runInNewContext(
  html.slice(readinessStart, readinessEnd) + '\nthis.rootActivityReady = rootActivityReady; this.historyPopupReady = historyPopupReady;',
  readinessContext
);
assert.equal(readinessContext.rootActivityReady('project-2', 'all'), true,
  'The dashboard may reuse application-wide history after it is loaded.');
assert.equal(readinessContext.historyPopupReady('project-2', 'all'), false,
  'Application-wide history must not satisfy the separate item-popup readiness state.');
readinessContext.dataLoadState.activityLoaded.add('project-2:all');
assert.equal(readinessContext.historyPopupReady('project-2', 'all'), true,
  'The item popup becomes ready only after its exact item-and-scope query succeeds.');
check(html.includes('ui.modal.historyScope===scope')&&html.includes('ui.modal.historyRefreshError=message;renderModal();'),
  'A failure must be shown only for the still-open item-history scope, not hidden by a different history request.');
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

// The item-history popup previously referenced an undeclared historyRootId while loading, throwing before its request could start.
check(!html.includes("countValueMarkup(events.length,false,historyRootId,'activity')") && html.includes(":inlineSpinnerMarkup()}</span></div>"), 'The item-history pending count must not reference an undeclared root ID.');

// Item history must not build/index any cached timeline before the exact item/scope request succeeds.
const historyBranchStart=html.indexOf("} else if(m.kind==='history'){" );
const historyBranchEnd=html.indexOf("} else if(m.kind==='global-history')",historyBranchStart);
check(historyBranchStart>=0&&historyBranchEnd>historyBranchStart,'Item and global history modal branches must remain separate.');
const itemHistoryMarkup=html.slice(historyBranchStart,historyBranchEnd);
check(itemHistoryMarkup.includes('const historyReady=historyPopupReady(m.itemId,historyScope);')&&itemHistoryMarkup.includes('let events=historyReady?activitiesFor(m.itemId,historyScope):[]'),'Item history must render its loader before building events and wait for its exact item/scope response.');
const globalHistoryMarkup=html.slice(historyBranchEnd,html.indexOf("} else if(m.kind==='archive')",historyBranchEnd));
check(globalHistoryMarkup.includes('let events=pending?[]:')&&globalHistoryMarkup.includes('const visibleEvents=events.slice(0,visibleLimit);'),'Global history must avoid processing cached rows while pending and limit synchronous DOM generation.');
check(globalHistoryMarkup.includes('data-action="history-load-more"')&&html.includes("case 'history-load-more':"),'Global history must expose incremental rendering for additional events.');
check(html.includes('.data-loading-state.compact { justify-content:center;')&&html.includes('.history-card-list > .data-loading-state'),'Loading indicators in popup/card areas must be centered.');


check(html.includes("API_CACHE_PREFIX='team-follow-up-api-cache-v1:'") && html.includes('function requestCachedGet(path,key){'), 'Fetched API data must be stored persistently and conditionally revalidated.');
check(html.includes("requestCachedGet('/users','team-users')") && html.includes("requestCachedGet('/items?scope=top-level&dateMode=updated&direction=desc','top-level-items')"), 'Startup must validate persisted profiles and top-level data.');
check(html.includes("requestCachedGet(path,`activity:${String(itemId)}:${scope}`)") || html.includes("requestCachedGet(path,'activity:'+String(itemId)+':'+scope)"), 'Item history must be conditionally revalidated from its local disk cache.');
check(html.includes("requestCachedGet('/activity?scope=application','activity:application')"), 'Application-wide history must be conditionally revalidated from its local disk cache.');
check(html.includes("void refreshActivityFor(id,'all')") && html.includes("void refreshActivityFor(itemId,expandedItem.type==='followup'?'item':'all')"), 'Selecting a parent and expanding a child must preload the corresponding Activity history.');
check(html.includes("parent.type==='project'?\`<button") && html.includes('data-filter="tasks"'), 'The Tasks metric is rendered only for Projects, not Jobs.');

console.log('Progressive-loading tests passed: lean bootstrap, selected-root child hydration, popup-only activity reads, retry safety, accessible spinners, archive pagination, and mobile history controls.');
