export function pathSignature(html) {
  const path = /<path\b[^>]*\bd="([^"]+)"/.exec(html)?.[1];
  if (!path || /[HhVvAa]/.test(path)) return null;
  const tokens = path.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const firstMove = tokens.findIndex(token => /[Mm]/.test(token));
  if (firstMove < 0) return null;
  const originX = Number(tokens[firstMove + 1]), originY = Number(tokens[firstMove + 2]);
  if (!Number.isFinite(originX) || !Number.isFinite(originY)) return null;
  let coordinate = 0;
  return tokens.map((token, index) => {
    if (/[A-Za-z]/.test(token)) { coordinate = 0; return token; }
    if (index <= firstMove) return token;
    const origin = coordinate % 2 === 0 ? originX : originY;
    coordinate += 1;
    return String(Math.round((Number(token) - origin) * 4) / 4);
  }).join(' ');
}

export function attachSourceLocations(rows, originalPages, rowPages) {
  const bySignature = new Map();
  const used = new Set();
  for (const [pageId, page] of Object.entries(originalPages)) {
    for (const [elementIndex, element] of page.elements.entries()) {
      const signature = pathSignature(element.html);
      if (!signature) continue;
      bySignature.set(signature, [...(bySignature.get(signature) ?? []), { pageId, elementIndex, element }]);
    }
  }
  const pageOrder = new Map(Object.keys(originalPages).map((pageId, index) => [pageId, index]));
  let lastPage = 0, lastY = 0;
  for (const row of rows) {
    row.sourceLocations = [];
    for (const elementIndex of row.graphicIndices) {
      const signature = pathSignature(rowPages[row.pageId].elements[elementIndex].html);
      const candidates = (bySignature.get(signature) ?? []).filter(candidate => {
        const page = pageOrder.get(candidate.pageId) ?? 0;
        return !used.has(`${candidate.pageId}:${candidate.elementIndex}`)
          && (page > lastPage || (page === lastPage && candidate.element.y >= lastY - 35));
      }).sort((a, b) => (pageOrder.get(a.pageId) - pageOrder.get(b.pageId)) || a.element.y - b.element.y);
      const location = candidates[0];
      if (!location) continue;
      used.add(`${location.pageId}:${location.elementIndex}`);
      row.sourceLocations.push(location);
    }
    if (row.sourceLocations.length) {
      const location = row.sourceLocations[0];
      lastPage = pageOrder.get(location.pageId) ?? lastPage;
      const samePage = row.sourceLocations.filter(item => item.pageId === location.pageId).map(item => item.element.y).sort((a, b) => a - b);
      lastY = samePage[Math.floor(samePage.length / 2)] ?? lastY;
    }
  }
}
