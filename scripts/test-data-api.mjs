import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = await readFile('index.html', 'utf8');
const match = html.match(/<script id="team-follow-up-data-api">([\s\S]*?)<\/script>/);
assert.ok(match, 'data API adapter script exists');
const memory = new Map();
const warnings = [];
const window = { TEAM_FOLLOW_UP_CONFIG: { dataMode: 'builtin' } };
const context = {
  window,
  localStorage: {
    getItem: key => memory.has(key) ? memory.get(key) : null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key)
  },
  console: { warn: (...args) => warnings.push(args.join(' ')), log: () => {} },
  URL, URLSearchParams, Date, JSON, Promise, Object, Map, String, Array, Error, Set, Math, Number, RegExp,
  encodeURIComponent, decodeURIComponent
};
vm.runInNewContext(match[1], context, { filename: 'team-follow-up-data-api.js' });
const api = window.TeamFollowUpDataApi;
assert.ok(api, 'public API object initialized');
assert.equal(api.mode, 'builtin');

const users = [
  { id: 'u1', name: 'Marwa', role: 'Team Leader' },
  { id: 'u2', name: 'Zyad', role: 'AWS Engineer' },
  { id: 'u3', name: 'Nadine', role: 'AWS Engineer' }
];
const parents = [
  { id: 'p-old', type: 'project', name: 'Older project', description: '', status: 'in-progress', ownerId: 'u1', createdBy: 'u1', updatedBy: 'u2', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
  { id: 'p-new', type: 'job', name: 'Newer job', description: '', status: 'not-started', ownerId: 'u2', createdBy: 'u2', updatedBy: 'u1', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
];
const children = [
  { id: 't-1', type: 'task', parentId: 'p-old', rootParentId: 'p-old', name: 'Task 1', description: '', status: 'in-progress', priority: 'high', ownerId: 'u2', createdBy: 'u1', updatedBy: 'u2', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-06-02T00:00:00.000Z' },
  { id: 'f-direct', type: 'followup', parentId: 'p-old', rootParentId: 'p-old', name: 'Direct follow-up', description: '', status: 'not-started', priority: 'medium', ownerId: 'u1', createdBy: 'u2', updatedBy: 'u1', createdAt: '2026-01-04T00:00:00.000Z', updatedAt: '2026-06-03T00:00:00.000Z' },
  { id: 'f-nested', type: 'followup', parentId: 't-1', rootParentId: 'p-old', name: 'Nested follow-up', description: '', status: 'not-started', priority: 'low', ownerId: 'u2', createdBy: 'u3', updatedBy: 'u2', createdAt: '2026-01-05T00:00:00.000Z', updatedAt: '2026-06-04T00:00:00.000Z' }
];
const state = await api.bootstrap({ users, parents, children, activity: [] });
assert.equal(state.parents.length, 2, 'bootstrap returns two top-level items');
assert.equal(state.children.length, 3, 'bootstrap returns child records');

const tableKey = 'team-follow-up-builtin-dynamodb-tables-v1';
const tables = JSON.parse(memory.get(tableKey));
assert.equal(tables.workItems.find(x => x.itemId === 'p-old').listPK, 'TOP_LEVEL');
assert.equal(tables.workItems.find(x => x.itemId === 't-1').listPK, 'PARENT#p-old');
assert.equal(tables.workItems.find(x => x.itemId === 't-1').rootPK, 'ROOT#p-old');
assert.equal(tables.workItems.find(x => x.itemId === 't-1').assigneePK, 'USER#u2');
assert.ok(!Object.hasOwn(tables.userProfiles[0], 'cognitoSub'), 'missing Cognito sub should not be stored as a null GSI key');
assert.ok(Array.isArray(tables.archiveItems), 'the built-in fourth table exists for archived items');
assert.equal(api.tableNames.archive, 'TeamFollowUp-Archive');

const topLastCreated = await api.queryTopLevel({ dateMode: 'last-created' });
assert.equal(topLastCreated.items[0].id, 'p-new', 'last-created sorts newest to oldest');
const topCreated = await api.queryTopLevel({ dateMode: 'created' });
assert.equal(topCreated.items[0].id, 'p-old', 'created sorts oldest to newest');
const directChildren = await api.queryChildren('p-old');
assert.deepEqual(directChildren.items.map(x => x.id).sort(), ['f-direct', 't-1']);
const nestedChildren = await api.queryChildren('t-1');
assert.equal(nestedChildren.items.length, 1);
assert.equal(nestedChildren.items[0].id, 'f-nested');
const assigned = await api.queryAssigned('u2');
assert.ok(assigned.items.some(x => x.id === 't-1'));
assert.ok(assigned.items.every(x => x.ownerId === 'u2'));

const createdAt = new Date().toISOString();
const event = { id: 'evt-transaction-create', itemId: 'p-test', itemName: 'Test project', itemType: 'project', rootParentId: 'p-test', userId: 'u1', action: 'Created project: Test project', kind: 'create', at: createdAt };
await api.request('POST', '/items', { id: 'p-test', type: 'project', name: 'Test project', description: '', status: 'not-started', ownerId: 'u1', createdBy: 'u1', updatedBy: 'u1', createdAt, updatedAt: createdAt, activityEvents: [event] });
let history = await api.queryActivity('p-test', 'item');
assert.equal(history.events.length, 1, 'item and creation event are saved in one built-in transaction');
assert.equal(history.events[0].userId, 'u1');
const deleteEvent = { id: 'evt-transaction-delete', itemId: 'p-test', itemName: 'Test project', itemType: 'project', rootParentId: 'p-test', userId: 'u2', action: 'Deleted project: Test project', kind: 'delete', at: new Date(Date.now() + 1000).toISOString() };
await api.request('DELETE', '/items/p-test', { activityEvents: [deleteEvent] });
const noActiveItem = await api.queryTopLevel({ query: 'Test project' });
assert.equal(noActiveItem.count, 0, 'soft-deleted records are excluded from active queries');
history = await api.queryActivity('p-test', 'item');
assert.equal(history.events.length, 2, 'creation and deletion events remain in history');
const recordedDelete = history.events.find(e => e.id === 'evt-transaction-delete');
assert.ok(recordedDelete, 'delete event is retained');
// Force an exact timestamp tie: deterministic IDs must keep the order stable even when both events
// share the same millisecond (the common cause of list items jumping after selection).
await api.request('PATCH', '/activity/evt-transaction-create', { at: recordedDelete.at });
history = await api.queryActivity('p-test', 'item');
assert.equal(history.events[0].at, history.events[1].at, 'the regression test forces identical timestamps');
assert.equal(history.events[0].id, 'evt-transaction-delete', 'equal-time events use their ID as a stable secondary sort key');

// The global timeline must include all roots, and a colliding event ID must never replace another event.
const collisionRoot = { id: 'p-collision', type: 'project', name: 'Collision project', description: '', status: 'not-started', ownerId: 'u3', createdBy: 'u3', updatedBy: 'u3', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const collidingEvent = { id: 'evt-transaction-create', itemId: 'p-collision', itemName: 'Collision project', itemType: 'project', rootParentId: 'p-collision', userId: 'u3', action: 'Created project: Collision project', kind: 'create', at: new Date(Date.now() + 2000).toISOString() };
await api.request('POST', '/items', { ...collisionRoot, activityEvents: [collidingEvent] });
const globalHistory = await api.queryGlobalActivity();
const collidingRows = globalHistory.events.filter(e => ['p-test', 'p-collision'].includes(e.itemId));
assert.equal(collidingRows.length, 3, 'application-wide history retains both events even when two projects submit the same event ID');
assert.equal(new Set(collidingRows.map(e => e.id)).size, 3, 'every stored audit row has a distinct event ID after collision repair');
assert.ok((window.__TEAM_FOLLOW_UP_API_LOG || []).some(x => x.method === 'GET' && x.path.startsWith('/activity?scope=application')), 'global history uses the application-scoped activity query');

// Deleting a parent cascades into its descendants in one API request and writes one summary event.
const parentForDelete = { id: 'p-delete-tree', type: 'project', name: 'Delete tree project', description: '', status: 'in-progress', ownerId: 'u1', rootParentId: 'p-delete-tree', createdBy: 'u1', updatedBy: 'u1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const taskForDelete = { id: 't-delete-tree', type: 'task', name: 'Delete tree task', description: '', status: 'not-started', priority: 'medium', ownerId: 'u2', parentId: 'p-delete-tree', rootParentId: 'p-delete-tree', createdBy: 'u1', updatedBy: 'u2', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const followupForDelete = { id: 'f-delete-tree', type: 'followup', name: 'Delete tree follow-up', description: '', status: 'not-started', priority: 'low', ownerId: 'u3', parentId: 't-delete-tree', rootParentId: 'p-delete-tree', createdBy: 'u2', updatedBy: 'u3', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
await api.request('POST', '/items', parentForDelete);
await api.request('POST', '/items', taskForDelete);
await api.request('POST', '/items', followupForDelete);
const beforeDeleteCalls = (window.__TEAM_FOLLOW_UP_API_LOG || []).length;
const deleteSummary = { id: 'evt-delete-tree-summary', itemId: 'p-delete-tree', itemName: 'Delete tree project', itemType: 'project', rootParentId: 'p-delete-tree', userId: 'u1', action: 'Deleted project: Delete tree project', kind: 'delete', at: new Date().toISOString(), bulkOperation: 'delete-subtree', affectedCount: 3, affectedDescendantCount: 2 };
await api.commitSnapshot(
  { users, parents: [parentForDelete], children: [taskForDelete, followupForDelete], activity: [] },
  { users, parents: [], children: [], activity: [deleteSummary] }
);
const deletionCalls = (window.__TEAM_FOLLOW_UP_API_LOG || []).slice(beforeDeleteCalls).filter(x => x.method === 'DELETE').map(x => x.path);
assert.equal(deletionCalls.join('|'), '/items/p-delete-tree', 'deleting a subtree makes one DELETE API request for its root');
let allTablesAfterDelete = JSON.parse(memory.get(tableKey));
assert.ok(!allTablesAfterDelete.workItems.some(x => ['p-delete-tree', 't-delete-tree', 'f-delete-tree'].includes(x.itemId)), 'deleted records are moved out of active WorkItems');
assert.deepEqual(allTablesAfterDelete.archiveItems.map(x => x.itemId).filter(id => ['p-delete-tree', 't-delete-tree', 'f-delete-tree'].includes(id)).sort(), ['f-delete-tree', 'p-delete-tree', 't-delete-tree'], 'all three records are present in the Archive table');
const archivedFollowup = allTablesAfterDelete.archiveItems.find(x => x.itemId === 'f-delete-tree');
assert.equal(archivedFollowup.parentId, 't-delete-tree', 'archived follow-up keeps its immediate parent relationship');
assert.equal(archivedFollowup.archiveParentName, 'Delete tree task', 'archive captures an immediate parent-name snapshot for clear relation display');
assert.equal(archivedFollowup.rootParentId, 'p-delete-tree', 'archived follow-up keeps its root parent relationship');
assert.ok(archivedFollowup.archivedAt && archivedFollowup.archiveRootName === 'Delete tree project', 'archive metadata and root snapshot are retained');
const subtreeDeleteEvents = allTablesAfterDelete.activityEvents.filter(e => e.kind === 'delete' && e.rootParentId === 'p-delete-tree');
assert.equal(subtreeDeleteEvents.length, 1, 'deleting a hierarchy creates one summary event rather than one event per descendant');
assert.equal(subtreeDeleteEvents[0].affectedCount, 3, 'delete summary records total items archived');
assert.equal(subtreeDeleteEvents[0].affectedDescendantCount, 2, 'delete summary records descendant count');
const listedArchive = await api.listArchive({ rootParentId: 'p-delete-tree' });
assert.equal(listedArchive.count, 3, 'Archive route lists deleted hierarchy records by root');
await assert.rejects(() => api.restoreArchive(['f-delete-tree'], 'u2'), /Restore the parent item together/, 'a follow-up cannot be restored while its archived task is missing');
const partialRestore = await api.restoreArchive(['p-delete-tree', 't-delete-tree'], 'u2');
assert.deepEqual(partialRestore.restoredItems.map(x => x.id).sort(), ['p-delete-tree', 't-delete-tree'], 'parent can be restored with selected child items only');
assert.equal(partialRestore.activityEvents.length, 1, 'restoring multiple selected parent/child items creates one summary event');
assert.equal(partialRestore.activityEvents[0].itemId, 'p-delete-tree', 'restore summary is anchored to the top-most selected item');
assert.equal(partialRestore.activityEvents[0].affectedCount, 2, 'restore summary records the selected subtree size');
allTablesAfterDelete = JSON.parse(memory.get(tableKey));
assert.equal(allTablesAfterDelete.archiveItems.filter(x => x.archiveRootId === 'p-delete-tree').length, 1, 'unselected follow-up remains archived');
assert.ok(allTablesAfterDelete.workItems.some(x => x.itemId === 'p-delete-tree') && allTablesAfterDelete.workItems.some(x => x.itemId === 't-delete-tree'), 'selected parent and task return to active WorkItems');
assert.ok(!('archiveParentName' in allTablesAfterDelete.workItems.find(x => x.itemId === 't-delete-tree')), 'archive-only relationship snapshots are removed from the active record after restoration');
const followupRestore = await api.restoreArchive(['f-delete-tree'], 'u2');
assert.equal(followupRestore.restoredItems.length, 1, 'follow-up can be restored separately once its parent task is active');
assert.equal(followupRestore.activityEvents.length, 1, 'restoring a single item produces one summary event');
allTablesAfterDelete = JSON.parse(memory.get(tableKey));
assert.ok(!allTablesAfterDelete.archiveItems.some(x => ['p-delete-tree', 't-delete-tree', 'f-delete-tree'].includes(x.itemId)), 'restored items are removed from the active Archive list');
assert.deepEqual(allTablesAfterDelete.workItems.map(x => x.itemId).filter(id => ['p-delete-tree', 't-delete-tree', 'f-delete-tree'].includes(id)).sort(), ['f-delete-tree', 'p-delete-tree', 't-delete-tree'], 'all restored items are active again');
assert.ok(allTablesAfterDelete.activityEvents.some(e => e.kind === 'restore' && e.itemId === 'f-delete-tree'), 'restoration is recorded in retained activity history');

// Regression: every relevant operation must leave durable activity history on the root timeline.
const auditRoot = { id:'p-audit-flow', type:'project', name:'Audit flow project', description:'', status:'not-started', ownerId:'u1', createdBy:'u1', updatedBy:'u1', createdAt:'2026-10-13T10:00:00.000Z', updatedAt:'2026-10-13T10:00:00.000Z' };
const auditRootCreated = { id:'evt-audit-root-create', itemId:auditRoot.id, itemName:auditRoot.name, itemType:'project', rootParentId:auditRoot.id, userId:'u1', action:`Created project: ${auditRoot.name}`, kind:'create', at:'2026-10-13T10:00:00.000Z' };
await api.request('POST','/items',{...auditRoot,activityEvents:[auditRootCreated]});
const auditTask = { id:'t-audit-flow', type:'task', name:'Audit flow task', description:'', status:'not-started', priority:'medium', ownerId:'u2', parentId:auditRoot.id, rootParentId:auditRoot.id, createdBy:'u1', updatedBy:'u1', createdAt:'2026-10-13T10:01:00.000Z', updatedAt:'2026-10-13T10:01:00.000Z' };
const auditTaskCreated = { id:'evt-audit-task-create', itemId:auditTask.id, itemName:auditTask.name, itemType:'task', rootParentId:auditRoot.id, parentId:auditRoot.id, userId:'u1', action:`Created task: ${auditTask.name}`, kind:'create', at:'2026-10-13T10:01:00.000Z' };
await api.request('POST','/items',{...auditTask,activityEvents:[auditTaskCreated]});
const auditStatus = { id:'evt-audit-status', itemId:auditTask.id, itemName:auditTask.name, itemType:'task', rootParentId:auditRoot.id, parentId:auditRoot.id, userId:'u3', action:'Status changed from Not started to Completed.', kind:'status', at:'2026-10-13T10:02:00.000Z' };
const auditUpdate = { id:'evt-audit-update', itemId:auditTask.id, itemName:auditTask.name, itemType:'task', rootParentId:auditRoot.id, parentId:auditRoot.id, userId:'u3', action:`Updated assignee, priority for task: ${auditTask.name}.`, kind:'update', at:'2026-10-13T10:02:01.000Z' };
await api.request('PATCH',`/items/${auditTask.id}`,{...auditTask,status:'completed',priority:'urgent',ownerId:'u3',updatedBy:'u3',updatedAt:'2026-10-13T10:02:01.000Z',activityEvents:[auditStatus,auditUpdate]});
let auditHistory = await api.queryActivity(auditRoot.id,'all');
assert.ok(auditHistory.events.some(e=>e.id==='evt-audit-root-create'),'root creation must be present in root history');
assert.ok(auditHistory.events.some(e=>e.id==='evt-audit-task-create'),'child creation must be present in root history');
assert.ok(auditHistory.events.some(e=>e.id==='evt-audit-status'&&e.kind==='status'),'status change must be present in root history');
assert.ok(auditHistory.events.some(e=>e.id==='evt-audit-update'&&e.action.includes('assignee, priority')),'assignment/priority edits must be present in root history');
const auditDelete = { id:'evt-audit-delete-child', itemId:auditTask.id, itemName:auditTask.name, itemType:'task', rootParentId:auditRoot.id, parentId:auditRoot.id, userId:'u3', action:`Deleted task: ${auditTask.name}`, kind:'delete', at:'2026-10-13T10:03:00.000Z' };
await api.request('DELETE',`/items/${auditTask.id}`,{activityEvents:[auditDelete]});
auditHistory=await api.queryActivity(auditRoot.id,'all');
assert.ok(auditHistory.events.some(e=>e.id==='evt-audit-delete-child'&&e.kind==='delete'),'deleted child event must immediately appear in the surviving parent history');
assert.equal(auditHistory.events[0].id,'evt-audit-delete-child','delete event must sort to the top of the root timeline');
const auditDeleteRoot = { id:'evt-audit-delete-root', itemId:auditRoot.id, itemName:auditRoot.name, itemType:'project', rootParentId:auditRoot.id, userId:'u2', action:`Deleted project: ${auditRoot.name}`, kind:'delete', at:'2026-10-13T10:04:00.000Z' };
await api.request('DELETE',`/items/${auditRoot.id}`,{activityEvents:[auditDeleteRoot]});
const archivedRootHistory=await api.queryActivity(auditRoot.id,'item');
assert.ok(archivedRootHistory.events.some(e=>e.id==='evt-audit-delete-root'),'deleting a parent must still persist its deletion event');
const restoredAuditRoot=await api.restoreArchive([auditRoot.id],'u2');
assert.ok(restoredAuditRoot.activityEvents.some(e=>e.kind==='restore'&&e.itemId===auditRoot.id),'restoring a parent must return a new restore event');
auditHistory=await api.queryActivity(auditRoot.id,'all');
assert.ok(auditHistory.events.some(e=>e.id==='evt-audit-delete-child'),'older child deletion history must remain after restore');
assert.ok(auditHistory.events.some(e=>e.kind==='restore'&&e.itemId===auditRoot.id),'restore event must appear in the root history');

const methodCalls = window.__TEAM_FOLLOW_UP_API_LOG || [];
assert.ok(methodCalls.some(x => x.method === 'GET' && x.path.startsWith('/bootstrap')));
assert.ok(methodCalls.some(x => x.method === 'POST' && x.path === '/items'));
assert.ok(methodCalls.some(x => x.method === 'DELETE' && x.path === '/items/p-test'));
assert.ok(methodCalls.some(x => x.method === 'GET' && x.path.startsWith('/archive')));
assert.ok(methodCalls.some(x => x.method === 'POST' && x.path === '/archive/restore'));
assert.equal(warnings.length, 0, `no adapter storage warnings expected: ${warnings.join('; ')}`);
console.log('Built-in DynamoDB-shaped API tests passed: indexed queries, create/edit/status/assignment/delete/restore event coverage, archive moves, parent-safe selective restoration, retained history, one-request cascade delete and summary-only bulk audit events.');

// Use an independent adapter instance preloaded with more than one archive page to prove
// that the public Archive helper follows nextOffset until every record is retrieved.
const pagingMemory = new Map();
const bulkArchive = Array.from({ length: 525 }, (_, i) => {
  const id = `bulk-archive-${String(i).padStart(4, '0')}`;
  const at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
  return {
    archiveId: id, itemId: id, type: 'project', name: `Bulk archive sample ${i}`,
    description: '', status: 'not-started', ownerId: null, createdBy: 'u1', updatedBy: 'u1',
    createdAt: at, updatedAt: at, rootParentId: id, archiveRootId: id,
    archiveRootName: `Bulk archive sample ${i}`, archivedAt: at, archivedByUserId: 'u1',
    archivePK: 'ARCHIVE', archiveSort: `${at}#${id}`, archiveRootPK: `ROOT#${id}`, archiveRootSort: `${at}#${id}`
  };
});
pagingMemory.set(tableKey, JSON.stringify({ workItems: [], activityEvents: [], userProfiles: users.map(u => ({ userId: u.id, displayName: u.name, role: u.role, enabled: true })), archiveItems: bulkArchive }));
const pagingWindow = { TEAM_FOLLOW_UP_CONFIG: { dataMode: 'builtin' } };
const pagingContext = {
  window: pagingWindow,
  localStorage: {
    getItem: key => pagingMemory.has(key) ? pagingMemory.get(key) : null,
    setItem: (key, value) => pagingMemory.set(key, String(value)),
    removeItem: key => pagingMemory.delete(key)
  },
  console: { warn: (...args) => warnings.push(args.join(' ')), log: () => {} },
  URL, URLSearchParams, Date, JSON, Promise, Object, Map, String, Array, Error, Set, Math, Number, RegExp,
  encodeURIComponent, decodeURIComponent
};
vm.runInNewContext(match[1], pagingContext, { filename: 'team-follow-up-data-api-pagination.js' });
const pagedArchive = await pagingWindow.TeamFollowUpDataApi.listArchive({ query: 'Bulk archive sample' });
assert.equal(pagedArchive.count, 525, 'archive count reports all matching records across pages');
assert.equal(pagedArchive.items.length, 525, 'Archive helper loads all result pages instead of stopping at the first page');
assert.equal(pagedArchive.nextOffset, null, 'aggregated archive result is complete');

console.log('Archive pagination test passed: 525 archived records are returned across pages.');
