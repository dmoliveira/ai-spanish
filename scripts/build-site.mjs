import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSite } from '../site/render.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'dist');
const [markdown, template] = await Promise.all([
  readFile(resolve(root, 'README.md'), 'utf8'),
  readFile(resolve(root, 'site/template.html'), 'utf8'),
]);
const html = await renderSite(markdown, template);
await mkdir(resolve(output, 'assets'), { recursive: true });
await Promise.all([
  writeFile(resolve(output, 'index.html'), html),
  copyFile(resolve(root, 'site/style.css'), resolve(output, 'style.css')),
  copyFile(resolve(root, 'site/search.mjs'), resolve(output, 'search.mjs')),
  copyFile(resolve(root, 'assets/hero.svg'), resolve(output, 'assets/hero.svg')),
  copyFile(resolve(root, 'assets/favicon.svg'), resolve(output, 'assets/favicon.svg')),
]);
console.log('Built dist/index.html from README.md');
