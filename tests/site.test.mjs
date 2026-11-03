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

test('resource tables retain native semantics and reference their current heading', async () => {
  const page = parseHtml(await renderSite(readme, template));
  const ids = new Set();
  visit(page, 'element', (node) => { if (node.properties.id) ids.add(node.properties.id); });
  const tables = elements(page, 'table');
  assert.ok(tables.length > 5);
  for (const table of tables) {
    const reference = table.properties.ariaLabelledBy;
    const id = Array.isArray(reference) ? reference[0] : reference;
    assert.ok(id && ids.has(id), `table heading missing: ${id}`);
    assert.ok(elements(table, 'th').length, 'native column headers are required');
  }
});

test('multiple tables and duplicate headings retain the correct table labels', async () => {
  const source = '# Intro\n\n## Topic\n\n| Name |\n| --- |\n| One |\n\n| Name |\n| --- |\n| Two |\n\n## Topic\n\n| Name |\n| --- |\n| Three |\n';
  const page = parseHtml(await renderSite(source, template));
  const references = elements(page, 'table').map((node) => {
    const value = node.properties.ariaLabelledBy;
    return Array.isArray(value) ? value[0] : value;
  });
  assert.deepEqual(references, ['topic', 'topic', 'topic-1']);
});

test('topic and search skip links lead to focusable destinations', async () => {
  const page = parseHtml(await renderSite(readme, template));
  const byId = new Map();
  visit(page, 'element', (node) => { if (node.properties.id) byId.set(node.properties.id, node); });
  for (const id of ['topic-index', 'after-search']) {
    assert.equal(byId.get(id)?.properties.tabIndex, -1, `${id} must be focusable`);
    assert.ok(elements(page, 'a').some((node) => node.properties.href === `#${id}`));
  }
});

test('Spanish travel phrases declare their language in the generated table', async () => {
  const page = parseHtml(await renderSite(readme, template));
  const spanishCells = elements(page, 'td').filter((node) => node.properties.lang === 'es');
  assert.ok(spanishCells.length >= 6, 'Spanish phrase cells must be marked for screen readers');
  assert.ok(JSON.stringify(spanishCells).includes('¿Dónde está'));
});

test('starter choices are numbered, linkable and do not require a table', async () => {
  const page = parseHtml(await renderSite(readme, template));
  const articles = elements(page, 'article').filter((node) => node.properties.id === 'main-content');
  assert.equal(articles.length, 1);
  const children = articles[0].children.filter((node) => node.type === 'element');
  assert.equal(children[0].properties.id, '-start-here');
  assert.equal(children[1].tagName, 'p');
  assert.equal(children[2].tagName, 'ol');
  assert.equal(children[2].children.filter((node) => node.tagName === 'li').length, 4);
  const links = elements(children[2], 'a').map((node) => node.properties.href);
  assert.ok(links.includes('https://www.youtube.com/@DreamingSpanish'));
  assert.ok(links.includes('https://coffeebreaklanguages.com/tag/cbs-season-1/'));
});

test('desktop and mobile topic navigation share the same heading targets', async () => {
  const page = parseHtml(await renderSite(readme, template));
  const navs = elements(page, 'nav').filter((node) => node.properties.ariaLabel === 'Resource sections');
  assert.equal(navs.length, 2);
  const targets = navs.map((nav) => elements(nav, 'a').map((node) => node.properties.href));
  assert.ok(targets[0].length > 10);
  assert.deepEqual(targets[0], targets[1]);
  assert.ok(targets[0].includes('#-reading--stories'));
  const mobile = elements(page, 'details').find((node) => node.properties.className?.includes('mobile-topic-index'));
  assert.ok(mobile && !mobile.properties.open, 'mobile index should start collapsed');
  assert.equal(elements(mobile, 'summary').length, 1);
});

test('brief Spanish phrases are marked without changing English context', async () => {
  const page = parseHtml(await renderSite(readme, template));
  assert.ok(elements(page, 'em').some((node) => node.properties.lang === 'es' && JSON.stringify(node).includes('en español')));
  assert.ok(elements(page, 'strong').some((node) => node.properties.lang === 'es' && JSON.stringify(node).includes('¡Vamos!')));
  assert.ok(elements(page, 'span').some((node) => node.properties.lang === 'es' && JSON.stringify(node).includes('¡Vamos!')));
});

test('resource assets remain relative to a GitHub project-site path', async () => {
  const page = parseHtml(await renderSite(readme, template));
  const css = elements(page, 'link').find((node) => node.properties.rel?.includes('stylesheet'));
  const favicon = elements(page, 'link').find((node) => node.properties.rel?.includes('icon'));
  const hero = elements(page, 'img').find((node) => node.properties.src === 'assets/hero.svg');
  const script = elements(page, 'script').find((node) => node.properties.src === 'search.mjs');
  assert.equal(css?.properties.href, 'style.css');
  assert.equal(favicon?.properties.href, 'assets/favicon.svg');
  assert.ok(hero?.properties.alt, 'hero needs descriptive alt text');
  assert.equal(script?.properties.type, 'module');
  const base = 'https://example.test/learn-spanish-immersion/';
  assert.equal(new URL(css.properties.href, base).pathname, '/learn-spanish-immersion/style.css');
  assert.equal(new URL(hero.properties.src, base).pathname, '/learn-spanish-immersion/assets/hero.svg');
  assert.equal(new URL(script.properties.src, base).pathname, '/learn-spanish-immersion/search.mjs');
  assert.equal(new URL(favicon.properties.href, base).pathname, '/learn-spanish-immersion/assets/favicon.svg');
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
