import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
assert.ok(renderer.includes('renderDetail()') && renderer.includes('renderParentList()'), 'the renderer must refresh affected views');

const handlerStart = html.indexOf('function handleItemSubmit(form){');
const handlerEnd = html.indexOf('function clearParentFilters()', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'the item form handler must exist');
const handler = html.slice(handlerStart, handlerEnd);
assert.equal((handler.match(/persistItemMutation\\(item,true,\\[event\\]\\)/g) || []).length, 2,
  'both parent and child creation must use one-item persistence');
assert.ok(handler.includes('persistItemMutation(item,false,mutationEvents)'), 'edits must persist only the changed item and its new audit events');
assert.ok(!handler.includes('persist();'), 'ordinary creates and edits must not snapshot and diff the entire workspace');
assert.ok(handler.includes('renderItemMutationView({refreshSidebar:true})'), 'new items must refresh sidebar counts');
assert.ok(handler.includes("refreshSidebar:oldType==='project'||oldType==='job'"), 'editing a child must not rebuild the sidebar');

assert.ok(html.includes('const childReady=rootChildrenReady(p.id);const itemCount=childReady?getItemSummary(p).all.length:0;'),
  'sidebar counts must not traverse children for roots whose children are not loaded');
assert.ok(html.includes('renderOverview(parent,s)'), 'the detail page must reuse its first subtree summary');
assert.ok(html.includes('countNotCompletedForCurrentFilter(parent,all)'), 'the overview must reuse the same subtree for its filtered count');

console.log('Item-mutation responsiveness tests passed.');
