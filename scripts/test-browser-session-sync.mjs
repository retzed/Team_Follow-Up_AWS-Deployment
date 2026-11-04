import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const gateOpen = html.indexOf('<script id="pre-auth-gate">');
assert.ok(gateOpen >= 0, 'The Cognito pre-authentication gate must exist.');
const gateStart = html.indexOf('>', gateOpen) + 1;
const gateEnd = html.indexOf('</script>', gateStart);
assert.ok(gateEnd > gateStart, 'The Cognito pre-authentication gate must be a complete script.');
const gate = html.slice(gateStart, gateEnd);

const syncStart = gate.indexOf('function clearCurrentBrowserCognitoTokens(){');
const syncEnd = gate.indexOf('function setChallengeField(', syncStart);
assert.ok(syncStart >= 0 && syncEnd > syncStart, 'The browser-session synchronization helpers must exist.');
const syncSource = gate.slice(syncStart, syncEnd);

const values = new Map();
const localStorage = {
  getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
  setItem(key, value) { values.set(String(key), String(value)); },
  removeItem(key) { values.delete(String(key)); },
  key(index) { return [...values.keys()][index] ?? null; },
  get length() { return values.size; }
};
const sessionStorage = {};
const classList = {
  values: new Set(),
  add(name) { this.values.add(name); }
};
const elements = new Map();
const getElement = id => {
  if (!elements.has(id)) {
    elements.set(id, {
      id, hidden: false, disabled: false, value: '', textContent: '',
      inert: false, attributes: {},
      closest() { return { hidden: false }; },
      focus() { this.focused = true; },
      setAttribute(name, value) { this.attributes[name] = String(value); }
    });
  }
  return elements.get(id);
};
const app = getElement('app');
const screen = getElement('signInScreen');
const root = { classList };
const document = { body: { classList } };

let nextContext = { teamUserId: 'u2', authMode: 'cognito' };
let nextError = null;
let ensureCalls = 0;
let finishCalls = [];
let signedOutUiCalls = 0;
let enterRestoreCalls = 0;
let errorMessages = [];
let clearViewCalls = 0;
let timerSequence = 0;
const timers = new Map();
const state = {
  modules: { async signOut() {} },
  browserSessionSyncTimer: null,
  browserSessionSyncRunning: false,
  browserSessionSyncPending: false
};
const window = {
  localStorage,
  __TEAM_FOLLOW_UP_AUTH_CONTEXT: { teamUserId: 'u2', authMode: 'cognito' },
  __TEAM_FOLLOW_UP_CLEAR_VIEW_STATE() { clearViewCalls++; },
  __TEAM_FOLLOW_UP_APP_AUTH_SIGNED_OUT() { signedOutUiCalls++; }
};
const sandbox = {
  COGNITO_STORAGE_PREFIX: 'CognitoIdentityServiceProvider.test-client.',
  state, window, document, root, screen, copy: { notLinked: 'Not linked' },
  $: getElement,
  console: { warn() {}, error() {} },
  setTimeout(callback, delay) {
    const id = ++timerSequence;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  async ensureAuthenticatedContext() {
    ensureCalls++;
    if (nextError) throw nextError;
    return { ...nextContext };
  },
  finishVisualAuth(context) {
    finishCalls.push(context.teamUserId);
    window.__TEAM_FOLLOW_UP_AUTH_CONTEXT = context;
  },
  enterDefaultMode() {},
  enterSessionRestoreMode() { enterRestoreCalls++; },
  setError(message) { errorMessages.push(message); },
  isDefinitiveSessionError(error) {
    const name = String(error?.name || '');
    return String(error?.message || '') === 'NO_VALID_SESSION' ||
      /UserUnAuthenticatedException|InvalidRefreshTokenException|RefreshTokenReuseException|NotAuthorizedException/.test(name);
  }
};
vm.runInNewContext(
  `const COGNITO_STORAGE_PREFIX = 'CognitoIdentityServiceProvider.test-client.';
   ${syncSource}
   this.handleStorage = handleBrowserSessionStorageEvent;
   this.flushSession = synchronizeBrowserSession;
   this.clearBrowserTokens = clearCurrentBrowserCognitoTokens;`,
  sandbox,
  { timeout: 10000 }
);

function emit(event) {
  sandbox.handleStorage(event);
}
async function settleTimers() {
  const pending = [...timers.values()];
  timers.clear();
  for (const timer of pending) {
    assert.equal(timer.delay, 120, 'Cognito token changes are briefly debounced to allow a sign-in/sign-out token batch to finish.');
    timer.callback();
  }
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function storageEvent(key, oldValue = 'old', newValue = 'new', storageArea = localStorage) {
  return { key, oldValue, newValue, storageArea };
}

// Changes outside this Cognito app-client namespace and events from other
// storage areas must not trigger an authentication check.
emit(storageEvent('team-follow-up-api-cache-v2:parents', null, 'updated'));
emit(storageEvent('CognitoIdentityServiceProvider.other-client.user.accessToken', null, 'token'));
emit(storageEvent('CognitoIdentityServiceProvider.test-client.user.accessToken', 'a', 'b', sessionStorage));
assert.equal(timers.size, 0);
assert.equal(ensureCalls, 0);

// Several Cognito key changes from one sign-in/token refresh are coalesced into
// one validation against the latest shared browser-profile token state.
emit(storageEvent('CognitoIdentityServiceProvider.test-client.LastAuthUser', 'u1', 'u2'));
emit(storageEvent('CognitoIdentityServiceProvider.test-client.u2.accessToken', null, 'access'));
emit(storageEvent('CognitoIdentityServiceProvider.test-client.u2.refreshToken', null, 'refresh'));
assert.equal(timers.size, 1);
await settleTimers();
assert.equal(ensureCalls, 1);
assert.equal(finishCalls.length, 0, 'A token refresh for the same Cognito user must not restart workspace hydration.');
assert.equal(window.__TEAM_FOLLOW_UP_AUTH_CONTEXT.teamUserId, 'u2');

// When another tab switches Cognito accounts, the current tab must apply the
// newly verified team identity and let the app's existing auth-change callback
// rehydrate the account-specific workspace.
nextContext = { teamUserId: 'u3', authMode: 'cognito' };
emit(storageEvent('CognitoIdentityServiceProvider.test-client.LastAuthUser', 'u2', 'u3'));
await settleTimers();
assert.deepEqual(finishCalls, ['u3']);
assert.equal(window.__TEAM_FOLLOW_UP_AUTH_CONTEXT.teamUserId, 'u3');

// A storage clear or removal of the active Cognito token is treated as a local
// browser sign-out; it must not call Cognito global sign-out.
nextError = Object.assign(new Error('NO_VALID_SESSION'), { name: 'UserUnAuthenticatedException' });
emit(storageEvent('CognitoIdentityServiceProvider.test-client.u3.accessToken', 'access', null));
await settleTimers();
assert.equal(window.__TEAM_FOLLOW_UP_AUTH_CONTEXT, null);
assert.equal(clearViewCalls, 1);
assert.equal(signedOutUiCalls, 1, 'A remotely signed-out tab stops its realtime WebSocket and polling lifecycle.');
assert.equal(screen.hidden, false);
assert.equal(app.inert, true);

// Browser localStorage.clear() also invalidates the local browser session.
nextError = Object.assign(new Error('NO_VALID_SESSION'), { name: 'UserUnAuthenticatedException' });
emit({ key: null, oldValue: null, newValue: null, storageArea: localStorage });
await settleTimers();
assert.equal(clearViewCalls, 2);
assert.equal(signedOutUiCalls, 2);

// Temporary network failures must not erase an otherwise active Cognito
// browser session or force the user back through the sign-in form.
window.__TEAM_FOLLOW_UP_AUTH_CONTEXT = { teamUserId: 'u3', authMode: 'cognito' };
nextError = Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
const priorClearCalls = clearViewCalls;
emit(storageEvent('CognitoIdentityServiceProvider.test-client.u3.idToken', 'old-token', 'new-token'));
await settleTimers();
assert.equal(window.__TEAM_FOLLOW_UP_AUTH_CONTEXT.teamUserId, 'u3');
assert.equal(clearViewCalls, priorClearCalls);
assert.equal(enterRestoreCalls, 0);
assert.equal(errorMessages.length, 0);

// The fallback removes only this app client's Cognito keys, not unrelated
// application cache/preferences or another Cognito app client's credentials.
localStorage.setItem('CognitoIdentityServiceProvider.test-client.user.accessToken', 'access');
localStorage.setItem('CognitoIdentityServiceProvider.test-client.user.refreshToken', 'refresh');
localStorage.setItem('CognitoIdentityServiceProvider.other-client.user.accessToken', 'other');
localStorage.setItem('team-follow-up-theme', 'dark');
sandbox.clearCurrentBrowserCognitoTokens();
assert.equal(localStorage.getItem('CognitoIdentityServiceProvider.test-client.user.accessToken'), null);
assert.equal(localStorage.getItem('CognitoIdentityServiceProvider.test-client.user.refreshToken'), null);
assert.equal(localStorage.getItem('CognitoIdentityServiceProvider.other-client.user.accessToken'), 'other');
assert.equal(localStorage.getItem('team-follow-up-theme'), 'dark');

assert.doesNotMatch(gate, /signOut\(\{global:true\}\)/,
  'The AWS browser-local sign-out must not revoke the user session on other devices.');
assert.ok(html.includes('window.__TEAM_FOLLOW_UP_APP_AUTH_SIGNED_OUT=()=>{stopRealtimeNotifications();};'),
  'A remotely signed-out tab stops its realtime WebSocket and polling lifecycle.');
assert.ok(gate.includes('cognitoUserPoolsTokenProvider.setKeyValueStorage(tokenStorage)'),
  'Cognito must continue to use Amplify persistent token storage.');
console.log('Browser-session synchronization tests passed: refresh persistence, app-client-scoped storage events, same-user token refresh, cross-tab identity switch/sign-out, storage clear, transient error retention, and local-only token cleanup.');
