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
    let description = '';
    if (container && container.querySelectorAll('a[href]').length === 1) {
      const copy = container.cloneNode(true);
      copy.querySelectorAll('a').forEach((link) => link.remove());
      description = tidy(copy.textContent).replace(/^\d+\s*/, '').replace(/^[—–:·\s]+/, '');
    }
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
  const status = doc.querySelector('#resource-status');
  const list = doc.querySelector('#resource-results');
  if (!form || !article || !input || !clear || !status || !list) return false;
  const catalog = createCatalog(article, doc.baseURI || 'https://example.invalid/');
  if (!catalog.length) return false;
  let composing = false;

  function update() {
    const query = tidy(input.value);
    list.replaceChildren();
    if (!query) {
      list.hidden = true;
      status.textContent = 'Find a topic, place or channel.';
      return;
    }
    const matches = findMatches(catalog, query);
    status.textContent = matches.length
      ? `${matches.length} ${matches.length === 1 ? 'resource' : 'resources'} found.`
      : 'No matching resources. Try another word.';
    list.hidden = !matches.length;
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
