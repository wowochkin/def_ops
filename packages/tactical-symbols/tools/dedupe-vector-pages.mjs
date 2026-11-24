import { createHash } from 'node:crypto';

export function dedupeVectorPages(input) {
  const definitions = {};
  const pages = {};
  for (const [pageId, page] of Object.entries(input)) {
    const references = new Map();
    const definitionPattern = /<([A-Za-z][\w]*)\b(?=[^>]*\bid="([^"]+)")[^>]*>[\s\S]*?<\/\1>/g;
    const remaining = page.defs.replace(definitionPattern, '').replace(/<g>\s*<\/g>/g, '');
    if (remaining.trim()) throw new Error(`Неразобранные определения на странице ${pageId}`);
    for (const match of page.defs.matchAll(definitionPattern)) {
      const originalId = match[2];
      const canonical = match[0].replace(/\bid="[^"]+"/, '');
      const id = `vector-${createHash('sha256').update(canonical).digest('hex').slice(0, 24)}`;
      definitions[id] = match[0].replace(/\bid="[^"]+"/, `id="${id}"`);
      references.set(originalId, id);
    }
    const rewrite = html => {
      let result = html;
      for (const [originalId, id] of references) {
        result = result.replaceAll(`href="#${originalId}"`, `href="#${id}"`).replaceAll(`url(#${originalId})`, `url(#${id})`);
      }
      return result;
    };
    for (const [id, html] of Object.entries(definitions)) definitions[id] = rewrite(html);
    const { defs, ...pageWithoutDefs } = page;
    pages[pageId] = {
      ...pageWithoutDefs,
      definitionIds: [...new Set(references.values())],
      elements: page.elements.map(element => ({ ...element, html: rewrite(element.html) })),
    };
  }
  return { pages, definitions };
}
