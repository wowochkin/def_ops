export interface NumberedSourceEntry {
  readonly number: string;
  readonly text: string;
}

export function extractNumberedEntries(pageText: string): NumberedSourceEntry[] {
  const lines = pageText.replaceAll('\r\n', '\n').replaceAll('\f', '\n').split('\n');
  const markers: { number: string; line: number }[] = [];
  for (const [index, line] of lines.entries()) {
    const match = /^(\d{1,3})[\t ]*$/.exec(line);
    if (match) markers.push({ number: match[1], line: index });
  }
  return markers.map((marker, index) => {
    const end = markers[index + 1]?.line ?? lines.length;
    const text = lines.slice(marker.line + 1, end).map(line => line.trim()).filter(Boolean).join('\n');
    return { number: marker.number, text };
  });
}

export function assertContiguousCoverage(entries: readonly Pick<NumberedSourceEntry, 'number'>[], allowedMissing: readonly number[] = []): { first: number; last: number; count: number } {
  if (!entries.length) throw new Error('В источнике не найдены номерованные знаки');
  const numbers = entries.map(entry => Number(entry.number));
  if (numbers.some(number => !Number.isInteger(number) || number < 1)) throw new Error('Некорректный номер знака');
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  if (unique.length !== numbers.length) {
    const duplicate = numbers.find(number => numbers.indexOf(number) !== numbers.lastIndexOf(number));
    throw new Error(`Обнаружен дубликат номера ${duplicate}`);
  }
  const first = unique[0]!, last = unique.at(-1)!;
  const allowed = new Set(allowedMissing);
  const missing = Array.from({ length: last - first + 1 }, (_, index) => first + index).filter(number => !unique.includes(number) && !allowed.has(number));
  if (missing.length) throw new Error(`Пропущены номера: ${missing.join(', ')}`);
  return { first, last, count: unique.length };
}


export interface BBoxSourceEntry extends NumberedSourceEntry {
  readonly page: number;
  readonly x: number;
  readonly y: number;
}

function xmlText(value: string): string {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
}

export function extractNumberedEntriesFromBBox(xml: string): BBoxSourceEntry[] {
  const result: BBoxSourceEntry[] = [];
  const pages = xml.matchAll(/<page\b[^>]*>[\s\S]*?<\/page>/g);
  for (const [pageIndex, pageMatch] of [...pages].entries()) {
    const page = pageMatch[0];
    const words = [...page.matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)].map(match => {
      const attributes = match[1];
      const numberAttribute = (name: string) => Number(new RegExp(`${name}="([^"]+)"`).exec(attributes)?.[1]);
      return { x: numberAttribute('xMin'), y: numberAttribute('yMin'), text: xmlText(match[2]) };
    });
    const blocks = [...page.matchAll(/<block\b([^>]*)>([\s\S]*?)<\/block>/g)].map(match => {
      const attributes = match[1];
      const numberAttribute = (name: string) => Number(new RegExp(`${name}="([^"]+)"`).exec(attributes)?.[1]);
      const text = xmlText(match[2].replaceAll('</word>', ' ').replace(/<[^>]+>/g, ' ')).replaceAll(/\s+/g, ' ').trim();
      return { x: numberAttribute('xMin'), y: numberAttribute('yMin'), bottom: numberAttribute('yMax'), text };
    }).filter(block => block.x >= 230 && block.text);
    const markers = words.filter(word => /^\d{1,3}$/.test(word.text) && word.x >= 20 && word.x <= 110)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    for (const [index, marker] of markers.entries()) {
      const top = index === 0 ? Math.max(0, marker.y - 10) : (markers[index - 1]!.y + marker.y) / 2;
      const bottom = index === markers.length - 1 ? Infinity : (marker.y + markers[index + 1]!.y) / 2;
      const wholeBlocks = blocks.filter(block => block.y < bottom && block.bottom >= top).sort((a, b) => a.y - b.y).map(block => block.text).join(' ').trim();
      const wordText = words.filter(word => word.x >= 240 && word.y >= top && word.y < bottom)
        .sort((a, b) => a.y - b.y || a.x - b.x).map(word => word.text).join(' ').replaceAll(/\s+/g, ' ').trim();
      const text = wholeBlocks.length > wordText.length ? wholeBlocks : wordText;
      result.push({ number: marker.text, text, page: pageIndex + 1, x: marker.x, y: marker.y });
    }
  }
  return result;
}


export interface AuditSourceEntry extends BBoxSourceEntry {
  readonly documentId: string;
  readonly sourceDocument: string;
}

export interface NormalizedSourceEntry extends AuditSourceEntry {
  readonly documentIds: readonly string[];
  readonly sourceDocuments: readonly string[];
}

export interface DiscardedSourceEntry extends AuditSourceEntry {
  readonly reason: string;
}

export function normalizeSourceEntries(raw: readonly AuditSourceEntry[]): {
  entries: NormalizedSourceEntry[];
  discarded: DiscardedSourceEntry[];
} {
  type FamilyEntry = AuditSourceEntry & { family: string };
  const accepted: FamilyEntry[] = [];
  const discarded: DiscardedSourceEntry[] = [];
  const documents = new Map<string, AuditSourceEntry[]>();
  const familyOf = (name: string) => name.normalize('NFC').toLocaleLowerCase('ru').replace(/\d+/g, value => String(Number(value))).replace(/[^a-zа-яё0-9]+/gi, '');
  for (const entry of raw) {
    const family = familyOf(entry.sourceDocument);
    documents.set(family, [...(documents.get(family) ?? []), entry]);
  }
  for (const [family, records] of documents) {
    if (records[0]?.sourceDocument === 'Усл.знаки МПО.doc') {
      discarded.push(...records.map(entry => ({ ...entry, reason: 'непронумерованный документ' })));
      continue;
    }
    let previous = 0;
    for (const entry of records) {
      const number = Number(entry.number);
      if (number > 613) discarded.push({ ...entry, reason: 'вне диапазона источника' });
      else if (number < previous) discarded.push({ ...entry, reason: 'номер варианта' });
      else { accepted.push({ ...entry, family }); previous = number; }
    }
  }

  const entries: NormalizedSourceEntry[] = [];
  const byNumber = new Map<string, NormalizedSourceEntry>();
  for (const entry of accepted) {
    const key = `${entry.family}/${entry.number}`;
    const same = byNumber.get(key);
    if (same) {
      const merged: NormalizedSourceEntry = {
        ...same,
        text: entry.text.length > same.text.length ? entry.text : same.text,
        documentIds: [...new Set([...same.documentIds, entry.documentId])],
        sourceDocuments: [...new Set([...same.sourceDocuments, entry.sourceDocument])],
      };
      byNumber.set(key, merged);
      entries[entries.indexOf(same)] = merged;
      continue;
    }
    const normalized: NormalizedSourceEntry = { ...entry, documentIds: [entry.documentId], sourceDocuments: [entry.sourceDocument] };
    byNumber.set(key, normalized);entries.push(normalized);
  }
  return { entries, discarded };
}
