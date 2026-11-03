import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));

test('site build copies the progressive search module into the Pages artifact', async () => {
  execFileSync(process.execPath, ['scripts/build-site.mjs'], { cwd: root });
  const [source, built, html, sourceIcon, builtIcon] = await Promise.all([
    readFile(new URL('../site/search.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../dist/search.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../assets/favicon.svg', import.meta.url), 'utf8'),
    readFile(new URL('../dist/assets/favicon.svg', import.meta.url), 'utf8'),
  ]);
  assert.equal(built, source);
  assert.equal(builtIcon, sourceIcon);
  assert.match(html, /<script type="module" src="search\.mjs"><\/script>/);
  assert.match(html, /<form[^>]*data-resource-search[^>]*hidden/);
});
