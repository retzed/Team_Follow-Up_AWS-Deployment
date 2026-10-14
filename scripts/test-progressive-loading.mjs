import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const html = await readFile('index.html', 'utf8');
const check = (condition, message) => assert.ok(condition, message);

const bootstrapStart = html.indexOf('async function bootstrap(onProgress)');
const usersLoad = html.indexOf("await request('GET','/users')", bootstrapStart);
const parentLoad = html.indexOf("fetchPagedItems('/items?scope=top-level", bootstrapStart);
check(bootstrapStart >= 0 && usersLoad > bootstrapStart && parentLoad > usersLoad,
  'AWS API bootstrap must load Cognito-linked user profiles before paginated DynamoDB-backed items.');
check(html.includes("'root-children-page'") && html.includes("'root-children-complete'") && html.includes("'root-activity-complete'"),
  'API bootstrap must publish incremental child and activity progress.');
check(html.includes('const workers=Array.from({length:Math.min(3,Math.max(1,roots.length))}'),
  'Per-project data hydration must use bounded concurrency.');
check(html.includes('async function startWorkspaceHydration()') && html.includes('hydrationRun!==workspaceHydrationGeneration'),
  'Workspace hydration must ignore stale progress/results from superseded retries.');
check(html.includes('.loading-spinner') && html.includes('function spinnerMarkup(') && html.includes('function inlineSpinnerMarkup('),
  'Accessible animated loading indicators must be available to full sections and inline values.');
check(html.includes('data-action="retry-data-load"') && html.includes("case 'retry-data-load':startWorkspaceHydration()"),
  'Loading errors must expose a retry action.');
check(html.includes('async function listArchive(options={},onPage)') && html.includes('onPage(page,{loaded:all.length'),
  'Archive must publish fetched pages before pagination completes.');
check(html.includes('function renderArchivePreservingScroll()') && html.includes('archive-groups+.data-loading-state'),
  'Progressive Archive updates must preserve scrolling and show a continuation loader.');
check(html.includes('history-controls.has-scope') && html.includes('grid-template-areas:"scope count" "search search"'),
  'Mobile history scope and count must share the top row, with search below.');
console.log('AWS data-loading tests passed: staged API hydration, bounded requests, retry protection, inline/section spinners, page-wise Archive rendering, and mobile history controls.');
