const NON_RESOURCE_SECTIONS = new Set(['-about-this-list', '-support-the-project']);
const SECTION_ALIASES = { '-listen-on-the-go': 'podcast podcasts audio' };
const tidy = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

export function normalize(value) {
  return tidy(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function addUnique(values, value) {
  if (value && !values.includes(value)) values.push(value);
}

function tokens(value) {
  return [...new Set((normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((word) => word === 'podcasts' ? 'podcast' : word))];
}

function words(value) {
  const original = tidy(value).normalize('NFC');
  const separated = original
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2');
  return tokens(`${original} ${separated}`);
}

function hasWord(haystack, token) {
  return haystack.some((word) => token.length <= 2 ? word === token : word.startsWith(token));
}

function describe(container, label) {
  if (!container) return '';
  const links = [...container.querySelectorAll('a[href]')];
  let source = container;
  if (links.length !== 1) {
    // Explicitly labeled companion channels belong to the preceding resource;
    // other multi-link entries may describe several unrelated resources.
    const companion = links[1];
    if (links.length !== 2 || !/^YouTube: .+/u.test(tidy(companion.textContent))
        || !/^https:\/\/www\.youtube\.com\/(?:@[^/?#]+|(?:channel|c|user)\/[^/?#]+)\/?$/i.test(companion.getAttribute('href'))) return '';
    source = container.cloneNode(true);
    source.querySelectorAll('a[href]')[1].remove();
  }
  const excerpt = (node) => tidy(node.textContent).replace(/\s*·\s*$/u, '');
  let description = '';
  if (source.tagName === 'TR') {
    const cells = [...source.children].filter((child) => child.tagName === 'TD');
    if (cells.length > 1 && /^\d+$/.test(tidy(cells[0].textContent))) cells.shift();
    description = cells.map(excerpt).filter(Boolean).join(' — ');
  } else {
    description = excerpt(source);
  }
  if (description === label) return '';
  if (description.startsWith(label) && /^[\s—–:·,.;!?]/u.test(description.slice(label.length))) {
    description = description.slice(label.length).replace(/^[\s—–:·,.;!?]+/u, '');
  }
  return description;
}

// The rendered README is the catalog: no duplicated resource list or network request.
export function createCatalog(article, baseUrl) {
  const byUrl = new Map();
  let section = '';
  let subsection = '';
  let aliases = '';
  let include = false;
  for (const node of article.querySelectorAll('h2, h3, a[href]')) {
    if (node.closest('[data-footnotes]')) continue;
    if (node.tagName === 'H2') {
      section = tidy(node.textContent);
      subsection = '';
      include = !NON_RESOURCE_SECTIONS.has(node.id);
      aliases = Object.hasOwn(SECTION_ALIASES, node.id) ? SECTION_ALIASES[node.id] : '';
      continue;
    }
    if (node.tagName === 'H3') {
      subsection = tidy(node.textContent);
      continue;
    }
    if (!include) continue;
    const raw = node.getAttribute('href')?.trim();
    const label = tidy(node.textContent);
    if (!raw || raw.startsWith('#') || !label) continue;
    let url;
    try { url = new URL(raw, baseUrl); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol)) continue;

    const container = node.closest('tr, li, p');
    const description = describe(container, label);
    const context = [section, subsection].filter(Boolean).join(' · ');
    const record = byUrl.get(url.href) ?? { href: url.href, labels: [], contexts: [], descriptions: [], occurrences: [] };
    addUnique(record.labels, label);
    addUnique(record.contexts, context);
    addUnique(record.descriptions, description);
    record.occurrences.push({ label, context, description, terms: words([label, context, description, aliases].join(' ')) });
    byUrl.set(url.href, record);
  }
  return [...byUrl.values()];
}

// Guide results point to the actual rendered IDs rather than recomputing Markdown slugs.
export function createGuideCatalog(article) {
  const guides = [];
  let section = '';
  let include = false;
  for (const node of article.querySelectorAll('h2[id], h3[id]')) {
    if (node.closest('[data-footnotes]')) continue;
    const label = tidy(node.textContent);
    if (node.tagName === 'H2') {
      section = label;
      include = !NON_RESOURCE_SECTIONS.has(node.id);
    }
    if (!include || !label || !node.id) continue;
    const context = node.tagName === 'H2' ? 'On this page' : `On this page · ${section}`;
    guides.push({
      href: `#${encodeURIComponent(node.id)}`,
      kind: 'guide',
      occurrences: [{ label, context, description: '', terms: words([label, section].join(' ')) }],
    });
  }
  return guides;
}

export function findMatches(catalog, query) {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return [];
  const results = [];
  for (const item of catalog) {
    const occurrences = item.occurrences.filter((occurrence) =>
      queryTokens.every((token) => hasWord(occurrence.terms, token))
    );
    if (!occurrences.length) continue;
    const score = (occurrence) => {
      const label = normalize(occurrence.label);
      const labelWords = words(occurrence.label);
      return (label === normalize(query) ? 100 : 0)
        + queryTokens.filter((token) => hasWord(labelWords, token)).length * 10
        + (occurrence.context.startsWith('🚀') ? 0 : 1);
    };
    occurrences.sort((a, b) => score(b) - score(a));
    results.push({ ...item, match: occurrences[0], score: score(occurrences[0]) });
  }
  return results.sort((a, b) => b.score - a.score);
}

export function initializeSearch(doc) {
  const form = doc.querySelector('[data-resource-search]');
  const article = doc.querySelector('.resource-content');
  const input = doc.querySelector('#resource-query');
  const clear = doc.querySelector('[data-search-clear]');
  const skip = doc.querySelector('[data-search-skip]');
  const status = doc.querySelector('#resource-status');
  const list = doc.querySelector('#resource-results');
  if (!form || !article || !input || !clear || !skip || !status || !list) return false;
  const catalog = [...createGuideCatalog(article), ...createCatalog(article, doc.baseURI || 'https://example.invalid/')];
  if (!catalog.length) return false;
  let composing = false;

  function update() {
    const query = tidy(input.value);
    list.replaceChildren();
    if (!query) {
      list.hidden = true;
      skip.hidden = true;
      status.textContent = "Find a topic, guide, place or channel. For page text, use your browser's Find.";
      return;
    }
    const matches = findMatches(catalog, query);
    status.textContent = matches.length
      ? `${matches.length} ${matches.length === 1 ? 'result' : 'results'} found.`
      : "No matching results. Try another word or use your browser's Find for page text.";
    list.hidden = !matches.length;
    skip.hidden = !matches.length;
    const fragment = doc.createDocumentFragment();
    for (const item of matches) {
      const li = doc.createElement('li');
      const link = doc.createElement('a');
      link.href = item.href;
      link.textContent = item.match.label;
      const context = doc.createElement('span');
      context.className = 'search-result-context';
      context.textContent = item.match.context;
      li.append(link, context);
      if (item.match.description) {
        const description = doc.createElement('p');
        description.textContent = item.match.description;
        li.append(description);
      }
      fragment.append(li);
    }
    list.append(fragment);
  }

  form.addEventListener('submit', (event) => event.preventDefault());
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  input.addEventListener('input', (event) => { if (!composing && !event.isComposing) update(); });
  clear.addEventListener('click', () => { input.value = ''; update(); input.focus(); });
  form.hidden = false;
  return true;
}

if (typeof document !== 'undefined') initializeSearch(document);
