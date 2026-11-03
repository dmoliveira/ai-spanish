import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import rehypeParse from 'rehype-parse';
import { visit } from 'unist-util-visit';
import { renderSite } from '../site/render.mjs';

const template = await readFile(new URL('../site/template.html', import.meta.url), 'utf8');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const parseHtml = (html) => unified().use(rehypeParse).parse(html);

function elements(tree, tagName) {
  const found = [];
  visit(tree, 'element', (node) => { if (node.tagName === tagName) found.push(node); });
  return found;
}

test('the complete README resource list survives in the generated site', async () => {
  const markdown = unified().use(remarkParse).use(remarkGfm).parse(readme);
  const firstSection = markdown.children.findIndex((node) => node.type === 'heading' && node.depth === 2);
  assert.ok(firstSection >= 0);
  const definitions = new Map();
  visit(markdown, 'definition', (node) => {
    if (!definitions.has(node.identifier.toLowerCase())) definitions.set(node.identifier.toLowerCase(), node.url);
  });
  markdown.children = markdown.children.slice(firstSection);
  const sourceLinks = [];
  visit(markdown, 'link', (node) => sourceLinks.push(node.url));
  visit(markdown, 'linkReference', (node) => {
    const url = definitions.get(node.identifier.toLowerCase());
    assert.ok(url, `undefined reference: ${node.identifier}`);
    sourceLinks.push(url);
  });
  const page = parseHtml(await renderSite(readme, template));
  const pageLinks = new Set(elements(page, 'a').map((node) => node.properties.href));
  assert.ok(sourceLinks.length > 100, 'resource list unexpectedly small');
  for (const url of sourceLinks) assert.ok(pageLinks.has(url), `missing resource link: ${url}`);
  assert.ok(elements(page, 'table').length > 5, 'GFM tables were not rendered');
});

test('all page fragments resolve uniquely, including generated navigation', async () => {
  const page = parseHtml(await renderSite(readme, template));
  const ids = [];
  visit(page, 'element', (node) => { if (node.properties.id) ids.push(node.properties.id); });
  assert.equal(new Set(ids).size, ids.length, 'duplicate page IDs');
  const idSet = new Set(ids);
  for (const node of elements(page, 'a')) {
    const href = node.properties.href;
    if (typeof href === 'string' && href.startsWith('#')) {
      assert.ok(idSet.has(decodeURIComponent(href.slice(1))), `missing fragment: ${href}`);
    }
  }
  assert.ok(idSet.has('-start-here'));
  assert.ok(idSet.has('-learn-spanish'));
});

test('Spanish travel phrases declare their language in the generated table', async () => {
  const page = parseHtml(await renderSite(readme, template));
  const spanishCells = elements(page, 'td').filter((node) => node.properties.lang === 'es');
  assert.ok(spanishCells.length >= 6, 'Spanish phrase cells must be marked for screen readers');
  assert.ok(JSON.stringify(spanishCells).includes('¿Dónde está'));
});

test('resource assets remain relative to a GitHub project-site path', async () => {
  const page = parseHtml(await renderSite(readme, template));
  const css = elements(page, 'link').find((node) => node.properties.rel?.includes('stylesheet'));
  const hero = elements(page, 'img').find((node) => node.properties.src === 'assets/hero.svg');
  const script = elements(page, 'script').find((node) => node.properties.src === 'search.mjs');
  assert.equal(css?.properties.href, 'style.css');
  assert.ok(hero?.properties.alt, 'hero needs descriptive alt text');
  assert.equal(script?.properties.type, 'module');
  const base = 'https://example.test/learn-spanish-immersion/';
  assert.equal(new URL(css.properties.href, base).pathname, '/learn-spanish-immersion/style.css');
  assert.equal(new URL(hero.properties.src, base).pathname, '/learn-spanish-immersion/assets/hero.svg');
  assert.equal(new URL(script.properties.src, base).pathname, '/learn-spanish-immersion/search.mjs');
  await readFile(new URL('../assets/hero.svg', import.meta.url));
  await readFile(new URL('../site/style.css', import.meta.url));
});

test('raw HTML and unsafe Markdown URLs do not become executable markup', async () => {
  const source = '# Intro\n\n## Section\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n[good](https://example.com)\n';
  const html = await renderSite(source, template);
  const page = parseHtml(html);
  assert.deepEqual(elements(page, 'script').map((node) => node.properties.src), ['search.mjs']);
  assert.ok(!html.includes('onerror'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(elements(page, 'a').some((node) => node.properties.href === 'https://example.com'));
});

test('duplicate and emoji headings get matching unique navigation targets', async () => {
  const source = '# Intro\n\n## 🗣️ Learn\n\n## 🗣️ Learn\n\n[Second](#️-learn-1)\n';
  const page = parseHtml(await renderSite(source, template));
  const headings = elements(page, 'h2').filter((node) => String(node.properties.id ?? '').includes('learn'));
  assert.deepEqual(headings.map((node) => node.properties.id), ['️-learn', '️-learn-1']);
  const links = elements(page, 'a').map((node) => node.properties.href);
  assert.ok(links.includes('#️-learn'));
  assert.ok(links.includes('#️-learn-1'));
});

test('reference links and footnotes defined in the preamble remain usable', async () => {
  const source = '# Intro\n\n> [news]: https://example.com/news\n\n[^a]: A useful note.\n\n## Resources\n\n[Read news][news]. See note.[^a]\n';
  const page = parseHtml(await renderSite(source, template));
  const links = elements(page, 'a').map((node) => node.properties.href);
  const ids = new Set();
  visit(page, 'element', (node) => { if (node.properties.id) ids.add(node.properties.id); });
  assert.ok(links.includes('https://example.com/news'));
  const footnoteLinks = links.filter((value) => typeof value === 'string' && value.startsWith('#user-content-user-content-fn'));
  assert.equal(footnoteLinks.length, 2);
  for (const href of footnoteLinks) {
    assert.ok(ids.has(href.slice(1)), `missing reference or footnote fragment: ${href}`);
  }
});

test('missing section or template placeholders fail the build', async () => {
  await assert.rejects(renderSite('# Title\n', template), /no level-two/);
  await assert.rejects(renderSite('## Section\n', '<html></html>'), /placeholders/);
});
