import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const apiStart = html.indexOf('async function commitItemMutation(');
const apiEnd = html.indexOf('async function queryTopLevel(', apiStart);
assert.ok(apiStart >= 0 && apiEnd > apiStart, 'the adapter must expose an item-scoped commit path');
assert.ok(html.includes('commitSnapshot,commitItemMutation,'), 'the incremental writer must be exported');

const rendererStart = html.indexOf('function renderItemMutationView(');
const rendererEnd = html.indexOf('function userOptions(', rendererStart);
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'the app must have a dedicated mutation renderer');
const renderer = html.slice(rendererStart, rendererEnd);
assert.ok(!renderer.includes('applyTranslations()'), 'an item save must not rewrite the translated shell');
assert.ok(renderer.includes('renderDetail()') && renderer.includes('renderParentList({skipRemote:true})'), 'the renderer must update the visible views without scheduling an eventually-consistent API refresh');

const handlerStart = html.indexOf('function handleItemSubmit(form){');
const handlerEnd = html.indexOf('function clearParentFilters()', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'the item form handler must exist');
const handler = html.slice(handlerStart, handlerEnd);
assert.equal(handler.split('persistItemMutation(item,true,[event])').length - 1, 2,
  'both parent and child creation must use one-item persistence');
assert.ok(handler.includes('persistItemMutation(item,false,mutationEvents)'), 'edits must persist only the changed item and its new audit events');
assert.ok(!handler.includes('persist();'), 'ordinary creates and edits must not snapshot and diff the entire workspace');
assert.ok(handler.includes('renderItemMutationView({refreshSidebar:true})'), 'new items must refresh sidebar counts');
assert.ok(handler.includes("refreshSidebar:oldType==='project'||oldType==='job'"), 'editing a child must not rebuild the sidebar');

const sidebarStart = html.indexOf('function renderParentSearchList(list){');
const sidebarEnd = html.indexOf('function sidebarQueryOptions(', sidebarStart);
assert.ok(sidebarStart >= 0 && sidebarEnd > sidebarStart, 'the sidebar renderer must exist');
const sidebarRenderer = html.slice(sidebarStart, sidebarEnd);
assert.ok(sidebarRenderer.includes('const rootCounts=loadedRootItemCounts()'), 'sidebar item counts must come from one shared root-count index');
assert.ok(!sidebarRenderer.includes('getItemSummary(p)'), 'the sidebar must not traverse every loaded project hierarchy separately');

const countStart = html.indexOf('let loadedRootItemCountsCache=');
const countEnd = html.indexOf('function renderParentSearchList(', countStart);
assert.ok(countStart >= 0 && countEnd > countStart, 'the shared root-count index must be defined before the sidebar renderer');
const countSource = html.slice(countStart, countEnd);
const data = { children: Array.from({ length: 40000 }, (_, index) => ({
  id: 'child-' + index, rootParentId: 'root-' + (index % 200)
})) };
const countContext = { data, hierarchyIndexRevision: 1, rootParent: () => null, Map, String };
vm.runInNewContext(countSource + '\\nthis.loadedRootItemCounts=loadedRootItemCounts;', countContext);
const counts = countContext.loadedRootItemCounts();
assert.equal(counts.size, 200);
assert.equal(counts.get('root-0'), 200, 'the shared count index includes every loaded descendant for its root');
data.children.push({ id: 'child-extra', rootParentId: 'root-0' });
assert.equal(countContext.loadedRootItemCounts().get('root-0'), 201, 'a child insertion invalidates the count cache by collection length');
assert.ok(html.includes('renderOverview(parent,s)'), 'the detail page must reuse its first subtree summary');
assert.ok(html.includes('countNotCompletedForCurrentFilter(parent,all)'), 'the overview must reuse the same subtree for its filtered count');

console.log('Item-mutation responsiveness tests passed.');
