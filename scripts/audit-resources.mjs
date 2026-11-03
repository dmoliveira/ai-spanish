import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit, SKIP } from 'unist-util-visit';

// Instructional, project and donation sections are not resource categories.
export const TOPICS = [
  'Learn Spanish', 'Reading & stories', 'News & current affairs',
  'Travel & everyday life', 'Screen & sound', 'AI, machine learning & technology',
  'Science & discovery', 'Nintendo & gaming', 'Politics & economics', 'More to explore',
  'Catholicism, philosophy & traditional culture', 'Dictionaries & practice', 'Listen on the go',
];

function text(node) {
  return node.type === 'text' ? node.value : (node.children ?? []).map(text).join('');
}

function normalizedUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const host = url.hostname.replace(/\.$/, '');
    const youtube = /^(?:(?:(?:www|m|music)\.)?youtube\.com|(?:www\.)?youtube-nocookie\.com)$/i.test(host);
    const shortYoutube = /^(?:www\.)?youtu\.be$/i.test(host);
    if (youtube && /^\/results\/?$/i.test(url.pathname)) return null;
    if (youtube || shortYoutube) url.hostname = 'www.youtube.com';
    if (shortYoutube && /^\/[^/]+\/?$/.test(url.pathname)) {
      url.searchParams.set('v', url.pathname.replace(/^\/|\/$/g, ''));
      url.pathname = '/watch';
    }
    const videoAlias = youtube && url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/]+)\/?$/i);
    if (videoAlias) {
      url.searchParams.set('v', videoAlias[1]);
      url.pathname = '/watch';
    }
    url.protocol = 'https:';
    if (!/^#(?:\/|!)/.test(url.hash)) url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      const tracking = /^(utm_.+|fbclid|gclid)$/i.test(key)
        || ((youtube || shortYoutube) && /^(si|feature|pp|app|ab_channel|source_ve_path|embeds_referring_euri|sub_confirmation|t|start|time_continue|index)$/i.test(key));
      if (tracking) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (youtube && /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/(?:featured|videos|streams|shorts|playlists|community|about)$/i, '');
      if (url.pathname.startsWith('/@')) url.pathname = url.pathname.toLowerCase();
    }
    return url.href;
  } catch { return null; }
}

export function resourceCounts(markdown) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const definitions = new Map();
  visit(tree, 'definition', (node) => {
    if (!definitions.has(node.identifier.toLowerCase())) definitions.set(node.identifier.toLowerCase(), node.url);
  });
  const topics = new Map(TOPICS.map((name) => [name, new Set()]));
  const seenHeadings = new Set();
  const duplicates = new Set();
  let current = null;
  function addEntry(entry) {
    // Only a leading link identifies the resource; later links are context.
    let node = entry;
    while (node && ['listItem', 'paragraph', 'tableCell', 'strong', 'emphasis', 'delete'].includes(node.type)) {
      node = node.children.find((child) => child.type !== 'text' || child.value.trim());
    }
    const raw = node?.type === 'link' ? node.url
      : node?.type === 'linkReference' ? definitions.get(node.identifier.toLowerCase()) : undefined;
    const url = normalizedUrl(raw);
    if (url) current.add(url);
  }
  function addList(list) {
    for (const item of list.children) {
      addEntry(item);
      visit(item, 'list', (nested) => { addList(nested); return SKIP; });
    }
  }
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 1) {
      current = null;
      continue;
    }
    if (node.type === 'heading' && node.depth === 2) {
      const name = text(node).replace(/^[^\p{L}\p{N}]+/u, '').trim();
      current = topics.get(name) ?? null;
      if (current) {
        if (seenHeadings.has(name)) duplicates.add(name);
        seenHeadings.add(name);
      }
      continue;
    }
    if (!current) continue;
    if (node.type === 'list') addList(node);
    if (node.type === 'table') {
      const column = node.children[0]?.children.findIndex((cell) => text(cell).trim().toLowerCase() === 'resource') ?? -1;
      if (column >= 0) for (const row of node.children.slice(1)) if (row.children[column]) addEntry(row.children[column]);
    }
  }
  return { counts: Object.fromEntries([...topics].map(([name, urls]) => [name, urls.size])), missing: TOPICS.filter((name) => !seenHeadings.has(name)), duplicates: [...duplicates] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const markdown = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const { counts, missing, duplicates } = resourceCounts(markdown);
  for (const [name, count] of Object.entries(counts)) console.log(`${count >= 30 ? 'PASS' : 'NEEDS'} ${String(count).padStart(2)} ${name}`);
  for (const name of duplicates) console.error(`DUPLICATE TOPIC ${name}`);
  if (missing.length || duplicates.length || Object.values(counts).some((count) => count < 30)) process.exitCode = 1;
}
