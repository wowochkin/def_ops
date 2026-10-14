/**
 * Таблицы фактов (CSV, XLSX) и пакеты внешнего агента (JSON) → кандидаты. Шаблон — столбцы TEMPLATE_COLUMNS
 * (docs/facts-template.md); не шаблон — смысл столбцов предлагает модель, подтверждает человек, дальше строки
 * разбираются кодом. Названия остаются в names, claim.subject пуст — его заполняет проверка соединения.
 * Строка с ошибкой (дата не дата, число не число) в кандидаты не идёт — она в errors с номером строки.
 */
import type { Candidate } from './candidate';
import { buildClaim, CLAIM_KINDS, KIND_RU, type ClaimKind, type ExtractedClaim } from './extract';
import type { Claim, KbDocument, Reliability } from './schema';

/** Сообщение модели (текст) — как ChatMessage клиента моделей. */
export type TableMessage = { role: 'system' | 'user'; content: string };

export const TEMPLATE_COLUMNS = ['kind', 'subject', 'date', 'date_to', 'personnel', 'tanks', 'guns', 'killed', 'wounded', 'missing', 'total', 'parent', 'place', 'lat', 'lon', 'approx_km', 'source', 'pages', 'reliability', 'quote', 'note'] as const;
export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];
const NUMBER_FIELDS = ['personnel', 'tanks', 'guns', 'killed', 'wounded', 'missing', 'total'] as const;
export type NumberField = (typeof NUMBER_FIELDS)[number];

export type ColumnMeaning = TemplateColumn | 'skip' | { day: string; field: NumberField };
export interface TableMapping { kind: Claim['kind']; columns: ColumnMeaning[] }
export type DocInfo = Pick<KbDocument, 'id' | 'name' | 'reliability' | 'operation'>;
export type RowError = { row: number; why: string };

/** Разбор CSV: разделитель «,» или «;» (по первой строке), кавычки с удвоением, переводы строк в кавычках. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/)[0] ?? '';
  let q = false, nSemi = 0, nComma = 0;
  for (const ch of first) { if (ch === '"') q = !q; else if (!q) { if (ch === ';') nSemi++; else if (ch === ',') nComma++; } }
  const sep = nSemi > nComma ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQ = false;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') { inQ = true; cell = ''; }
    else if (ch === sep) endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (t[i + 1] !== '\n') endRow(); }
    else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  const out = rows.map((r) => r.map((c) => c.trim()));
  while (out.length && !out[out.length - 1].some(Boolean)) out.pop();   // пустые строки в конце; внутри остаются — номера строк как в файле
  return out;
}

/** Байты файла → текст: UTF-8, а если в нём символы замены — Windows-1251. */
export function decodeTable(bytes: Uint8Array): string {
  const u = new TextDecoder('utf-8').decode(bytes);
  return (u.includes('�') ? new TextDecoder('windows-1251').decode(bytes) : u).replace(/^﻿/, '');
}

const norm = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase();

/** Первая строка — столбцы шаблона (нужны хотя бы kind, subject и date). */
export function isTemplate(header: string[]): boolean {
  const h = new Set(header.map(norm));
  return h.has('kind') && h.has('subject') && h.has('date');
}

/** Сопоставление для шаблона: столбец по имени, лишние — skip. */
export function templateMapping(header: string[]): TableMapping {
  const known = new Set<string>(TEMPLATE_COLUMNS);
  return { kind: 'strength', columns: header.map((h) => (known.has(norm(h)) ? (norm(h) as TemplateColumn) : 'skip')) };
}

export const MAPPING_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['kind', 'columns'],
  properties: {
    kind: { type: 'string', enum: [...CLAIM_KINDS] },
    columns: {
      type: 'array',
      items: {
        anyOf: [
          { type: 'string', enum: [...TEMPLATE_COLUMNS, 'skip'] },
          { type: 'object', additionalProperties: false, required: ['day', 'field'], properties: { day: { type: 'string' }, field: { type: 'string', enum: [...NUMBER_FIELDS] } } },
        ],
      },
    },
  },
} as const;

/** Запрос модели: что за столбцы. Получает заголовок и первые 10 строк; ответ по MAPPING_SCHEMA. */
export function mappingMessages(header: string[], sample: string[][]): TableMessage[] {
  const rows = [header, ...sample.slice(0, 10)].map((r) => r.join(' | ')).join('\n');
  return [
    { role: 'system', content: `Вы помогаете загрузить таблицу военно-исторических фактов (1945 год) в базу знаний. По заголовку и первым строкам определите, какие факты в таблице (kind) и что означает каждый столбец.

Виды фактов (kind): ${CLAIM_KINDS.map((k) => `${k} — ${KIND_RU[k as ClaimKind]}`).join('; ')}.
Смысл столбца — одно из значений: ${TEMPLATE_COLUMNS.join(', ')} или skip (столбец не нужен). Даты — date (начало или момент) и date_to (конец периода); название соединения — subject; вышестоящее — parent; населённый пункт — place; число людей — personnel; всего потерь — total.
Если заголовки столбцов — даты (дни в столбцах, а в ячейках числа), вместо слова поставьте объект { "day": "ГГГГ-ММ-ДД", "field": personnel|tanks|guns|killed|wounded|missing|total }.
Ответ — JSON: columns строго по одному значению на каждый столбец, в порядке столбцов. Ничего не выдумывайте: не уверены — skip.` },
    { role: 'user', content: `Столбцов: ${header.length}. Таблица (ячейки через « | »):\n${rows}` },
  ];
}

/** Проверить ответ модели: число значений равно числу столбцов, слова — из списка. null — негодно. */
export function normalizeMapping(raw: unknown, width: number): TableMapping | null {
  const m = raw as { kind?: unknown; columns?: unknown } | null;
  if (!m || !(CLAIM_KINDS as readonly string[]).includes(m.kind as string) || !Array.isArray(m.columns)) return null;
  const ok = new Set<string>([...TEMPLATE_COLUMNS, 'skip']);
  const cols = m.columns.map((c): ColumnMeaning => {
    if (typeof c === 'string') return ok.has(c) ? (c as ColumnMeaning) : 'skip';
    const d = c as { day?: unknown; field?: unknown } | null;
    return d && typeof d.day === 'string' && (NUMBER_FIELDS as readonly string[]).includes(d.field as string) ? { day: d.day, field: d.field as NumberField } : 'skip';
  });
  while (cols.length < width) cols.push('skip');
  return { kind: m.kind as Claim['kind'], columns: cols.slice(0, width) };
}

/** Дата ГГГГ-ММ-ДД или ДД.ММ.ГГГГ (и с времени) → ISO; пусто/негодно/несуществующий день — null. */
export function parseDate(v: string): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.exec(s);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; } else {
    r = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    if (!r) return null;
    d = +r[1]; m = +r[2]; y = +r[3];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Дробное число (координаты, километры): «12,5», «12.5» → число; не число — null. */
export function parseNumber(v: string): number | null {
  const s = v.replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
  return /^[-+]?\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
}

/** Счётное целое (люди, танки, потери): «52000», «52.000», «1 200», «1,200» — разряды; дробное — не целое. */
export function parseWholeCount(v: string): { n: number } | { err: string } {
  const s = v.trim();
  if (/^\d+$/.test(s)) return { n: Number(s) };
  if (/^\d{1,3}(?:[.,\s\u00A0\u202F]\d{3})+$/.test(s)) return { n: Number(s.replace(/[.,\s\u00A0\u202F]/g, '')) };
  return { err: parseNumber(s) != null ? `число «${s}» не целое` : `число «${s}» не распознано` };
}

const CROSSING_RU: Record<string, 'open' | 'destroyed' | 'built'> = {
  open: 'open', destroyed: 'destroyed', built: 'built',
  проходима: 'open', проходим: 'open', открыта: 'open', открыт: 'open', действует: 'open', цел: 'open', цела: 'open',
  разрушена: 'destroyed', разрушен: 'destroyed', взорван: 'destroyed', взорвана: 'destroyed', уничтожен: 'destroyed', уничтожена: 'destroyed',
  наведена: 'built', наведён: 'built', наведен: 'built', построена: 'built', построен: 'built',
};
const KIND_FROM_RU = Object.fromEntries(Object.entries(KIND_RU).map(([k, ru]) => [ru, k])) as Record<string, ClaimKind>;
const kindOf = (v: string): ClaimKind | null => {
  const s = v.trim().toLowerCase();
  return (CLAIM_KINDS as readonly string[]).includes(s) ? (s as ClaimKind) : KIND_FROM_RU[s] ?? null;
};

type Fields = Partial<Record<TemplateColumn, string>>;

/**
 * Одна запись (поля шаблона) → кандидат или причина отказа. subject для boundary — «A / B» (две стороны),
 * place — «точка | точка | …»; переправа: состояние — в note; событие: название — note, иначе quote.
 */
function build(f: Fields, kind: ClaimKind, day: string | null, nums: Partial<Record<NumberField, number>>, doc: DocInfo, id: string, evidence: Candidate['evidence'], origin: 'table' | 'agent', row: number): Candidate | string {
  const date = parseDate(day ?? f.date ?? '');
  if (!date) return `дата «${(day ?? f.date ?? '').trim()}» не распознана (ГГГГ-ММ-ДД или ДД.ММ.ГГГГ)`;
  const dateTo = f.date_to?.trim() ? parseDate(f.date_to) : null;
  if (f.date_to?.trim() && !dateTo) return `дата «${f.date_to.trim()}» (date_to) не распознана`;
  const numeric = (k: 'lat' | 'lon' | 'approx_km') => (f[k]?.trim() ? parseNumber(f[k]!) : null);
  for (const k of ['lat', 'lon', 'approx_km'] as const) if (f[k]?.trim() && numeric(k) == null) return `число «${f[k]}» в столбце ${k} не распознано`;
  const subject = f.subject?.trim() ?? '';
  if (kind === 'position' && !f.place?.trim() && !(numeric('lat') != null && numeric('lon') != null)) return 'положение: нужны place или обе координаты (lat и lon)';
  if (kind !== 'boundary' && kind !== 'event' && !subject) return 'не указан объект (subject)';
  if ((kind === 'strength' || kind === 'reinforce') && !(['personnel', 'tanks', 'guns'] as const).some((k) => nums[k] != null)) return 'нет чисел (personnel, tanks, guns)';
  if (kind === 'losses' && !(['killed', 'wounded', 'missing', 'total', 'tanks'] as const).some((k) => nums[k] != null)) return 'нет чисел потерь';
  const crossing = CROSSING_RU[(f.note ?? '').trim().toLowerCase()];
  if (kind === 'crossing' && !crossing) return 'переправа: в note нужно состояние (open, destroyed, built)';
  const between = kind === 'boundary' ? subject.split(/\s*[/|]\s*/).filter(Boolean) : [];
  if (kind === 'boundary' && between.length !== 2) return 'разграничительная линия: в subject нужны две стороны через «/»';
  const points = kind === 'boundary' ? (f.place ?? '').split('|').map((p) => p.trim()).filter(Boolean) : [];
  if (kind === 'boundary' && points.length < 2) return 'разграничительная линия: в place нужно не меньше двух точек через «|»';
  const x: ExtractedClaim = {
    kind, subject: kind === 'boundary' ? null : subject || null, parent: f.parent?.trim() || null, place: f.place?.trim() || null,
    between: kind === 'boundary' ? between : null, points: kind === 'boundary' ? points : null,
    inclusive: null, title: kind === 'event' ? (f.note?.trim() || f.quote?.trim() || null) : null,
    date, dateTo: dateTo ?? date,
    personnel: nums.personnel ?? null, tanks: nums.tanks ?? null, guns: nums.guns ?? null, killed: nums.killed ?? null, wounded: nums.wounded ?? null, missing: nums.missing ?? null, total: nums.total ?? null,
    state: crossing ?? null, lat: numeric('lat'), lon: numeric('lon'), approxKm: numeric('approx_km'), quote: f.quote?.trim() ?? '',
  };
  const b = buildClaim(x);
  if (!b) return 'факт не собрать из этой строки';
  if (kind === 'parent' && !x.parent) return 'не указано вышестоящее (parent)';
  const names: Candidate['names'] = {
    ...(kind !== 'boundary' && subject ? { subject } : {}), ...(x.parent ? { parent: x.parent } : {}), ...(kind !== 'boundary' && x.place ? { place: x.place } : {}),
    ...(kind === 'boundary' ? { between: [between[0], between[1]] as [string, string] } : {}),
  };
  if (b.claim.kind === 'event') b.claim.id = id;
  const rel = f.reliability?.trim().toUpperCase();
  return {
    id, claim: b.claim, names, key: b.key, value: b.value, source: `doc:${doc.id}`,
    pages: [f.source?.trim(), f.pages?.trim()].filter(Boolean).join(', ') || (origin === 'table' ? `строка ${row}` : undefined),
    reliability: rel === 'A' || rel === 'B' || rel === 'C' ? (rel as Reliability) : doc.reliability, origin, evidence,
    ...(doc.operation ? { op: doc.operation } : {}),
    checks: [], verdict: 'review', state: 'pending',
  };
}

/**
 * Строки таблицы (первая — заголовок) → кандидаты. Номер строки в errors — как в файле (заголовок — 1).
 * Столбец kind (если есть) задаёт вид по строке, иначе вид — mapping.kind. «Дни в столбцах»: на каждый день строки
 * с непустыми ячейками — один кандидат с date = день столбца и всеми числами этого дня (убито, ранено …).
 */
export function rowsToCandidates(rows: string[][], mapping: TableMapping, doc: DocInfo): { candidates: Candidate[]; errors: RowError[]; skipped: string[] } {
  const header = rows[0] ?? [];
  const candidates: Candidate[] = [];
  const errors: RowError[] = [];
  const hasKind = mapping.columns.includes('kind');
  const skipped = header.filter((_, i) => (mapping.columns[i] ?? 'skip') === 'skip' && header[i].trim());
  // ключ ячейки в доказательстве: заголовок; повторяется («16.04 | 16.04» — убито, ранено) — с номером столбца
  const times = new Map<string, number>();
  for (const h of header) times.set(h.trim(), (times.get(h.trim()) ?? 0) + 1);
  const keyOf = (i: number) => { const h = header[i]?.trim() ?? ''; return !h ? `#${i + 1}` : (times.get(h) ?? 0) > 1 ? `${h}#${i + 1}` : h; };
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells.some((c) => c.trim())) continue;
    const row = r + 1;
    const f: Fields = {};
    const days: { day: string; field: NumberField; text: string; key: string }[] = [];
    mapping.columns.forEach((m, i) => {
      const v = (cells[i] ?? '').trim();
      if (m === 'skip') return;
      if (typeof m === 'object') { if (v) days.push({ day: m.day, field: m.field, text: v, key: keyOf(i) }); } else if (v) f[m] = v;
    });
    const evidence: Candidate['evidence'] = { kind: 'row', doc: doc.id, row, cells: Object.fromEntries(header.map((_, i) => [keyOf(i), (cells[i] ?? '').trim()]).filter(([, v]) => v)) };
    const dayCells = days.map((d) => d.key);
    if (hasKind && !f.kind) { errors.push({ row, why: 'не указан вид (kind)' }); continue; }
    const kind = f.kind ? kindOf(f.kind) : (mapping.kind as ClaimKind);
    if (!kind) { errors.push({ row, why: `неизвестный вид «${f.kind}»` }); continue; }
    // обычные числа: из числовых столбцов
    const nums: Partial<Record<NumberField, number>> = {};
    let bad = '';
    for (const k of NUMBER_FIELDS) if (f[k]) { const n = parseWholeCount(f[k]!); if ('err' in n) bad = `${n.err} (столбец ${k})`; else nums[k] = n.n; }
    if (bad) { errors.push({ row, why: bad }); continue; }
    if (days.length) {
      // один кандидат на день строки: все числа этого дня (убито и ранено за 16.04 — один факт потерь, не два)
      const byDay = new Map<string, typeof days>();
      for (const d of days) { const g = byDay.get(d.day); if (g) g.push(d); else byDay.set(d.day, [d]); }
      for (const [day, cellsOfDay] of byDay) {
        const dayIso = parseDate(day);
        if (!dayIso) { errors.push({ row, why: `дата столбца «${day}» не распознана` }); continue; }
        const dayNums: Partial<Record<NumberField, number>> = {};
        let why = '';
        for (const d of cellsOfDay) {
          const n = parseWholeCount(d.text);
          if ('err' in n) { why = `${n.err} (столбец ${d.key})`; break; }
          if (dayNums[d.field] != null) { why = `два столбца «${d.field}» за ${day}`; break; }
          dayNums[d.field] = n.n;
        }
        if (why) { errors.push({ row, why }); continue; }
        // доказательство — строка с отметкой ячеек этого дня: числа сверяются с ними, а не с соседними днями
        const own = cellsOfDay.map((d) => d.key);
        const ev: Candidate['evidence'] = { ...evidence, cell: own.length === 1 ? own[0] : own, dayCells } as Candidate['evidence'];
        const c = build(f, kind, dayIso, { ...nums, ...dayNums }, doc, `${doc.id}:r${row}:${candidates.length}`, ev, 'table', row);
        if (typeof c === 'string') errors.push({ row, why: c }); else candidates.push(c);
      }
    } else {
      const c = build(f, kind, null, nums, doc, `${doc.id}:r${row}:${candidates.length}`, evidence, 'table', row);
      if (typeof c === 'string') errors.push({ row, why: c }); else candidates.push(c);
    }
  }
  return { candidates, errors, skipped };
}

/** Пакет внешнего агента: { format: 'def-ops-facts', version: 1, source?, facts: [строки шаблона как объекты] }. */
export function parseFactsJson(json: unknown, doc: DocInfo): { candidates: Candidate[]; errors: RowError[] } {
  const j = json as { format?: unknown; version?: unknown; source?: { reliability?: unknown; title?: unknown; ref?: unknown }; facts?: unknown } | null;
  if (!j || typeof j !== 'object' || j.format !== 'def-ops-facts') return { candidates: [], errors: [{ row: 0, why: 'не формат def-ops-facts' }] };
  if (j.version !== 1) return { candidates: [], errors: [{ row: 0, why: `версия ${String(j.version)} не поддерживается (нужна 1)` }] };
  if (!Array.isArray(j.facts)) return { candidates: [], errors: [{ row: 0, why: 'нет списка facts' }] };
  const pkg = (j.source ?? {}) as { title?: unknown; ref?: unknown };
  const pkgRef = typeof pkg.ref === 'string' ? pkg.ref.trim() : '';
  const pkgTitle = typeof pkg.title === 'string' ? pkg.title.trim() : '';
  const pkgRel = typeof j.source?.reliability === 'string' ? j.source.reliability.toUpperCase() : '';
  const d: DocInfo = pkgRel === 'A' || pkgRel === 'B' || pkgRel === 'C' ? { ...doc, reliability: pkgRel as Reliability } : doc;
  const candidates: Candidate[] = [];
  const errors: RowError[] = [];
  j.facts.forEach((raw, i) => {
    const row = i + 1;
    if (!raw || typeof raw !== 'object') { errors.push({ row, why: 'факт не объект' }); return; }
    const o = raw as Record<string, unknown>;
    const f: Fields = {};
    for (const k of TEMPLATE_COLUMNS) {
      const v = o[k] ?? (k === 'approx_km' ? o.approxKm : k === 'date_to' ? o.dateTo : undefined);
      if (v != null && String(v).trim() !== '') f[k] = String(v).trim();
    }
    // естественные ключи пакета
    const txt = (v: unknown) => (v == null ? '' : String(v).trim());
    if (!f.note && txt(o.state)) f.note = txt(o.state);
    if (!f.note && txt(o.title)) f.note = txt(o.title);
    if (!f.subject && Array.isArray(o.between)) f.subject = o.between.map(txt).join(' / ');
    if (!f.place && Array.isArray(o.points)) f.place = o.points.map(txt).filter(Boolean).join(' | ');
    if (!f.source && pkgTitle) f.source = pkgTitle;
    if (!f.kind) { errors.push({ row, why: 'не указан вид (kind)' }); return; }
    const kind = kindOf(f.kind);
    if (!kind) { errors.push({ row, why: `неизвестный вид «${f.kind}»` }); return; }
    const nums: Partial<Record<NumberField, number>> = {};
    for (const k of NUMBER_FIELDS) if (f[k]) { const n = parseWholeCount(f[k]!); if ('err' in n) { errors.push({ row, why: `${n.err} (поле ${k})` }); return; } nums[k] = n.n; }
    const ref = (typeof o.ref === 'string' ? o.ref.trim() : '') || pkgRef;
    const evidence: Candidate['evidence'] = ref ? { kind: 'agent', ref, ...(f.quote ? { quote: f.quote } : {}) } : { kind: 'row', doc: doc.id, row, cells: f as Record<string, string> };
    const c = build(f, kind, null, nums, d, `${doc.id}:j${row}:${candidates.length}`, evidence, ref ? 'agent' : 'table', row);
    if (typeof c === 'string') errors.push({ row, why: c }); else candidates.push(c);
  });
  return { candidates, errors };
}
