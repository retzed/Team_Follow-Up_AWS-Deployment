import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const html = await readFile('index.html', 'utf8');
const backend = await readFile('backend/src/handler.py', 'utf8');
const fn = (name, next) => {
  const start = html.indexOf(`function ${name}(`);
  const end = next ? html.indexOf(`\nfunction ${next}(`, start + 1) : -1;
  assert.ok(start >= 0, `Missing frontend function ${name}`);
  return html.slice(start, end > start ? end : start + 14000);
};

const persistence = fn('persist', 'person');
assert.match(persistence, /commitSnapshot\(lastApiSnapshot,desired\)/, 'All UI mutations must go through the API commit layer.');
assert.match(persistence, /refreshActivityFor\(rootId,'all'\)/, 'New and changed activity must refresh the active root timeline after writes complete.');
assert.match(persistence, /mergeActivityEventsIntoWorkspace\(desired\.activity\|\|\[\]\)/, 'Server-normalized activity events must be merged into the app model.');
assert.match(html, /async function refreshActivityFor\(itemId,scope='all'\)/, 'Activity history has a data-API refresh path.');
assert.match(html, /queryActivity\(String\(itemId\),scope\)/, 'Activity refresh must query the selected item/root from the data API.');
assert.match(fn('openHistory', 'openEdit'), /refreshActivityFor\(/, 'Opening history must refresh from the API.');
assert.match(html, /case 'detail-tab':ui\.tab=actionEl\.dataset\.tab;renderDetail\(\);if\(ui\.tab==='activity'&&ui\.selectedParentId\)void refreshActivityFor\(ui\.selectedParentId,'all'\)/, 'The Activity History tab must refresh the current root timeline.');
assert.match(html, /result\?\.activityEvents\|\|\[\]/, 'Archive restore response events must be retained even while a DynamoDB GSI is catching up.');

const createEdit = fn('handleItemSubmit', 'clearParentFilters');
assert.match(createEdit, /data\.activity\.push\(activityRecord\(item,`Created \$\{type\}: \$\{name\}`,'create',at\)\)/, 'Creating a project/job must record a create event.');
assert.ok(createEdit.includes("action=`Updated ${changed.join(', ')} for ${item.type}: ${item.name}.`;data.activity.push(activityRecord(item,action,'update',item.updatedAt))"), 'Editing name/description/assignee/priority/due date/type must record an update event.');
assert.match(createEdit, /Status changed from \$\{statusName\(oldStatus,'en'\)\} to \$\{statusName\(item\.status,'en'\)\}/, 'Status changes must record a dedicated status event.');
const deletion = fn('deleteItem', 'handleItemSubmit');
assert.match(deletion, /const event=activityRecord\(item,`Deleted \$\{item\.type\}: \$\{item\.name\}`,'delete',deletedAt[\s\S]*?event\.affectedCount=doomedItems\.length;event\.affectedDescendantCount=affectedDescendantCount;[\s\S]*?data\.activity\.push\(event\)/, 'Deleting a hierarchy must record one summary event with item/descendant counts.');
assert.doesNotMatch(deletion, /for\(const snapshot of doomedItems\).*data\.activity\.push/, 'Deletion must not generate one activity event per descendant.');
assert.doesNotMatch(deletion, /root\.updatedAt=deletedAt/, 'Deleting a child must not trigger an unnecessary parent PATCH before the DELETE.');
assert.ok(html.includes("const removalRoots=removed.filter(item=>!removedIds.has(String(item.parentId||''))).sort"), 'A subtree removal identifies only removed items whose parent is not also removed.');
assert.match(html, /await request\('DELETE',`\/items\/\$\{encodeURIComponent\(id\)\}`,\{activityEvents:deletionEvents,cascade:true\}\)/, 'The data API must atomically archive the subtree and attach its single delete summary.');
assert.match(html, /function deleteItem\(id\)[\s\S]*?persist\(\);ui\.modal=null;/, 'The UI persists one cascade-delete command instead of serial per-child deletes.');
assert.match(backend, /if event_kind=='create':[\s\S]*?if event_kind=='delete':/, 'Lambda must construct create and delete audit events server-side.');
assert.match(backend, /fields=\[\('name','name'\),\('description','description'\),\('type','type'\),\('priority','priority'\),\('ownerId','assignee'\),\('dueDate','due date'\)\]/, 'Lambda covers all editable non-status fields in its audit diff.');
assert.match(backend, /Status changed from \{labels\.get\(old_status,old_status\)\} to \{labels\.get\(new_status,new_status\)\}/, 'Lambda records status changes independently.');
assert.ok(backend.includes('def commit_item_with_events(item, events, condition=None, expected_version=None):') && backend.includes('for event in events:') && backend.includes('ddb.meta.client.transact_write_items(TransactItems=writes)'), 'Activity events must be stored transactionally with backend writes.');

assert.match(backend, /GSI_ApplicationTimeline[\s\S]*?applicationPK[\s\S]*?APPLICATION/, 'Application history must query the dedicated indexed timeline rather than scan all events.');
assert.match(backend, /if item_type in \('project','job'\):[\s\S]*?GSI_RootUpdated[\s\S]*?elif item_type=='task':[\s\S]*?GSI_ListUpdated[\s\S]*?else:[\s\S]*?candidate_rows=\[\]/, 'Leaf follow-up deletion avoids a root-wide query and task deletion uses its direct child index.');
assert.match(backend, /x\['applicationPK'\]='APPLICATION'[\s\S]*?x\['applicationSort'\]=stamp/, 'Every new audit event must receive application timeline keys.');
const template = await readFile('backend/template.yaml', 'utf8');
assert.match(template, /IndexName: GSI_ApplicationTimeline[\s\S]*?AttributeName: applicationPK[\s\S]*?AttributeName: applicationSort/, 'CloudFormation must deploy the application history index.');
assert.match(html, /id="applicationHistoryButton" data-action="global-history"/, 'Application-wide history must have a distinct entry point beside Archive.');
assert.doesNotMatch(html, /historyItemQuery/, 'History uses one unified search control rather than a second item-only search.');
assert.equal((html.match(/id="historyQuery" type="search"/g)||[]).length, 2, 'The same single query field is rendered by the mutually exclusive project and application history dialogs.');
assert.match(html, /if\(\!ui\.modal\|\|!\['history','global-history'\]\.includes\(ui\.modal\.kind\)\|\|ev\.target\.id!==?'historyQuery'/, 'One shared input handler filters whichever history dialog is currently open.');
assert.ok(html.includes('application-history-modal') && html.includes('width:min(1360px,calc(100vw - 32px))'), 'Application history dialog expands on desktop while remaining responsive.');
assert.ok(html.includes('.application-history-table{min-width:1080px!important}') && html.includes('.application-history-table col:nth-child(3){width:15%}') && html.includes('border-inline-end:1px solid var(--border)'), 'Application history uses proportional column geometry with visible cell separation to prevent overlap and wasted gaps.');
assert.ok(html.includes("function compareByDateMode(a,b,mode,source='application'){const activityMode=mode==='updated'?'updated':'created';const va=activityTimestamp(a,activityMode,source);const vb=activityTimestamp(b,activityMode,source);") && html.includes("String(a.id||'').localeCompare(String(b.id||''))"), 'Visible Last Updated sorting uses canonical activity timestamps and a deterministic ID tie-breaker.');
assert.ok(html.includes("function historyActionLabel(event)") && html.includes("function historySearchText(event,applicationWide=false)"), 'History uses one action-only formatter and the same cross-column search model.');
assert.ok(html.includes("<th>${esc(tr('time'))}</th><th>${esc(tr('date'))}</th><th>${esc(tr('user'))}</th><th>${esc(tr('itemColumn'))}</th><th>${esc(tr('action'))}</th>"), 'Project history has the standardized five-column schema.');
assert.ok(html.includes("<th>${esc(tr('time'))}</th><th>${esc(tr('date'))}</th><th>${esc(tr('user'))}</th><th>${esc(tr('parentItem'))}</th><th>${esc(tr('childItem'))}</th><th>${esc(tr('action'))}</th>"), 'Application history has the standardized six-column schema.');
assert.match(html, /historySubjectMarkup\(subject\.parentName,subject\.parentType\)[\s\S]*?subject\.isParent\?'<span class="history-dash">—<\/span>':historySubjectMarkup\(subject\.childName,subject\.childType\)/, 'Application history displays typed parent/child values and a dash for parent-level actions.');
assert.match(html, /#mainContent \.child-search-field \.child-search-box[\s\S]*?height: 36px !important/, 'Child search input must be compact and match its sibling controls.');
assert.match(backend, /archive_lookup_cache=\{str\(row\.get\('itemId'\) or ''\):row for row,_ in collected\}[\s\S]*?make_archive_record\(row,archived_at,actor_id,archive_lookup_cache\)/, 'Cascade archive reuses parent/root snapshots and avoids one or more reads per descendant.');
assert.match(backend, /queue_pos=0[\s\S]*?while queue_pos<len\(queue\):[\s\S]*?queue_pos\+=1/, 'Cascade traversal is linear instead of repeatedly shifting a list.');

console.log('Activity-write coverage tests passed: create, edit fields, status, deletion cascade, restore response, collision-safe global history, indexed Lambda audit and compact search controls.');
