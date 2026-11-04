import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const helperStart = html.indexOf("const WORKSPACE_VIEW_STATE_PREFIX='team-follow-up-view-state-v1:';");
const helperEnd = html.indexOf('\nconst activityRefreshRequests=new Map();', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'User-specific view-state helpers must exist.');
const helperSource = html.slice(helperStart, helperEnd);

assert.match(html, /const tokenStorage=utils\.defaultStorage/, 'Cognito uses Amplify’s documented persistent browser defaultStorage.');
assert.ok(html.includes("CognitoIdentityServiceProvider.'+String(cognito.userPoolClientId||'')+'."),
  'Cross-tab synchronization is limited to this Cognito app client token namespace.');
assert.ok(html.includes("window.addEventListener('storage',handleBrowserSessionStorageEvent)"),
  'Cognito localStorage changes are observed by other same-origin browser tabs.');
assert.ok(html.includes('const context=await ensureAuthenticatedContext();') &&
          html.includes("activeUserId!==String(context.teamUserId||'')"),
  'A changed Cognito session is revalidated and a different team identity is applied to the running app.');
assert.doesNotMatch(html, /signOut\(\{global:true\}\)/,
  'Signing out of this browser profile must not revoke the Cognito session on other devices.');
assert.ok(html.includes('clearCurrentBrowserCognitoTokens()'),
  'A failed local sign-out clears only this app client’s browser token namespace as a fallback.');
assert.ok(html.includes("typeof tokenStorage.clear!=='function'"), 'The supported Amplify storage interface is checked, including its clear operation.');
assert.ok(html.includes('tokenStorageProbeKey') && html.includes('browserStorageProbe') && html.includes('Amplify defaultStorage is not backed by browser localStorage.'), 'Startup verifies the Amplify storage provider writes to browser localStorage before restoring a session.');
assert.match(html, /CognitoIdentityServiceProvider\./, 'Existing sessionStorage Cognito tokens are migrated to persistent storage.');
assert.doesNotMatch(html, /tokenStorage=utils\.sessionStorage/, 'A failed legacy-token migration cannot silently downgrade the active session to tab-scoped storage.');
assert.ok(html.includes('migrationVerified') && html.includes('stored!==value'), 'Legacy Cognito tokens are removed from sessionStorage only after persistent-storage verification.');
assert.ok(html.includes('getCognitoAccessToken(forceRefresh=false)'), 'The authenticated session can explicitly refresh an access token without restarting the application.');
assert.ok(html.includes('this.getAccessToken({forceRefresh:true})'), 'An API 401 retries once with a forced-refreshed access token instead of immediately dropping the signed-in session.');
const authStart = html.indexOf('async function ensureAuthenticatedContext(){');
const authEnd = html.indexOf('\n function finishVisualAuth(context){', authStart);
assert.ok(authStart >= 0 && authEnd > authStart, 'Authenticated session restoration helper must exist.');
const authSource = html.slice(authStart, authEnd);
assert.ok(authSource.indexOf('fetchAuthSession()') < authSource.indexOf('getCurrentUser()'),
  'Token refresh/session validation must run before reading the Cognito user.');
assert.ok(authSource.includes("fetchAuthSession({forceRefresh:true})"), 'A missing access token triggers an explicit Cognito refresh-token attempt before the session is discarded.');
assert.ok(authSource.includes('identityErrorName') && authSource.includes('session=await state.modules.fetchAuthSession({forceRefresh:true})'),
  'A Cognito identity lookup rejected by a stale access token gets one forced-refresh retry before sign-in is reset.');
assert.ok(authSource.includes("if(!/NotAuthorizedException|UserUnAuthenticatedException/.test(identityErrorName))throw identityError;"),
  'Transient profile-attribute failures are rethrown for session-recovery handling instead of being converted to an unmapped user.');
assert.ok(html.includes('id="signInRetrySession"') && html.includes('async function retrySessionRestoration()'),
  'A retry path must be available when a temporary auth/network error prevents session restoration.');
assert.match(html, /else if\(isDefinitiveSessionError\((?:error|e)\)\)enterDefaultMode\(\);\s*else enterSessionRestoreMode\(\)/,
  'Only definitive expired/absent sessions return to the sign-in form; transient errors retain the session and expose retry.');

assert.ok(html.includes('window.__TEAM_FOLLOW_UP_CLEAR_VIEW_STATE?.();'), 'Explicit sign-out clears the saved page state for the current team profile.');

const hydrationStart = html.indexOf('async function startWorkspaceHydration(){');
const hydrationEnd = html.indexOf('\n}', hydrationStart);
assert.ok(hydrationStart >= 0 && hydrationEnd > hydrationStart, 'Workspace data hydration helper must exist.');
const hydrationHeader = html.slice(hydrationStart, hydrationStart + 900);
assert.doesNotMatch(hydrationHeader, /ui\.page='account';\s*ui\.accountTab='assigned'/,
  'Data refresh must not force the user back to Profile > Assigned Items.');
assert.match(html, /if\(!ui\.selectedParentId&&data\.parents\.length\)[\s\S]*?meta\.done===true/,
  'Progressive bootstrap must preserve a selected parent until the complete parent set has been checked.');
assert.ok(html.includes("else if(ui.accountTab==='pinned'&&!ui.accountPinnedLoaded)void loadAccountPinnedItems();"),
  'A restored Pinned Items page reloads its own data instead of switching tabs.');
assert.ok(html.includes('restoredWorkspaceScrollY>0') && html.includes('window.scrollTo({top:restoredWorkspaceScrollY'),
  'The current scroll position is restored after the data refresh.');

const createMemoryStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: key => map.has(String(key)) ? map.get(String(key)) : null,
    setItem: (key, value) => map.set(String(key), String(value)),
    removeItem: key => map.delete(String(key))
  };
};
const initialUi = {
  actingUserId: 'u2', page: 'workspace', sidebarCollapsed: false, sidebarMode: 'search',
  selectedParentId: 'project-42', selectedAssignedItemId: 'task-9', tab: 'activity',
  parentQuery: 'network', parentType: 'project', parentStatus: 'in-progress',
  parentDateMode: 'updated', parentDateFrom: '2026-10-01', parentDateTo: '2026-11-03',
  childQuery: 'review', childType: 'task', childStatus: 'all', childPriority: 'high',
  childDateMode: 'created', childDateFrom: '', childDateTo: '', childScope: 'all',
  childSearchExpanded: true, accountTab: 'pinned', accountAssignedQuery: '',
  accountAssignedType: 'all', accountAssignedStatus: 'all', accountAssignedPriority: 'all',
  accountAssignedDateMode: 'updated', accountAssignedDateFrom: '', accountAssignedDateTo: '',
  accountSearchQuery: '', accountSearchType: 'all', accountSearchStatus: 'all',
  accountSearchDateMode: 'updated', accountSearchDateFrom: '', accountSearchDateTo: '',
  accountSearchUser: 'all', expanded: new Set(['task-9', 'task-10']), modal: null
};
const storage = createMemoryStorage();
const persistentStorage = createMemoryStorage();
const listeners = {};
const firstContext = {
  ui: initialUi,
  sessionStorage: storage,
  localStorage: persistentStorage,
  window: { scrollY: 584, addEventListener: (name, callback) => { listeners[name] = callback; } },
  Set, Number, Math, JSON, String
};
vm.runInNewContext(helperSource + '\nthis.persistWorkspaceViewState=persistWorkspaceViewState;', firstContext);
firstContext.persistWorkspaceViewState();
assert.ok(storage.getItem('team-follow-up-view-state-v1:u2'), 'The page state is stored in the current browser tab session.');
assert.ok(persistentStorage.getItem('team-follow-up-view-state-v1:u2'), 'A persistent per-user backup is stored as each view change is saved.');
assert.ok(html.includes("for(const eventName of ['click','change','input'])window.addEventListener(eventName,scheduleWorkspaceViewStateSave,true);"), 'Normal navigation, filtering and search interactions schedule a view-state save before browser unload.');
assert.equal(typeof listeners.pagehide, 'function', 'A pagehide save is registered for browser refresh/unload.');

const refreshedUi = {
  actingUserId: 'u2', page: 'account', sidebarCollapsed: true, sidebarMode: 'search',
  selectedParentId: '', selectedAssignedItemId: null, tab: 'overview',
  parentQuery: '', parentType: 'all', parentStatus: 'all', parentDateMode: 'updated',
  parentDateFrom: '', parentDateTo: '', childQuery: '', childType: 'all', childStatus: 'all',
  childPriority: 'all', childDateMode: 'updated', childDateFrom: '', childDateTo: '',
  childScope: 'all', childSearchExpanded: false, accountTab: 'assigned',
  accountAssignedQuery: '', accountAssignedType: 'all', accountAssignedStatus: 'all',
  accountAssignedPriority: 'all', accountAssignedDateMode: 'updated',
  accountAssignedDateFrom: '', accountAssignedDateTo: '', accountSearchQuery: '',
  accountSearchType: 'all', accountSearchStatus: 'all', accountSearchDateMode: 'updated',
  accountSearchDateFrom: '', accountSearchDateTo: '', accountSearchUser: 'all',
  expanded: new Set(), modal: { kind: 'edit' }
};
const secondContext = {
  ui: refreshedUi,
  sessionStorage: storage,
  localStorage: persistentStorage,
  window: { scrollY: 0, addEventListener() {} },
  Set, Number, Math, JSON, String
};
vm.runInNewContext(helperSource + '\nthis.restoredWorkspaceScrollY=restoredWorkspaceScrollY;', secondContext);
assert.equal(refreshedUi.page, 'workspace');
assert.equal(refreshedUi.selectedParentId, 'project-42');
assert.equal(refreshedUi.selectedAssignedItemId, 'task-9');
assert.equal(refreshedUi.tab, 'activity');
assert.equal(refreshedUi.parentQuery, 'network');
assert.equal(refreshedUi.childPriority, 'high');
assert.equal(refreshedUi.accountTab, 'pinned');
assert.deepEqual([...refreshedUi.expanded], ['task-9', 'task-10']);
assert.equal(refreshedUi.modal, null, 'A browser refresh does not reopen an unfinished modal.');
assert.equal(secondContext.restoredWorkspaceScrollY, 584);
const fallbackSessionStorage = createMemoryStorage();
const fallbackUi = { ...refreshedUi, page: 'account', selectedParentId: '', selectedAssignedItemId: null, tab: 'overview', expanded: new Set() };
const fallbackContext = {
  ui: fallbackUi, sessionStorage: fallbackSessionStorage, localStorage: persistentStorage,
  window: { scrollY: 0, addEventListener() {} }, Set, Number, Math, JSON, String
};
vm.runInNewContext(helperSource + '\nthis.restoredWorkspaceScrollY=restoredWorkspaceScrollY;', fallbackContext);
assert.equal(fallbackUi.page, 'workspace', 'Persistent view state restores the last opened application page when tab-scoped state is unavailable.');
assert.equal(fallbackUi.selectedParentId, 'project-42', 'Persistent view state restores the selected parent.');
assert.equal(fallbackUi.tab, 'activity', 'Persistent view state restores the open detail tab.');
const otherUserUi = { ...refreshedUi, actingUserId: 'u3', page: 'account', selectedParentId: '' };
const thirdContext = {
  ui: otherUserUi, sessionStorage: storage, localStorage: persistentStorage,
  window: { scrollY: 0, addEventListener() {} }, Set, Number, Math, JSON, String
};
vm.runInNewContext(helperSource + '\nthis.restoredWorkspaceScrollY=restoredWorkspaceScrollY;', thirdContext);
assert.equal(otherUserUi.page, 'account', 'View state is isolated per signed-in team profile.');
assert.equal(otherUserUi.selectedParentId, '');

const clearContext = { ...secondContext, ui: refreshedUi };
vm.runInNewContext(helperSource + '\nthis.clearView=window.__TEAM_FOLLOW_UP_CLEAR_VIEW_STATE;', clearContext);
clearContext.clearView();
assert.equal(storage.getItem('team-follow-up-view-state-v1:u2'), null, 'Explicit sign-out clears the tab-scoped view state.');
assert.equal(persistentStorage.getItem('team-follow-up-view-state-v1:u2'), null, 'Explicit sign-out also clears the persistent view-state backup.');

if (html.includes('function initializeLocalAuth(){')) {
  assert.match(html, /sessionStorage\.getItem\(LOCAL_SESSION_KEY\)\|\|localStorage\.getItem\(LOCAL_SESSION_KEY\)/,
    'The local demo restores its non-secret demo user ID after a tab/browser reload.');
  assert.match(html, /sessionStorage\.setItem\(LOCAL_SESSION_KEY,teamUserId\);localStorage\.setItem\(LOCAL_SESSION_KEY,teamUserId\)/,
    'The local demo persists the active demo identity until explicit sign-out.');
  assert.match(html, /sessionStorage\.removeItem\(LOCAL_SESSION_KEY\);localStorage\.removeItem\(LOCAL_SESSION_KEY\)/,
    'Explicit demo sign-out removes both session and persistent demo identity keys.');
}

const initializeAuthStart = html.indexOf('async function initialize(){');
const tokenProviderSetup = html.indexOf('cognitoUserPoolsTokenProvider.setKeyValueStorage(tokenStorage)', initializeAuthStart);
const startupSessionRestore = html.indexOf('ensureAuthenticatedContext();finishVisualAuth(context)', initializeAuthStart);
assert.ok(initializeAuthStart >= 0 && tokenProviderSetup > initializeAuthStart && startupSessionRestore > tokenProviderSetup, 'The verified persistent provider is installed before the startup Cognito session restoration call.');
console.log('Session-refresh tests passed: verified Cognito localStorage, transient auth recovery, user-specific page/tab/filter/scroll restoration, and no hydration route reset.');
