import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function textContent(node) {
  return node.type === 'text' ? node.value : (node.children ?? []).map(textContent).join('');
}

function markSpanishColumn(table) {
  const head = table.children.find((node) => node.tagName === 'thead');
  const row = head?.children.find((node) => node.tagName === 'tr');
  const headers = row?.children.filter((node) => node.tagName === 'th') ?? [];
  const index = headers.findIndex((node) => textContent(node).trim() === 'Español');
  if (index < 0) return;
  const body = table.children.find((node) => node.tagName === 'tbody');
  for (const bodyRow of body?.children.filter((node) => node.tagName === 'tr') ?? []) {
    const cells = bodyRow.children.filter((node) => node.tagName === 'td');
    if (cells[index]) cells[index].properties.lang = 'es';
  }
}

// The website has its own intro; the resource sections remain sourced from README.md.
export async function renderSite(markdown, template) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const firstSection = tree.children.findIndex((node) => node.type === 'heading' && node.depth === 2);
  if (firstSection < 0) throw new Error('README has no level-two resource sections');
  const definitions = [];
  const preamble = { type: 'root', children: tree.children.slice(0, firstSection) };
  visit(preamble, (node) => {
    if (node.type === 'definition' || node.type === 'footnoteDefinition') definitions.push(node);
  });
  tree.children = [...definitions, ...tree.children.slice(firstSection)];

  // Drop raw HTML and filter unsafe URLs before assigning GitHub-compatible IDs.
  const hast = await unified().use(remarkRehype).use(rehypeSanitize).use(rehypeSlug).run(tree);
  // Sanitization prefixes footnote IDs for DOM-clobber protection; follow that prefix in their links.
  visit(hast, 'element', (node) => {
    const props = node.properties;
    if ((Object.hasOwn(props, 'dataFootnoteRef') || Object.hasOwn(props, 'dataFootnoteBackref'))
        && typeof props.href === 'string' && props.href.startsWith('#user-content-')) {
      props.href = `#user-content-${props.href.slice(1)}`;
    }
    if (node.tagName === 'p') {
      node.children = node.children.flatMap((child) => {
        if (child.type !== 'text' || !child.value.includes('¡Vamos!')) return [child];
        const parts = child.value.split('¡Vamos!');
        return parts.flatMap((part, index) => index === 0
          ? [{ type: 'text', value: part }]
          : [{ type: 'element', tagName: 'span', properties: { lang: 'es' },
            children: [{ type: 'text', value: '¡Vamos!' }] }, { type: 'text', value: part }]);
      });
    }
  });
  const sections = hast.children.filter((node) => node.type === 'element' && node.tagName === 'h2');
  const navigation = sections.map((node) =>
    `<li><a href="#${escapeHtml(node.properties.id)}">${escapeHtml(textContent(node))}</a></li>`
  ).join('\n');

  // A focusable scroll region keeps wide GFM tables usable on small screens.
  let section = 'Resources';
  hast.children = hast.children.map((node) => {
    if (node.type === 'element' && ['h2', 'h3'].includes(node.tagName)) section = textContent(node);
    if (node.type !== 'element' || node.tagName !== 'table') return node;
    markSpanishColumn(node);
    return { type: 'element', tagName: 'div', properties: {
      className: ['table-scroll'], tabIndex: 0, role: 'region', ariaLabel: `${section}: scrollable table`,
    }, children: [
      { type: 'element', tagName: 'span', properties: { className: ['table-hint'], ariaHidden: 'true' },
        children: [{ type: 'text', value: 'Scroll table →' }] },
      node,
    ] };
  });
  const content = unified().use(rehypeStringify).stringify(hast);
  if (!template.includes('<!-- SITE_NAV -->') || !template.includes('<!-- SITE_MOBILE_NAV -->')
      || !template.includes('<!-- SITE_CONTENT -->')) {
    throw new Error('Site template is missing required placeholders');
  }
  return template.replace('<!-- SITE_NAV -->', () => navigation)
    .replace('<!-- SITE_MOBILE_NAV -->', () => navigation)
    .replace('<!-- SITE_CONTENT -->', () => content);
}
