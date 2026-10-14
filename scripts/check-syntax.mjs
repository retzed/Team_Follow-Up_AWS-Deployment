import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile('index.html', 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
let checked = 0;
for (const [, attrs, body] of scripts) {
  if (/type=[\"']application\/json[\"']/i.test(attrs)) continue;
  if (!body.trim()) continue;
  new vm.Script(body, { filename: `inline-script-${++checked}.js` });
}
console.log(`Parsed ${checked} executable inline scripts successfully.`);
