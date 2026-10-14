import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const start = html.indexOf('function normalizeActivityEventForUi(raw){');
const end = html.indexOf('\nfunction ensureActivityIndex(){', start);
assert.ok(start >= 0 && end > start, 'Could not isolate the activity merge pipeline.');
const context = {
  data: { parents: [], children: [], activity: [] },
  allItem: () => null,
  rootParent: () => null,
  ensureActivityRootSnapshotIndex: () => new Map(),
  invalidateActivityIndexes: () => {},
  historySearchCache: new Map(),
};
vm.runInNewContext(html.slice(start, end) + ';this.mergeActivityRows=mergeActivityRows;this.activityIdentity=activityIdentity;this.activityLogicalIdentity=activityLogicalIdentity;', context);

const clientEvent = {
  id: 'evt-delete-regression', itemId: 'f-1', itemName: 'Review request', itemType: 'followup',
  rootParentId: 'p-1', rootParentName: 'Project One', rootParentType: 'project', parentId: 't-1',
  userId: 'u1', kind: 'delete', action: 'Deleted followup: Review request', at: '2026-10-14T06:10:00.100Z'
};
const serverEvent = {
  ...clientEvent,
  at: '2026-10-14T06:10:00.325Z',
  itemNameSnapshot: clientEvent.itemName,
  itemTypeSnapshot: clientEvent.itemType,
  actorUserId: clientEvent.userId,
};
const merged = context.mergeActivityRows([clientEvent], [serverEvent]);
assert.equal(merged.rows.length, 1, 'A server-normalized timestamp must update the deletion event, not create a duplicate.');
assert.equal(merged.rows[0].id, clientEvent.id, 'The original stable event ID must be preserved.');
assert.equal(merged.rows[0].at, serverEvent.at, 'The authoritative server timestamp must win.');

const legacyAlias = { ...serverEvent, id: `${clientEvent.id}~old-timestamp-hash` };
const migrated = context.mergeActivityRows([clientEvent, legacyAlias], []);
assert.equal(migrated.rows.length, 1, 'Existing timestamp-collision aliases from earlier builds must be consolidated.');
assert.equal(migrated.rows[0].id, clientEvent.id, 'Legacy duplicates must collapse back to the base event ID.');
assert.equal(migrated.rows[0].at, serverEvent.at, 'Legacy duplicate consolidation should retain the later server-normalized timestamp.');

const trueCollision = { ...serverEvent, itemId: 'another-item', itemName: 'Different item', action: 'Deleted task: Different item' };
const collisions = context.mergeActivityRows([clientEvent], [trueCollision]);
assert.equal(collisions.rows.length, 2, 'A reused event ID with a different action/item remains a separate collision-safe row.');
assert.equal(new Set(collisions.rows.map(row => row.id)).size, 2, 'True event-ID collisions must receive distinct IDs.');

const firstAdapterIdentity = html.indexOf('function activityIdentity(event){');
const firstAdapterIdentityEnd = html.indexOf('\n', firstAdapterIdentity);
const adapterIdentity = html.slice(firstAdapterIdentity, firstAdapterIdentityEnd);
assert.ok(firstAdapterIdentity >= 0 && adapterIdentity.length > 0 && !adapterIdentity.includes("String(event.at||'')"), 'The built-in event store must treat a timestamp normalization as the same event ID, not a new audit row.');
console.log('Activity merge idempotency tests passed: server-normalized deletes do not duplicate, legacy timestamp aliases are repaired, and true ID collisions are preserved.');
