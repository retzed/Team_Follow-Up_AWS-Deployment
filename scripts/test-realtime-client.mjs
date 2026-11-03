import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const managerStart = html.indexOf('let realtimeSocket=null,realtimeReconnectTimer=null');
const managerEnd = html.indexOf('async function startWorkspaceHydration()', managerStart);
assert.ok(managerStart >= 0 && managerEnd > managerStart, 'the app must contain the real-time client manager');
const managerSource = html.slice(managerStart, managerEnd);

let nextTimerId = 1;
const timers = new Map();
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    this.url = String(url);
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }
  send(value) { this.sent.push(String(value)); }
  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this.closedWith = { code, reason };
    this.onclose?.({ code, reason });
  }
}

function createContext(overrides = {}) {
  const calls = { assigned: 0, pinned: 0, resolved: [], parentRenders: 0, detailRenders: 0, accountRenders: 0, queryCursors: [], intervals: [], clearedIntervals: [] };
  const ui = {
    actingUserId: 'u2', page: 'account', accountTab: 'assigned',
    accountAssignedLoaded: true, accountAssignedLoading: false, accountAssignedRows: [],
    accountPinnedLoaded: true, accountPinnedLoading: false, accountPinnedRows: [],
    selectedParentId: 'project-1', selectedAssignedItemId: null, tab: 'overview', modal: null
  };
  const data = {
    parents: [{ id: 'project-1', type: 'project', name: 'Existing project', updatedAt: '2026-10-01T00:00:00.000Z' }],
    children: [{ id: 'task-1', type: 'task', name: 'Existing task', rootParentId: 'project-1', ownerId: 'u2' }]
  };
  const queryPages = [...(overrides.queryPages || [])];
  const api = {
    remoteApi: true,
    createRealtimeTicket: async () => ({ ticket: 'one-time-ticket', cursor: 'cursor-0' }),
    queryRealtimeChanges: async since => {
      calls.queryCursors.push(since);
      return queryPages.shift() || { changes: [], nextCursor: since, hasMore: false };
    },
    resolveItems: async ids => {
      calls.resolved.push([...ids]);
      const source = overrides.resolvedItems !== undefined
        ? overrides.resolvedItems
        : [...data.parents, ...data.children];
      return { items: source.filter(item => ids.includes(String(item.id || item.itemId))) };
    }
  };
  const windowEvents = {};
  const documentEvents = {};
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
      addEventListener: (name, callback) => { documentEvents[name] = callback; }
    },
    navigator: { onLine: true },
    WebSocket: MockWebSocket,
    ui, data, lastApiSnapshot: { parents: data.parents.map(x => ({ ...x })), children: data.children.map(x => ({ ...x })) },
    dataLoadState: { childrenLoaded: new Set(['project-1']) },
    rawCurrentUser: () => ({ id: 'u2' }),
    rootParent: row => row?.rootParentId ? data.parents.find(parent => parent.id === row.rootParentId) || { id: row.rootParentId } : null,
    allItem: id => [...data.parents, ...data.children].find(item => String(item.id) === String(id)) || null,
    copyWorkspace: value => JSON.parse(JSON.stringify(value)),
    invalidateHierarchyIndex: () => {},
    renderParentList: () => { calls.parentRenders += 1; },
    renderDetail: () => { calls.detailRenders += 1; },
    renderAccountPage: () => { calls.accountRenders += 1; },
    refreshActivityFor: async () => {},
    refreshApplicationHistory: () => {},
    loadAccountAssignedItems: async () => { calls.assigned += 1; ui.accountAssignedLoading = false; ui.accountAssignedLoaded = true; },
    loadAccountPinnedItems: async () => { calls.pinned += 1; },
    toAppItem: row => row,
    assignedItemCache: new Map(),
    console: { warn() {}, error() {}, log() {} },
    setTimeout: callback => { const id=nextTimerId++; timers.set(id,callback); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => { calls.intervals.push(delay); const id=nextTimerId++; timers.set(id,callback); return id; },
    clearInterval: id => { calls.clearedIntervals.push(id); timers.delete(id); },
    Math, URL, URLSearchParams, JSON, Promise, Set, Map, String, Number, WebSocket: MockWebSocket
  };
  vm.runInNewContext(
    managerSource + '\n' +
    'this.applyRealtimeChangeBatch=applyRealtimeChangeBatch;' +
    'this.queueRealtimeChangeBatch=queueRealtimeChangeBatch;' +
    'this.catchUpRealtimeChanges=catchUpRealtimeChanges;' +
    'this.startRealtimeNotifications=startRealtimeNotifications;' +
    'this.stopRealtimeNotifications=stopRealtimeNotifications;' +
    'this.getRealtimeState=()=>({running:realtimeRunning,cursor:realtimeCursor});' +
    'this.isApplied=id=>realtimeAppliedChangeIds.has(id);',
    context
  );
  return { context, calls, api, ui, data, windowEvents, documentEvents, overrides };
}

{
  const item = { id: 'task-1', type: 'task', name: 'Assigned just now', rootParentId: 'project-1', ownerId: 'u2', version: 2 };
  const { context, calls, ui, data } = createContext({ resolvedItems: [item] });
  await context.applyRealtimeChangeBatch([{
    type: 'items.changed', changeId: 'assignment-change',
    itemId: 'task-1', rootParentIds: ['project-1'], assigneeIds: ['u1', 'u2'],
    parentIds: ['project-1'], topLevelIds: [], deleted: false, version: 2
  }]);
  assert.equal(ui.accountAssignedLoaded, true, 'an already-loaded Assigned Items view stays authoritative');
  assert.equal(calls.assigned, 0, 'an item update is not followed by an eventually-consistent AssignedToIndex reload');
  assert.equal(ui.accountAssignedRows.length, 1, 'the strongly-read item is inserted into Assigned Items directly');
  assert.equal(ui.accountAssignedRows[0].name, 'Assigned just now');
  assert.equal(data.children.find(row => row.id === 'task-1').version, 2, 'the exact item is merged into the workspace model');
  assert.equal(calls.parentRenders, 0, 'child updates do not rebuild the parent sidebar');
  assert.equal(calls.detailRenders, 0, 'an inactive workspace detail is not needlessly rebuilt while the user is on the profile page');
}

{
  const item = { id: 'task-1', type: 'task', name: 'Reassigned away', rootParentId: 'project-1', ownerId: 'u3', version: 3 };
  const { context, calls, ui } = createContext({ resolvedItems: [item] });
  ui.accountAssignedRows = [{ id: 'task-1', type: 'task', ownerId: 'u2' }];
  await context.applyRealtimeChangeBatch([{
    type: 'items.changed', changeId: 'assignment-away',
    itemId: 'task-1', rootParentIds: ['project-1'], assigneeIds: ['u2', 'u3'],
    parentIds: ['project-1'], topLevelIds: [], deleted: false, version: 3
  }]);
  assert.equal(ui.accountAssignedRows.length, 0, 'an item reassigned to another user is removed from the previous assignee immediately');
  assert.equal(calls.assigned, 0, 'reassignment does not depend on an eventually-consistent assignment index');
}

{
  const resolvedProject = { id: 'project-new', type: 'project', name: 'Project after edit', updatedAt: '2026-11-02T00:00:00.000Z', version: 2 };
  const { context, calls, data, ui } = createContext({ resolvedItems: [resolvedProject] });
  data.parents = [{ id: 'project-old', type: 'project', name: 'Existing project' }];
  data.children = [{ id: 'task-old', type: 'task', rootParentId: 'project-old' }];
  ui.selectedParentId = 'project-old';
  await context.applyRealtimeChangeBatch([
    {
      type: 'items.changed', changeId: 'delete-old',
      itemId: 'project-old', itemIds: ['project-old', 'task-old'],
      rootParentIds: ['project-old'], assigneeIds: [],
      parentIds: [], topLevelIds: ['project-old'], deleted: true, version: 3
    },
    {
      type: 'items.changed', changeId: 'create-and-edit-new',
      itemId: 'project-new', itemIds: ['project-new'], rootParentIds: ['project-new'], assigneeIds: ['u2'],
      parentIds: [], topLevelIds: ['project-new'], deleted: false, version: 2
    }
  ]);
  assert.deepEqual(calls.resolved, [['project-new']], 'only non-deleted changed IDs require a strong read');
  assert.deepEqual(data.parents.map(row => row.id), ['project-new'], 'a deleted parent is removed while a newly-created and quickly-edited parent is retained');
  assert.equal(data.parents[0].name, 'Project after edit', 'the newest item version wins when create and edit notifications overlap');
  assert.equal(ui.selectedParentId, 'project-new', 'a deleted selection moves to the replacement active root');
  assert.ok(!data.children.some(row => row.rootParentId === 'project-old'), 'children of a deleted root are removed');
  assert.ok(calls.parentRenders > 0, 'top-level changes refresh the sidebar locally');
  assert.ok(!calls.queryCursors.length, 'applying a pushed item change does not require a query-index round trip');
}

{
  const project = { id: 'project-1', type: 'project', name: 'Renamed project', version: 4 };
  const { context, calls, ui, data } = createContext({ resolvedItems: [project] });
  ui.accountTab = 'search';
  await context.applyRealtimeChangeBatch([{
    type: 'items.changed', changeId: 'parent-edit',
    itemId: 'project-1', rootParentIds: ['project-1'], topLevelIds: ['project-1'],
    assigneeIds: ['u3'], parentIds: [], deleted: false, version: 4
  }]);
  assert.equal(data.parents[0].name, 'Renamed project');
  assert.equal(calls.accountRenders, 1, 'the open Account Search view refreshes from the strongly-read changed parent');
}

{
  const { context, data, ui, overrides } = createContext({ resolvedItems: [] });
  const change = {
    type: 'items.changed', changeId: 'temporarily-missing-item',
    itemId: 'project-new', rootParentIds: ['project-new'], topLevelIds: ['project-new'],
    assigneeIds: ['u2'], deleted: false, version: 1
  };
  await assert.rejects(context.applyRealtimeChangeBatch([change]), /consistent item read/);
  assert.ok(data.parents.some(row => row.id === 'project-1'), 'a temporarily missing read must not delete another visible parent');
  assert.equal(context.isApplied('temporarily-missing-item'), false, 'a failed resolution must remain eligible for durable retry');
  overrides.resolvedItems = [{ id: 'project-new', type: 'project', name: 'Recovered item', ownerId: 'u2', version: 1 }];
  await context.applyRealtimeChangeBatch([change]);
  assert.ok(data.parents.some(row => row.id === 'project-new'), 'the same event applies when the base-table read becomes visible');
  assert.equal(context.isApplied('temporarily-missing-item'), true);
}

{
  const { context, calls } = createContext({
    queryPages: [{
      changes: [{
        type: 'items.changed', changeId: 'batch-a', cursor: 'cursor-a',
        itemId: 'task-1', rootParentIds: ['project-1'], assigneeIds: ['u2'], deleted: false
      }, {
        type: 'items.changed', changeId: 'batch-b', cursor: 'cursor-b',
        itemId: 'task-2', rootParentIds: ['project-1'], assigneeIds: ['u2'], deleted: false
      }],
      nextCursor: 'cursor-b', hasMore: false
    }],
    resolvedItems: [
      { id: 'task-1', type: 'task', rootParentId: 'project-1', ownerId: 'u2' },
      { id: 'task-2', type: 'task', rootParentId: 'project-1', ownerId: 'u2' }
    ]
  });
  vm.runInNewContext('realtimeRunning=true;realtimeCursor="cursor-0";', context);
  await context.catchUpRealtimeChanges();
  assert.equal(context.getRealtimeState().cursor, 'cursor-b', 'the durable cursor advances after all changed items are applied');
  assert.deepEqual(calls.queryCursors, ['cursor-0'], 'durable catch-up preserves an opaque cursor when no timestamp can be extracted');
}

{
  const { context, calls, overrides } = createContext({ resolvedItems: [{ id: 'task-1', type: 'task', rootParentId: 'project-1', ownerId: 'u2' }] });
  context.startRealtimeNotifications();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.getRealtimeState().running, true);
  assert.ok(calls.intervals.includes(5000), 'each active session checks its own durable feed');
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  const url = new URL(socket.url);
  assert.equal(url.searchParams.get('ticket'), 'one-time-ticket');
  socket.readyState = MockWebSocket.OPEN;
  socket.onopen();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(socket.sent[0]).action, 'ping');
  assert.equal(calls.assigned, 1, 'the first connection performs its initial Assigned Items synchronization');
  const pushed = {
    type: 'items.changed', changeId: 'pushed-assignment', cursor: 'cursor-pushed',
    itemId: 'task-1', rootParentIds: ['project-1'], topLevelIds: [], parentIds: ['project-1'],
    assigneeIds: ['u1', 'u2'], deleted: false, version: 5
  };
  socket.onmessage({ data: JSON.stringify(pushed) });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.assigned, 1, 'a pushed assignment updates the loaded view without another GSI read');
  assert.ok(context.ui.accountAssignedRows.some(row => row.id === 'task-1'), 'the pushed item is added immediately');
  await context.queueRealtimeChangeBatch([pushed]);
  assert.equal(calls.assigned, 1, 'duplicate feed delivery is ignored');
  context.stopRealtimeNotifications();
  assert.equal(context.getRealtimeState().running, false);
  assert.ok(calls.clearedIntervals.length >= 2, 'sign-out clears the heartbeat and polling timers');
  assert.equal(socket.readyState, MockWebSocket.CLOSED);
}

{
  const { context, calls } = createContext();
  vm.runInNewContext('realtimeRunning=true;realtimeCursor="2026-11-02T12:30:00.123456Z#latest";', context);
  await context.catchUpRealtimeChanges();
  assert.ok(calls.queryCursors.length === 1, 'the durable cursor is queried independently of WebSocket delivery');
  assert.ok(calls.queryCursors[0].startsWith('2026-11-02T12:29:00.123000Z#'), 'durable catch-up overlaps one minute to recover late commits');
}

assert.ok(managerSource.includes('api.resolveItems(resolveIds.slice(start,start+100))') || managerSource.includes('api.resolveItems(ids.slice(start,start+100))'),
  'all changed active items are resolved by ID instead of replacing lists with eventually-consistent index queries');
assert.ok(managerSource.includes('realtimeItemOverlay') && managerSource.includes('mergeRealtimeItemOverlays'),
  'a recently changed item survives stale parent, child, and assignee-index responses');
assert.ok(managerSource.includes('if(missing.length)throw new Error('),
  'a temporarily missing strong read must be retried instead of interpreted as deletion');
assert.ok(managerSource.includes('for(const item of resolvedById.values())') && managerSource.includes('ownerId||' + "'')===currentUserId"),
  'Assigned Items is updated from the exact changed record without waiting for its eventually-consistent GSI');
assert.ok(managerSource.includes('rememberRealtimeChange(change)'),
  'successfully applied changes are deduplicated after their item data is merged');

console.log('Real-time client tests passed: strongly-read item merges, create-then-edit ordering, safe missing-row retry, immediate assignment delivery, GSI overlays and durable catch-up.');
