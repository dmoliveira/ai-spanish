import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { createCatalog, createGuideCatalog, findMatches, initializeSearch, normalize } from '../site/search.mjs';
import { renderSite } from '../site/render.mjs';

const fixture = `<!doctype html><html><body>
<form data-resource-search hidden><label for="resource-query">Search</label><input id="resource-query">
<button type="button" data-search-clear>Clear</button><p id="resource-status"></p><ul id="resource-results" hidden></ul></form>
<article class="resource-content">
<h2 id="-learn-spanish">📘 Learn Spanish</h2><h3>Mexico &amp; listening</h3>
<table><tr><td><a href="https://example.org/es">Español Vivo</a> — Beginner stories in México.</td></tr>
<tr><td><a href="https://example.org/a">Alpha</a> and <a href="https://example.org/b">Beta</a> — learning.</td></tr></table>
<h2 id="-travel">🧳 Travel</h2><ol><li><a href="https://example.org/es">Español Vivo</a> — Travel videos.</li></ol>
<p><a href="javascript:alert(1)">Unsafe</a><a href="#-travel">Internal</a></p>
<section data-footnotes><h2 id="footnotes">Footnotes</h2><a href="https://example.org/note">Note</a></section>
<h2 id="-support-the-project">Support</h2><p><a href="https://example.org/pay">Donate</a></p>
</article></body></html>`;

function makeDocument(html = fixture) { return parseHTML(html).document; }

test('normalization handles case, accents, and decomposed Unicode', () => {
  assert.equal(normalize('  ESPAÑOL  '), 'espanol');
  assert.equal(normalize('Cafe\u0301 México'), 'cafe mexico');
  assert.equal(normalize('  A   B '), 'a b');
});

test('catalog deduplicates URLs and preserves independent resource contexts', () => {
  const doc = makeDocument();
  const catalog = createCatalog(doc.querySelector('article'), 'https://site.test/base/');
  assert.equal(catalog.length, 3);
  const spanish = catalog.find((item) => item.href === 'https://example.org/es');
  assert.equal(spanish.contexts.length, 2);
  assert.ok(spanish.descriptions.some((text) => text.includes('Beginner stories')));
  assert.ok(spanish.descriptions.some((text) => text.includes('Travel videos')));
  assert.deepEqual(findMatches(catalog, 'MEXICO espanol').map((item) => item.href), ['https://example.org/es']);
  assert.deepEqual(findMatches(catalog, 'travel ESPAÑOL').map((item) => item.href), ['https://example.org/es']);
  assert.deepEqual(findMatches(catalog, 'alpha').map((item) => item.href), ['https://example.org/a']);
  assert.deepEqual(findMatches(catalog, 'alpha beta'), []);
  assert.deepEqual(findMatches(catalog, 'beginner travel'), []);
  assert.deepEqual(findMatches(catalog, '  '), []);
  assert.deepEqual(findMatches(catalog, 'no-such-word'), []);
  assert.ok(!catalog.some((item) => item.href.includes('/pay') || item.href.includes('/note')));
  const travelMatch = findMatches(catalog, 'travel espanol')[0];
  assert.match(travelMatch.match.context, /Travel/);
  assert.match(travelMatch.match.description, /Travel videos/);
});

test('single-link excerpts stay grammatical and table ordinals do not damage resource names', () => {
  const doc = makeDocument(`<article>
    <h2 id="-learn">Learn</h2><ol><li>Choose a beginner <strong>video</strong> on <a href="https://example.org/dream">Dreaming Spanish</a>; use pictures.</li></ol>
    <table><tr><td>6</td><td><a href="https://example.org/games">3DJuegos</a></td><td>News and reviews.</td></tr></table>
  </article>`);
  const catalog = createCatalog(doc.querySelector('article'), 'https://site.test/');
  const beginner = findMatches(catalog, 'beginner video')[0];
  assert.equal(beginner.match.description, 'Choose a beginner video on Dreaming Spanish; use pictures.');
  const games = findMatches(catalog, '3djuegos')[0];
  assert.equal(games.match.label, '3DJuegos');
  assert.equal(games.match.description, 'News and reviews.');
});

test('short acronyms use word boundaries and podcasts and exact names are discoverable', () => {
  const doc = makeDocument(`<article>
    <h2 id="-ai">🤖 AI &amp; technology</h2><ol><li><a href="https://example.org/ai">Dot CSV</a> — machine learning.</li></ol>
    <h2 id="-news">📰 News &amp; current affairs</h2><ol><li><a href="https://example.org/spain">Spain news</a> — international affairs.</li></ol>
    <h2 id="-listen-on-the-go">🎧 Listen on the go</h2><ol><li><a href="https://example.org/hilo">El hilo</a> — Latin American news.</li></ol>
    <h2 id="-history">History &amp; philosophy</h2><ol><li><a href="https://example.org/academia">Academia Play</a> — history videos.</li></ol>
    <h2 id="-faith">Catholicism &amp; culture</h2><ol><li><a href="https://example.org/academia">Academia Play</a> — cultural heritage.</li></ol>
  </article>`);
  const catalog = createCatalog(doc.querySelector('article'), 'https://site.test/');
  assert.deepEqual(findMatches(catalog, 'AI').map((item) => item.href), ['https://example.org/ai']);
  assert.deepEqual(findMatches(catalog, 'podcast').map((item) => item.href), ['https://example.org/hilo']);
  assert.deepEqual(findMatches(catalog, 'podcasts').map((item) => item.href), ['https://example.org/hilo']);
  assert.equal(findMatches(catalog, 'el hilo')[0].href, 'https://example.org/hilo');
  const faith = findMatches(catalog, 'catholic academia')[0];
  assert.match(faith.match.context, /Catholicism/);
  assert.match(faith.match.description, /cultural heritage/);
});

test('guide search uses the rendered heading IDs and excludes footnotes and support', () => {
  const doc = makeDocument(`<article>
    <h2 id="-travel">🧳 Travel</h2><h3 id="-useful-travel-phrases">💬 Useful travel phrases</h3>
    <h2 id="-routine">⏳ Daily routine</h2><h3 id="️-your-first-week">🗓️ Your first week</h3>
    <section data-footnotes><h2 id="note">Footnotes</h2></section>
    <h2 id="-support-the-project">Support</h2><h3 id="donate">Donate</h3>
  </article>`);
  const guides = createGuideCatalog(doc.querySelector('article'));
  assert.equal(guides.length, 4);
  for (const [query, id] of [['travel phrases', '-useful-travel-phrases'], ['daily routine', '-routine'], ['first week', '️-your-first-week']]) {
    const match = findMatches(guides, query)[0];
    assert.equal(match.kind, 'guide');
    assert.equal(decodeURIComponent(match.href.slice(1)), id);
    assert.match(match.match.context, /On this page/);
  }
  assert.deepEqual(findMatches(guides, 'footnotes'), []);
  assert.deepEqual(findMatches(guides, 'donate'), []);
});

test('search initializes progressively, renders safely, announces and clears', () => {
  const { document, Event } = parseHTML(fixture);
  assert.ok(document.querySelector('form').hasAttribute('hidden'));
  assert.equal(initializeSearch(document), true);
  assert.equal(document.querySelector('form').hasAttribute('hidden'), false);
  const input = document.querySelector('#resource-query');
  const status = document.querySelector('#resource-status');
  const results = document.querySelector('#resource-results');
  input.value = 'espanol mexico';
  input.dispatchEvent(new Event('input'));
  assert.equal(status.textContent, '1 result found.');
  assert.equal(results.querySelectorAll('li').length, 1);
  assert.equal(results.querySelector('a').textContent, 'Español Vivo');
  assert.equal(results.querySelector('a').getAttribute('href'), 'https://example.org/es');
  input.value = '<img src=x onerror=alert(1)>';
  input.dispatchEvent(new Event('input'));
  assert.equal(results.querySelectorAll('img').length, 0);
  assert.match(status.textContent, /No matching results/);
  document.querySelector('[data-search-clear]').dispatchEvent(new Event('click'));
  assert.equal(input.value, '');
  assert.ok(results.hasAttribute('hidden'));
  assert.match(status.textContent, /Find a topic/);
});

test('missing or empty search prerequisites leave the control hidden', () => {
  const doc = makeDocument('<html><body><form data-resource-search hidden></form></body></html>');
  assert.equal(initializeSearch(doc), false);
  assert.ok(doc.querySelector('form').hasAttribute('hidden'));
});

test('composition defers updates and the search form does not navigate', () => {
  const { document, Event } = parseHTML(fixture);
  initializeSearch(document);
  const input = document.querySelector('#resource-query');
  const status = document.querySelector('#resource-status');
  input.dispatchEvent(new Event('compositionstart'));
  input.value = 'espanol';
  input.dispatchEvent(new Event('input'));
  assert.equal(status.textContent, '');
  input.dispatchEvent(new Event('compositionend'));
  assert.equal(status.textContent, '1 result found.');
  const submit = new Event('submit', { cancelable: true });
  document.querySelector('form').dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
});

test('actual generated README resources form a searchable catalog', async () => {
  const markdown = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const template = await readFile(new URL('../site/template.html', import.meta.url), 'utf8');
  const doc = makeDocument(await renderSite(markdown, template));
  assert.ok(doc.querySelector('[data-resource-search]').hasAttribute('hidden'));
  const catalog = createCatalog(doc.querySelector('.resource-content'), 'https://site.test/learn-spanish-immersion/');
  const guides = createGuideCatalog(doc.querySelector('.resource-content'));
  assert.ok(catalog.length > 140, `unexpectedly small catalog: ${catalog.length}`);
  for (const query of ['espanol juan', 'nintendo', 'mexico travel', 'podcast', 'catholic']) {
    assert.ok(findMatches(catalog, query).length > 0, `no result for ${query}`);
  }
  for (const query of ['podcast', 'podcasts']) {
    const matches = findMatches(catalog, query);
    assert.ok(matches.some((item) => item.href === 'https://elhilo.audio/'), `${query} should find El hilo`);
    assert.ok(matches.some((item) => item.href === 'https://charlashispanas.com/'), `${query} should find Charlas Hispanas`);
  }
  assert.equal(findMatches(catalog, 'el hilo')[0].href, 'https://elhilo.audio/');
  for (const query of ['travel phrases', 'daily routine', 'first week']) {
    assert.equal(findMatches([...guides, ...catalog], query)[0].kind, 'guide', `${query} should find an on-page guide`);
  }
  for (const [query, expected] of [
    ['juegos', 'https://www.youtube.com/@3DJuegos'],
    ['3djuegos', 'https://www.youtube.com/@3DJuegos'],
    ['publico', 'https://ojo-publico.com/'],
    ['ojopublico', 'https://ojo-publico.com/'],
    ['OjoPu\u0301blico', 'https://ojo-publico.com/'],
    ['ciencia', 'https://www.youtube.com/@CdeCiencia'],
    ['cdeciencia', 'https://www.youtube.com/@CdeCiencia'],
    ['beginner podcast', 'https://www.spanishlanguagecoach.com/beginnerspanishpodcast'],
    ['beginner podcasts', 'https://www.spanishlanguagecoach.com/beginnerspanishpodcast'],
    ['beginner podcast', 'https://coffeebreaklanguages.com/tag/cbs-season-1/'],
    ['podcast mexico', 'https://www.youtube.com/@HowtoSpanishPodcast_Official'],
  ]) {
    assert.ok(findMatches(catalog, query).some((item) => item.href === expected), `missing ${expected} for ${query}`);
  }
});
