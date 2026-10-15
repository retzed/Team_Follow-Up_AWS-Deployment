import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const bootstrap = html.match(
  /<script type="text\/plain" id="application-bootstrap">([\s\S]*?)<\/script>/
);
assert.ok(bootstrap, 'application bootstrap script exists');

const declaration = bootstrap[1].match(
  /^[ \t]*const esc = value => String\(value \?\? ''\)\.replace\(.*\);[ \t]*$/m
);
assert.ok(
  declaration,
  'the application must define its central HTML-escaping helper'
);

const escapeHtml = vm.runInNewContext(declaration[0] + '\nesc', {});
assert.equal(
  escapeHtml('<img src=x onerror="alert(1)"> &'),
  '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;',
  'HTML tags, quotes, and ampersands must be escaped before template rendering'
);
assert.equal(
  escapeHtml("\"double\" and 'single'"),
  '&quot;double&quot; and &#39;single&#39;',
  'both quote types must be escaped for safe HTML interpolation'
);
assert.equal(escapeHtml(null), '', 'null values render as empty text');
assert.equal(escapeHtml(undefined), '', 'undefined values render as empty text');
assert.equal(escapeHtml(42), '42', 'non-string display values are converted to text');

console.log('Output-escaping regression tests passed.');
