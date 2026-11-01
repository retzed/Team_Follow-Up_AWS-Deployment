import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const managerStart = html.indexOf('let realtimeSocket=null,realtimeReconnectTimer=null');
const managerEnd = html.indexOf('async function startWorkspaceHydration()', managerStart);
assert.ok(managerStart >= 0 && managerEnd > managerStart, 'the app must contain the real-time client manager');
const managerSource = html.slice(managerStart, managerEnd);

const scheduledTimeouts = new Map();
let nextTimerId = 1;
const eventListeners = {};
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    this.url = String(url);
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }
  send(value) { this.sent.push(String(value)); }
  close(code = 1000, reason = '') { this.readyState = MockWebSocket.CLOSED; this.closedWith = { code, reason }; this.onclose?.({ code, reason }); }
}

function createContext(overrides = {}) {
  const calls = { assigned: 0, pinned: 0, roots: [], resolved: [], parentRenders: 0, detailRenders: 0, activity: 0, globalHistory: 0, accountRenders: 0 };
  const ui = {
    actingUserId: 'u2', page: 'account', accountTab: 'assigned',
    accountAssignedLoaded: true, accountAssignedLoading: false,
    accountPinnedLoaded: true, accountPinnedLoading: false, accountPinnedRows: [],
    selectedParentId: 'project-1', selectedAssignedItemId: null, tab: 'overview', modal: null
  };
  const data = {
    parents: [{ id: 'project-1', type: 'project', updatedAt: '2026-10-01T00:00:00.000Z' }],
    children: [{ id: 'task-1', type: 'task', rootParentId: 'project-1' }]
  };
  const queryPages = overrides.queryPages || [];
  const api = {
    remoteApi: true,
    createRealtimeTicket: async () => ({ ticket: 'one-time-ticket', cursor: 'cursor-0' }),
    queryRealtimeChanges: async since => {
      calls.queryCursors = calls.queryCursors || [];
      calls.queryCursors.push(since);
      return queryPages.shift() || { changes: [], nextCursor: since, hasMore: false };
    },
    resolveItems: async ids => {
      calls.resolved.push([...ids]);
      return { items: overrides.resolvedItems || [] };
    }
  };
  const windowEvents = {};
  const context = {
    window: {
      navigator: { onLine: true },
      WebSocket: MockWebSocket,
      TeamFollowUpDataApi: api,
      TEAM_FOLLOW_UP_CONFIG: { realtimeWebSocketUrl: 'wss://example.execute-api.us-east-1.amazonaws.com/prod' },
      addEventListener: (name, callback) => { windowEvents[name] = callback; }
    },
    document: {
      hidden: false,
      addEventListener: (name, callback) => { eventListeners[name] = callback; }
    },
    navigator: { onLine: true },
    WebSocket: MockWebSocket,
    ui, data,
    dataLoadState: { childrenLoaded: new Set() },
    rawCurrentUser: () => ({ id: 'u2' }),
    rootParent: row => row?.rootParentId ? { id: row.rootParentId } : null,
    invalidateHierarchyIndex: () => {},
    renderParentList: () => { calls.parentRenders += 1; },
    renderDetail: () => { calls.detailRenders += 1; },
    renderAccountPage: () => { calls.accountRenders += 1; },
    ensureRootChildrenLoaded: async (id, options) => { calls.roots.push([String(id), options]); },
    refreshActivityFor: async () => { calls.activity += 1; },
    refreshApplicationHistory: () => { calls.globalHistory += 1; },
    loadAccountAssignedItems: async () => { calls.assigned += 1; },
    loadAccountPinnedItems: async () => { calls.pinned += 1; },
    allItem: () => null,
    toAppItem: row => row,
    assignedItemCache: new Map(),
    console: { warn() {}, error() {}, log() {} },
    setTimeout: callback => { const id=nextTimerId++; scheduledTimeouts.set(id,callback); return id; },
    clearTimeout: id => scheduledTimeouts.delete(id),
    setInterval: callback => { const id=nextTimerId++; scheduledTimeouts.set(id,callback); return id; },
    clearInterval: id => scheduledTimeouts.delete(id),
    Math, URL, URLSearchParams, JSON, Promise, Set, Map, String, Number, WebSocket: MockWebSocket
  };
  vm.runInNewContext(managerSource + '\nthis.applyRealtimeChangeBatch=applyRealtimeChangeBatch;this.catchUpRealtimeChanges=catchUpRealtimeChanges;this.startRealtimeNotifications=startRealtimeNotifications;this.stopRealtimeNotifications=stopRealtimeNotifications;this.getRealtimeState=()=>({running:realtimeRunning,cursor:realtimeCursor});', context);
  return { context, calls, api, ui, data, windowEvents };
}

{
  const { context, calls, ui } = createContext();
  await context.applyRealtimeChangeBatch([{
    type: 'items.changed', changeId: 'assignment-change',
    itemId: 'task-1', rootParentIds: ['project-1'], assigneeIds: ['u1', 'u2'],
    parentIds: ['project-1'], topLevelIds: [], deleted: false, version: 2
  }]);
  assert.equal(ui.accountAssignedLoaded, false, 'an affected active Assigned Items cache is invalidated');
  assert.equal(calls.assigned, 1, 'the newly assigned current user refreshes Assigned Items immediately');
  assert.deepEqual(calls.roots.map(entry => entry[0]), ['project-1'], 'the selected root hierarchy is refreshed');
  assert.equal(calls.roots[0][1].force, true, 'the selected root refresh bypasses stale cached children');
}

{
  const { context, calls } = createContext();
  await context.applyRealtimeChangeBatch([{
    type: 'items.changed', changeId: 'other-user-change',
    itemId: 'task-1', rootParentIds: ['project-1'], assigneeIds: ['u3'],
    parentIds: ['project-1'], topLevelIds: [], deleted: false, version: 2
  }]);
  assert.equal(calls.assigned, 0, 'unrelated users do not download another assignee list');
  assert.equal(calls.roots.length, 1, 'the selected workspace root still reflects item changes');
}

{
  const { context, calls, data, ui } = createContext({
    resolvedItems: [{ id: 'project-new', type: 'project', updatedAt: '2026-11-02T00:00:00.000Z' }]
  });
  data.parents.push({ id: 'project-deleted', type: 'project' });
  data.children.push({ id: 'task-deleted', type: 'task', rootParentId: 'project-deleted' });
  ui.selectedParentId = 'project-deleted';
  await context.applyRealtimeChangeBatch([{
    type: 'items.changed', changeId: 'top-level-delete',
    itemId: 'project-deleted', rootParentIds: ['project-deleted', 'project-new'],
    assigneeIds: ['u2'], parentIds: [], topLevelIds: ['project-deleted', 'project-new'],
    deleted: false, version: 2
  }]);
  assert.deepEqual(calls.resolved, [['project-deleted', 'project-new']], 'only top-level IDs in the event are resolved');
  assert.deepEqual(data.parents.map(row => row.id), ['project-new'], 'deleted top-level IDs are removed and current IDs are merged');
  assert.equal(ui.selectedParentId, 'project-new', 'a deleted selection moves to an active root');
  assert.ok(!data.children.some(row => row.rootParentId === 'project-deleted'), 'children of a deleted root are evicted from the loaded view');
  assert.ok(calls.roots.some(entry => entry[0] === 'project-new'), 'the replacement selected root is loaded');
}

{
  const { context, calls, ui } = createContext({
    resolvedItems: [{ id: 'project-1', type: 'project', updatedAt: '2026-11-02T00:00:00.000Z' }]
  });
  ui.accountTab = 'search';
  await context.applyRealtimeChangeBatch([{
    type: 'items.changed', changeId: 'search-refresh',
    itemId: 'project-1', rootParentIds: ['project-1'], topLevelIds: ['project-1'],
    assigneeIds: ['u3'], parentIds: [], deleted: false, version: 2
  }]);
  assert.equal(calls.accountRenders, 1, 'the open Account Search tab rerenders from the refreshed top-level records');
}

{
  const first = {
    type: 'items.changed', changeId: 'chg-1', cursor: 'cursor-1',
    itemId: 'task-1', rootParentIds: ['project-1'], topLevelIds: [], parentIds: [],
    assigneeIds: ['u2'], deleted: false, version: 2
  };
  const second = {
    type: 'items.changed', changeId: 'chg-2', cursor: 'cursor-2',
    itemId: 'task-2', rootParentIds: ['project-1'], topLevelIds: [], parentIds: [],
    assigneeIds: ['u2'], deleted: false, version: 3
  };
  const { context, calls } = createContext({ queryPages: [
    { changes: [first, second], nextCursor: 'cursor-2', hasMore: false }
  ] });
  vm.runInNewContext('realtimeRunning=true;realtimeCursor="cursor-0";', context);
  await context.catchUpRealtimeChanges();
  assert.equal(context.getRealtimeState().cursor, 'cursor-2', 'the durable cursor advances to the last committed ordered change');
  assert.deepEqual(calls.queryCursors, ['cursor-0'], 'catch-up queries begin exclusively after the last stored cursor');
  assert.equal(calls.assigned, 1, 'multiple changes for the current assignee in one page trigger one list refresh');
  assert.equal(calls.roots.length, 1, 'multiple changes under the selected root trigger one hierarchy refresh');
}

{
  const firstChange = {
    type: 'items.changed', changeId: 'first-ever-change', cursor: 'cursor-first',
    itemId: 'task-first', rootParentIds: ['project-1'], topLevelIds: [], parentIds: [],
    assigneeIds: ['u2'], deleted: false, version: 1
  };
  const { context, calls } = createContext({ queryPages: [
    { changes: [firstChange], nextCursor: 'cursor-first', hasMore: false }
  ] });
  vm.runInNewContext('realtimeRunning=true;realtimeCursor="";', context);
  await context.catchUpRealtimeChanges();
  assert.deepEqual(calls.queryCursors, [''], 'an empty cursor is a real initial state and must still query the first event');
  assert.equal(context.getRealtimeState().cursor, 'cursor-first', 'the first-ever event establishes the durable cursor');
  assert.equal(calls.assigned, 1, 'the first-ever event refreshes its assigned user immediately');
}

{
  const { context, api } = createContext();
  context.startRealtimeNotifications();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.getRealtimeState().running, true);
  assert.equal(MockWebSocket.instances.length > 0, true, 'an authenticated ticket opens the configured WebSocket');
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  const url = new URL(socket.url);
  assert.equal(url.searchParams.get('ticket'), 'one-time-ticket', 'the one-time ticket is passed only to the WebSocket handshake');
  socket.readyState = MockWebSocket.OPEN;
  socket.onopen();
  assert.equal(JSON.parse(socket.sent[0]).action, 'ping', 'an immediate heartbeat extends the connection lease');
  context.stopRealtimeNotifications();
  assert.equal(context.getRealtimeState().running, false);
  assert.equal(socket.readyState, MockWebSocket.CLOSED, 'sign-out/page lifecycle cleanup closes the active channel');
}

assert.ok(managerSource.includes("if(message?.type==='items.changed')scheduleRealtimeCatchup(0)"),
  'WebSocket frames act as hints; clients fetch ordered, durable change records instead of trusting push order.');
assert.ok(managerSource.includes('realtimeReconnectDelay=Math.min(30000'),
  'connection retries use bounded exponential backoff.');
assert.ok(managerSource.includes('setInterval(()=>{ping();scheduleRealtimeCatchup(0);},4*60*1000)'),
  'the heartbeat renews the connection lease and provides a lightweight fallback catch-up for any missed WebSocket push.');

console.log('Real-time client tests passed: targeted assignee refresh, unaffected-user isolation, hierarchy updates, ordered cursor catch-up, authenticated connection, heartbeat and cleanup.');
