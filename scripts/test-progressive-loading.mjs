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
const usersLoad = bootstrapBody.indexOf("await requestCachedGet('/users','team-users')");
const parentLoad = bootstrapBody.indexOf("requestCachedGet('/items?scope=top-level&dateMode=updated&direction=desc','top-level-items')");
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
check(itemPopup.includes('renderModal();if(!historyPopupReady(key,historyScope))') && itemPopup.includes('ensureActivityFromRootCache(key)'),
  'Child history popups must reuse cached parent Activity and load the root scope only when needed.');
check(itemPopup.includes('const item=loadedItem||{id:key,type:\'task\',name:key'),
  'An item history popup must still open with a safe fallback snapshot when the local hierarchy has not hydrated that item.');
check(appPopup.includes('restoreApplicationHistoryCache()') &&
      appPopup.includes('if(applicationHistoryCacheInvalidated||!applicationHistoryHasLoaded)void refreshApplicationHistory()') &&
      !appPopup.includes('applicationHistoryReady=false'),
  'Reopening application-wide Activity must reuse persistent history and only fetch when the cache is missing or invalidated.');
check(!appPopup.includes('refreshActivityFor('), 'The application-wide popup opener must not trigger unrelated item history.');

const tabHandlerStart = html.indexOf("case 'detail-tab':");
check(tabHandlerStart >= 0, 'The dashboard detail-tab handler must exist.');
const tabHandler = html.slice(tabHandlerStart, tabHandlerStart + 260);
check(!tabHandler.includes('refreshActivityFor('),
  'Switching to the dashboard Activity tab must not issue an Activity-table request.');
check(html.includes("if(ui.selectedParentId){void ensureRootChildrenLoaded(ui.selectedParentId);}") &&
      !html.includes("if(ui.selectedParentId){void ensureRootChildrenLoaded(ui.selectedParentId);void refreshActivityFor(ui.selectedParentId,'all');}"),
  'Startup must load the selected Project/Job items without preloading the Activity table.');

const persistStart = html.indexOf('function persist()');
const persistEnd = html.indexOf('const localizedUserNames', persistStart);
check(persistStart >= 0 && persistEnd > persistStart, 'Workspace persistence must remain implemented.');
const persistBody = html.slice(persistStart, persistEnd);
check(!persistBody.includes('refreshActivityFor(') && !persistBody.includes('changedActivityRoots'),
  'Saving item changes must not trigger background Activity re-queries.');

check(html.includes('function refreshActivityFor(itemId,scope=') || html.includes('async function refreshActivityFor(itemId,scope='),
  'The item-history API loader must remain available for popup open, scope change, and retry.');
check(html.includes('function refreshApplicationHistory(') && html.includes('function loadMoreApplicationHistory('),
  'The application-wide history loader and paged continuation must remain available for popup open, scroll and retry.');
check(html.includes("ev.target.id==='historyScopeFilter'") && html.includes('void refreshActivityFor(itemId,scope)'),
  'Changing item-history scope inside the popup must fetch the newly selected scope.');
check(html.includes('function rootActivityReady(') &&
      html.slice(html.indexOf('function rootActivityReady('),html.indexOf('function historyPopupReady(')).includes('applicationHistoryCacheIsComplete()'),
  'Activity readiness may reuse the completed persistent application-history cache without preloading history at startup.');
const popupReadyStart=html.indexOf('function historyPopupReady(');
const popupReadyEnd=html.indexOf('function rootLoadingError(',popupReadyStart);
check(popupReadyStart>=0&&popupReadyEnd>popupReadyStart&&html.slice(popupReadyStart,popupReadyEnd).includes('applicationHistoryCacheIsComplete()'),
  'A complete persistent application-history cache may satisfy item popup readiness without another API request.');
const itemHistoryBranch=html.slice(html.indexOf("} else if(m.kind==='history'){"),html.indexOf("} else if(m.kind==='global-history')"));
check(itemHistoryBranch.includes('const historyReady=historyPopupReady(m.itemId,historyScope);'),
  'The item popup must use exact item-and-scope readiness, independently of application-wide history.');
check(itemHistoryBranch.includes('spinnerMarkup(tr(\'loadingActivity\'),true)'),
  'A pending item-specific history request must display an accessible loading indicator.');

// Execute the real readiness helpers to prove the global-history flag cannot mark
// an unrequested item popup as loaded.
const readinessStart = html.indexOf('function historyRootIdFor(');
const readinessEnd = html.indexOf('function rootLoadingError(', readinessStart);
assert.ok(readinessStart >= 0 && readinessEnd > readinessStart, 'History readiness helpers must be present.');
const readinessContext = {
  dataLoadState: { activityLoaded: new Set() },
  applicationHistoryHasLoaded: true,
  applicationHistoryReady: false,
  applicationHistoryCacheInvalidated: false,
  applicationHistoryCacheIsComplete: () => readinessContext.applicationHistoryHasLoaded && readinessContext.applicationHistoryReady && !readinessContext.applicationHistoryCacheInvalidated,
  restorePersistentRootActivityCache: () => false,
  restoreCachedApplicationHistoryPage: () => false,
  allItem: id => ({ id: String(id), type: 'project' }),
  assignedItemCache: new Map(),
  ui: { modal: null },
  rootParent: item => item
};
vm.runInNewContext(
  html.slice(readinessStart, readinessEnd) + '\nthis.rootActivityReady = rootActivityReady; this.historyPopupReady = historyPopupReady;',
  readinessContext
);
assert.equal(readinessContext.rootActivityReady('project-2', 'all'), true,
  'A persisted first page allows the Activity tab to show its currently cached event count while more pages remain.');
assert.equal(readinessContext.historyPopupReady('project-2', 'all'), false,
  'An incomplete application-history cache must not satisfy the full item-history popup.');
readinessContext.applicationHistoryReady = true;
assert.equal(readinessContext.rootActivityReady('project-2', 'all'), true,
  'A complete persistent application-history cache satisfies Activity readiness without a root-specific request.');
assert.equal(readinessContext.historyPopupReady('project-2', 'all'), true,
  'A complete persistent application-history cache satisfies item-popup readiness.');
readinessContext.applicationHistoryCacheInvalidated = true;
assert.equal(readinessContext.historyPopupReady('project-2', 'all'), false,
  'An invalidated application-history cache must not satisfy item-popup readiness.');
readinessContext.dataLoadState.activityLoaded.add('project-2:all');
assert.equal(readinessContext.historyPopupReady('project-2', 'all'), true,
  'An exact root-history request can satisfy popup readiness when the global cache is invalidated.');
check(html.includes("ui.modal.historyScope===scope")&&html.includes("ui.modal.historyRefreshError=message;renderModal();"),
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
check(globalHistoryMarkup.includes('let events=applicationHistoryEvents.slice();')&&globalHistoryMarkup.includes('const visibleEvents=events.slice(0,visibleLimit);'),'Global history must render only fetched pages.');
check(globalHistoryMarkup.includes("${query?events.length:applicationHistoryTotal}"), 'Global history count should show an integer count, not a loaded/total fraction.');
check(globalHistoryMarkup.includes('application-history-scroll')&&html.includes('loadMoreApplicationHistory')&&html.includes("scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight>=180")&&!html.includes('data-action="history-load-more"'),'Global history must load additional pages at the scroll boundary without a button.');
check(html.includes("APPLICATION_HISTORY_CACHE_KEY='team-follow-up-application-history-v1'")&&html.includes('function saveApplicationHistoryCache()')&&html.includes('function restoreApplicationHistoryCache()')&&html.includes('function invalidateApplicationHistoryCache()'), 'Application-wide history must be persisted and restored independently of the workspace snapshot.');
check(html.includes('function renderModal(preserveExisting=true)')&&html.includes('renderModal(true);')&&html.includes('existingModal.dataset.modalKind===m.kind'), 'Asynchronous popup refreshes must update the existing modal shell to prevent entrance-animation flicker.');
check(html.includes('function restorePersistentRootActivityCache(rootId)')&&html.includes("team-follow-up-api-cache-v2:activity:"), 'The Activity tab must recover its event count from persisted per-root history without another item-history request.');
check(html.includes('function restoreCachedApplicationHistoryPage()')&&html.includes("team-follow-up-api-cache-v2:activity:application:scope=application&limit='"), 'Application-wide history must render a cached API page before it finishes revalidating.');
check(html.includes("activityLoadTimeout:'Loading activity timed out. Check the connection and retry.'")&&html.includes("setTimeout(()=>reject(new Error(tr('activityLoadTimeout'))),25000)"), 'A stalled application-wide activity request must transition from loading to an actionable error instead of hanging indefinitely.');
check(html.includes('#modalRoot .modal-head{direction:ltr!important;flex-direction:row!important}')&&html.includes('#modalRoot .modal-head>button[data-action="close-modal"]{margin-inline-start:auto!important;flex:0 0 auto}')&&html.includes(':root[lang="ar"] #modalRoot .modal-head>div{direction:rtl;text-align:right}'), 'Activity history close control stays on the physical right while Arabic title text remains right-to-left.');
check(!html.includes("${isDirectFollowup?`<div class=\"modal-note\">"), 'Direct follow-up cards must not render the removed explanatory note.');
check(html.includes('function refreshApplicationHistory(silent=false){')&&html.includes('const keepCachedPage=applicationHistoryHasLoaded&&applicationHistoryEvents.length>0;')&&html.includes('applicationHistoryRefreshingFirstPage=keepCachedPage;'),
  'An explicit refresh keeps cached rows visible while revalidating page zero, and popup reopening reuses persistent data.');
check(html.includes('function loadRemainingApplicationHistoryForSearch()')&&html.includes('queryGlobalActivity({limit:APPLICATION_HISTORY_PAGE_SIZE,offset:Number(offset)||0})'),'Search must filter loaded pages and fetch the remainder with a loading indicator.');
check(html.includes('function applicationHistoryLoadTailMarkup()')&&!html.includes('data-action="history-load-more"')&&!html.includes("case 'history-load-more':"),'Global history must use its loading indicator and scroll-triggered pagination without a Load more button.');
check(html.includes('.data-loading-state.compact { justify-content:center;')&&html.includes('.history-card-list > .data-loading-state'),'Loading indicators in popup/card areas must be centered.');


check(html.includes("API_CACHE_PREFIX='team-follow-up-api-cache-v2:'") && html.includes('function requestCachedGet(path,key){'), 'Fetched API data must be stored persistently and conditionally revalidated.');
check(html.includes("requestCachedGet('/users','team-users')") && html.includes("requestCachedGet('/items?scope=top-level&dateMode=updated&direction=desc','top-level-items')"), 'Startup must validate persisted profiles and top-level data.');
check(html.includes("requestCachedGet(path,'activity:'+String(itemId)+':'+scope+':'+queryText)"), 'Item history must be conditionally revalidated from its local disk cache.');
check(html.includes("requestCachedGet(path,'activity:application:'+params.toString())")&&html.includes('async function queryGlobalActivity(options={})'), 'Application-wide history pages must be conditionally revalidated and cached per page.');
check(html.includes("void refreshActivityFor(id,'all')") && html.includes("void ensureActivityFromRootCache(itemId)"), 'Selecting a parent and expanding a child must reuse the root Activity cache.');
check(html.includes('function historyRootIdFor(itemId)')&&html.includes('function ensureActivityFromRootCache(itemId){const rootId=historyRootIdFor(itemId);if(applicationHistoryCacheIsComplete()'), 'Completed application-wide history must satisfy descendant popup readiness without another API request.');
check(html.includes("scope==='all'&&String(selected.id)===String(itemId)"),'The Activity tab event count must refresh when root history arrives.');
check(html.includes('data-filter="urgent"')&&html.includes("ui.childPriority==='urgent'"),'Jobs must show an Urgent metric instead of Tasks.');
check(html.includes("parent.type==='project'?\`<button") && html.includes('data-filter="tasks"'), 'The Tasks metric is rendered only for Projects, not Jobs.');


const modalPreserverStart=html.indexOf('function renderModalPreservingInteraction(){');
const modalPreserverEnd=html.indexOf('function renderAfterActivityRefresh',modalPreserverStart);
check(modalPreserverStart>=0&&modalPreserverEnd>modalPreserverStart,'The modal interaction-preserver must exist as a bounded function.');
const modalPreserver=html.slice(modalPreserverStart,modalPreserverEnd);
check(modalPreserver.includes('for(const selector of selectors) $$(selector,modalRoot).forEach')&&modalPreserver.includes('const nodes=$$(state.selector,modalRoot)'), 'Modal scroll preservation must query selector lists, not call forEach on querySelector results.');
check(html.includes('#modalRoot .modal-head{direction:ltr!important;flex-direction:row!important}')&&html.includes('#modalRoot .modal-head>button[data-action="close-modal"]{margin-inline-start:auto!important;flex:0 0 auto}'), 'The modal close control is physically right-aligned on its first render in RTL and LTR.');

const globalHistoryScrollStart=html.indexOf("$('#modalRoot').addEventListener('scroll',ev=>{");
const globalHistoryScrollEnd=html.indexOf('},true);',globalHistoryScrollStart);
check(globalHistoryScrollStart>=0&&globalHistoryScrollEnd>globalHistoryScrollStart&&html.slice(globalHistoryScrollStart,globalHistoryScrollEnd).includes(".application-history-scroll")&&html.slice(globalHistoryScrollStart,globalHistoryScrollEnd).includes('void loadMoreApplicationHistory()')&&html.slice(globalHistoryScrollStart,globalHistoryScrollEnd).includes('visibleCount<matchedCount'), 'Reaching the bottom of the application-wide history scroll region must request the next page.');
const searchFillStart=html.indexOf('async function loadRemainingApplicationHistoryForSearch()');
const searchFillEnd=html.indexOf('function persist()',searchFillStart);
check(searchFillStart>=0&&searchFillEnd>searchFillStart&&html.slice(searchFillStart,searchFillEnd).includes('await loadMoreApplicationHistory(true)')&&html.slice(searchFillStart,searchFillEnd).includes('while(')&&html.includes('void loadRemainingApplicationHistoryForSearch()'), 'Searching application-wide history must continue loading pages until search coverage is complete or a recoverable error occurs.');

check(html.includes('<style id="activity-history-single-scroll-owner">')&&html.includes('.modal.application-history-modal .application-history-scroll{display:block!important;flex:1 1 0!important;')&&html.includes('.modal.application-history-modal .history-card-list{display:flex!important;flex:0 0 auto!important;'), 'Application-wide history uses one vertical scroll owner so wheel/trackpad scrolling reaches paging on desktop and mobile.');
check(html.includes('const visibleLimit=Math.max(100,Number(m.historyVisibleCount)||100);')&&html.includes('data-visible-count="${visibleEvents.length}" data-matched-count="${events.length}"'), 'Application-wide history displays bounded 100-event chunks and reveals more already-loaded matches as the user scrolls.');
check(html.includes('function synchronizeApplicationHistoryWithWorkspace()')&&html.includes('if(!silent)saveApplicationHistoryCache();')&&html.includes("if(!silent&&ui.modal?.kind==='global-history')renderModalPreservingInteraction();"), 'Search batches cache writes, workspace merges and modal redraws instead of repeating them for every fetched page.');
check(html.includes('await new Promise(resolve=>setTimeout(resolve,0));')&&html.includes('applicationHistorySearchRequest')&&html.includes("String(ui.modal.historyQuery||'').trim()===searchQuery"), 'Search yields to the browser and abandons stale scans when the query or user filter changes.');
check(html.includes("closeControl.style.setProperty('margin-left','auto','important')")&&html.includes("modalHead.style.setProperty('direction','ltr','important')"), 'Every modal render enforces a physical-right close button, including history scope changes.');
console.log('Progressive-loading tests passed: lean bootstrap, selected-root child hydration, popup-only activity reads, retry safety, accessible spinners, archive pagination, and mobile history controls.');
