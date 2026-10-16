import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const match = html.match(/<script id="team-follow-up-data-api">([\s\S]*?)<\/script>/);
assert.ok(match, 'the frontend must contain the AWS data API module');
const source = match[1];

for (const forbidden of [
  'mockRoute',
  'builtin.local',
  'memoryTables',
  'TABLES_KEY',
  'dataMode',
  'localAuth'
]) {
  assert.ok(!source.includes(forbidden), `AWS data adapter must not contain ${forbidden}`);
}

const storage = new Map();
const localStorage = { getItem:key=>storage.has(key)?storage.get(key):null, setItem:(key,value)=>storage.set(key,String(value)), removeItem:key=>storage.delete(key) };
assert.ok(source.includes("API_CACHE_PREFIX='team-follow-up-api-cache-v1:'") && source.includes('function requestCachedGet(path,key){'), 'Only the API response cache may use browser storage.');
const requests = [];
const project = {
  id: 'project-1',
  type: 'project',
  name: 'Project Alpha',
  description: 'AWS-backed sample fixture used only by this unit test.',
  status: 'in-progress',
  ownerId: 'u1',
  rootParentId: 'project-1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
  createdBy: 'u1',
  updatedBy: 'u1',
  version: 1
};
const task = {
  id: 'task-1',
  type: 'task',
  name: 'Task One',
  parentId: 'project-1',
  rootParentId: 'project-1',
  status: 'not-started',
  priority: 'high',
  createdAt: '2026-10-02T11:00:00.000Z',
  updatedAt: '2026-10-02T11:00:00.000Z',
  createdBy: 'u2',
  updatedBy: 'u2',
  version: 1
};
const createEvent = {
  id: 'evt-create-project',
  itemId: 'project-1',
  rootParentId: 'project-1',
  itemName: 'Project Alpha',
  itemType: 'project',
  userId: 'u1',
  action: 'Created project: Project Alpha',
  kind: 'create',
  at: '2026-10-01T10:00:00.000Z'
};
const user = { id: 'u1', name: 'Marwa', role: 'Team Leader' };

function ok(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}
function versioned(url, key, payload) {
  const version = key + '-v1';
  if (url.searchParams.get('cacheMode') === '1' && url.searchParams.get('cacheVersion') === version) return ok({ notModified: true, version });
  return ok({ ...payload, version });
}
const window = {
  location: { origin: 'https://app.example.test' },
  TeamFollowUpAuth: {
    async authenticatedFetch(path, init = {}) {
      const url = new URL(path, 'https://api.example.test/');
      const method = String(init.method || 'GET').toUpperCase();
      let body;
      try { body = init.body ? JSON.parse(init.body) : undefined; } catch { body = init.body; }
      requests.push({ method, path: url.pathname + url.search, body });

      if (method === 'GET' && url.pathname === '/users') return versioned(url, 'users', { users: [user] });
      if (method === 'GET' && url.pathname === '/items' && url.searchParams.get('scope') === 'top-level') {
        return versioned(url, 'top-level', { items: [project], count: 1, nextOffset: null });
      }
      if (method === 'GET' && url.pathname === '/items' && url.searchParams.has('rootParentId')) {
        return versioned(url, 'root-items', { items: [project, task], count: 2, nextOffset: null });
      }
      if (method === 'GET' && url.pathname === '/items/project-1/activity') {
        return versioned(url, 'item-activity', { events: [createEvent], count: 1 });
      }
      if (method === 'GET' && url.pathname === '/activity') return versioned(url, 'global-activity', { events: [createEvent], count: 1 });
      if (method === 'GET' && url.pathname === '/items/assigned-to-me') return versioned(url, 'assigned', { items: [task], count: 1, nextOffset: null });
      if (method === 'GET' && url.pathname === '/items/project-1/children') return versioned(url, 'children', { items: [task], count: 1, nextOffset: null });
      if (method === 'GET' && url.pathname === '/archive') return versioned(url, 'archive', { items: [], count: 0, nextOffset: null });
      if (method === 'POST' && url.pathname === '/archive/restore') return ok({ restoredIds: body?.itemIds || [] });
      if (method === 'PATCH' && url.pathname === '/items/project-1') {
        return ok({ item: { ...body, id: 'project-1' }, activityEvents: body.activityEvents || [] });
      }
      if (method === 'POST' && url.pathname === '/items') {
        return ok({ item: { ...body }, activityEvents: body.activityEvents || [] }, 201);
      }
      if (method === 'DELETE' && url.pathname.startsWith('/items/')) return ok({ ok: true, itemId: 'project-1', activityEvents: [] });
      throw new Error(`Unexpected mock backend call: ${method} ${url.pathname}${url.search}`);
    }
  }
};
vm.runInNewContext(source, { window, localStorage, console, URL, URLSearchParams });

const api = window.TeamFollowUpDataApi;
assert.ok(api, 'AWS data API must be registered');
assert.equal(api.mode, undefined, 'the runtime must not expose a local-vs-API mode toggle');

const progress = [];
const snapshot = await api.bootstrap((partial, meta) => progress.push({ count: partial.parents.length + partial.children.length, stage: meta.stage }));
assert.equal(snapshot.users.length, 1);
assert.equal(snapshot.users[0].id, 'u1');
assert.equal(snapshot.parents.length, 1);
assert.equal(snapshot.parents[0].id, 'project-1');
assert.equal(snapshot.children.length, 0, 'bootstrap must not fetch descendant items');
assert.equal(snapshot.activity.length, 0, 'bootstrap must not fetch Activity history');
assert.ok(!requests.some(request => request.path.includes('/activity')), 'bootstrap must not request Activity routes');
assert.ok(!requests.some(request => request.path.includes('rootParentId=')), 'bootstrap must not fetch descendants of every root');
assert.ok(progress.some(entry => entry.stage === 'parents-complete'));
assert.ok(progress.some(entry => entry.stage === 'complete'));

const rootItems = await api.queryRootItems('project-1');
assert.equal(rootItems.items.length, 1, 'opening the dashboard should load only the selected root descendants');
assert.equal(rootItems.items[0].id, 'task-1');
assert.ok(!requests.some(request => request.path === '/activity?scope=application'), 'global activity must remain unloaded until its popup opens');
assert.equal((await api.queryActivity('project-1', 'all')).events.length, 1, 'item activity should be fetched only on request');
await api.queryAssigned('u1', { status: 'not-completed', query: 'Task' });
await api.queryChildren('project-1', { type: 'task' });
assert.equal((await api.queryGlobalActivity()).events.length, 1);
assert.equal((await api.listArchive()).items.length, 0);
for (const key of ['team-users','top-level-items','root-items:project-1','activity:project-1:all','activity:application','assigned-query:dateMode=updated&direction=desc&status=not-completed&q=Task','children-query:project-1:dateMode=updated&direction=desc&type=task','archive-page:/archive?limit=250&offset=0']) {
  assert.ok(storage.has('team-follow-up-api-cache-v1:' + key), `the disk cache must persist ${key}`);
}
const beforeRevalidation = requests.length;
assert.equal((await api.queryGlobalActivity()).events.length, 1, 'an unchanged global timeline reuses the persisted payload');
assert.ok(requests.slice(beforeRevalidation).some(request => request.path.includes('cacheVersion=global-activity-v1')), 'the next Activity read asks for a version check rather than a full payload');
const beforeSecondBootstrap = requests.length;
const secondBootstrap = await api.bootstrap();
assert.equal(secondBootstrap.parents[0].id, 'project-1');
assert.ok(requests.slice(beforeSecondBootstrap).some(request => request.path.includes('/users?cacheMode=1&cacheVersion=users-v1')), 'startup validates stored team profiles');
assert.ok(requests.slice(beforeSecondBootstrap).some(request => request.path.includes('cacheVersion=top-level-v1')), 'startup validates stored Project/Job rows');
await api.restoreArchive(['archived-id-1']);
assert.ok(requests.some(request => request.path.startsWith('/items/assigned-to-me?')));
assert.ok(requests.some(request => request.path.startsWith('/items?rootParentId=project-1')));
assert.ok(requests.some(request => request.path.startsWith('/items/project-1/activity?scope=all')));
assert.ok(requests.some(request => request.path.startsWith('/items/project-1/children?')));
assert.ok(requests.some(request => request.path.startsWith('/activity?scope=application')));
assert.ok(requests.some(request => request.path.startsWith('/archive?')));
assert.ok(requests.some(request => request.method === 'POST' && request.path === '/archive/restore'));

const updatedSnapshot = structuredClone(snapshot);
updatedSnapshot.parents[0].name = 'Project Alpha Updated';
await api.commitSnapshot(snapshot, updatedSnapshot);
const patch = requests.find(request => request.method === 'PATCH' && request.path === '/items/project-1');
assert.ok(patch, 'changed work items must be sent to the AWS API');
assert.equal(patch.body.name, 'Project Alpha Updated');

const insertedSnapshot = structuredClone(updatedSnapshot);
insertedSnapshot.children.push({
  id: 'task-2',
  type: 'task',
  name: 'Task Two',
  parentId: 'project-1',
  rootParentId: 'project-1',
  status: 'not-started',
  priority: 'medium',
  createdBy: 'u1'
});
insertedSnapshot.activity.push({
  id: 'evt-create-task-2',
  itemId: 'task-2',
  rootParentId: 'project-1',
  itemName: 'Task Two',
  itemType: 'task',
  userId: 'u1',
  action: 'Created task: Task Two',
  kind: 'create',
  at: '2026-10-03T10:00:00.000Z'
});
await api.commitSnapshot(updatedSnapshot, insertedSnapshot);
const post = requests.find(request => request.method === 'POST' && request.path === '/items');
assert.ok(post, 'new work items must be sent to the AWS API');
assert.equal(post.body.id, 'task-2');
assert.equal(post.body.activityEvents[0].id, 'evt-create-task-2');

console.log('AWS-only data API tests passed: remote bootstrap, indexed route queries, archive restore, and API-backed item/audit writes.');
