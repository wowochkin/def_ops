/**
 * Окно сопоставления столбцов таблицы не по шаблону: заголовки с тремя строками примера, у каждого — смысл (список,
 * предложенный моделью выбран), вид фактов, «Разобрать». Несопоставленные («не нужен») столбцы пропускаются и
 * перечислены в итогах документа.
 */
import { useEffect, useState } from 'react';
import { CLAIM_KINDS, TEMPLATE_COLUMNS, type Claim, type ColumnMeaning, type TableMapping } from '@def-ops/knowledge';
import { KIND_RU } from '../modeling/basis';

const COLUMN_RU: Record<(typeof TEMPLATE_COLUMNS)[number], string> = {
  kind: 'вид факта', subject: 'соединение', date: 'дата (начало)', date_to: 'дата (конец)', personnel: 'людей', tanks: 'танков', guns: 'орудий',
  killed: 'убитых', wounded: 'раненых', missing: 'пропавших', total: 'потерь всего', parent: 'вышестоящее', place: 'пункт', lat: 'широта', lon: 'долгота',
  approx_km: '± км', source: 'источник', pages: 'страницы', reliability: 'достоверность', quote: 'цитата', note: 'примечание',
};
const NUM_FIELDS = ['personnel', 'tanks', 'guns', 'killed', 'wounded', 'missing', 'total'] as const;
type NumField = (typeof NUM_FIELDS)[number];
const DAY = '\u0000day';

export function ColumnMapping({ name, header, sample, proposed, onRun, onClose }: {
  name: string; header: string[]; sample: string[][]; proposed: TableMapping; onRun: (m: TableMapping) => void; onClose: () => void;
}) {
  const [kind, setKind] = useState<Claim['kind']>(proposed.kind);
  const [cols, setCols] = useState<ColumnMeaning[]>(() => header.map((_, i) => proposed.columns[i] ?? 'skip'));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const set = (i: number, m: ColumnMeaning) => setCols(cols.map((x, j) => (j === i ? m : x)));
  const used = cols.filter((c) => c !== 'skip').length;
  return (
    <div className="confirm-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="confirm-box cm" data-modal role="dialog" aria-label="Сопоставление столбцов">
        <h3>Сопоставление столбцов: {name}</h3>
        <p className="muted">Таблица не по шаблону. Модель предложила смысл каждого столбца — проверьте; ненужные столбцы — «не нужен» (они будут перечислены в итогах). Если заголовки — даты (дни в столбцах), выберите «день» и укажите дату и что за число.</p>
        <label className="cm-kind">Вид фактов <select value={kind} onChange={(e) => setKind(e.target.value as Claim['kind'])}>
          {CLAIM_KINDS.map((k) => <option key={k} value={k}>{KIND_RU[k] ?? k}</option>)}</select>
          <span className="muted small">— если в таблице нет столбца «вид факта»</span></label>
        <div className="cm-wrap"><table className="cm-t"><thead><tr><th>Столбец</th><th>Пример</th><th>Смысл</th></tr></thead><tbody>
          {header.map((h, i) => { const m = cols[i]; const day = typeof m === 'object'; return <tr key={i} className={m === 'skip' ? 'skip' : ''}>
            <th>{h || `столбец ${i + 1}`}</th>
            <td>{sample.slice(0, 3).map((r, j) => <div key={j}>{r[i] || <span className="muted">—</span>}</div>)}</td>
            <td><select value={day ? DAY : m} onChange={(e) => set(i, e.target.value === DAY ? { day: /^\d{4}-\d{2}-\d{2}$/.test(h.trim()) ? h.trim() : '', field: 'personnel' } : e.target.value as ColumnMeaning)}>
              <option value="skip">не нужен</option>
              {TEMPLATE_COLUMNS.map((c) => <option key={c} value={c}>{COLUMN_RU[c]}</option>)}
              <option value={DAY}>день (числа за дату)</option></select>
              {day && <div className="cm-day"><input type="date" value={m.day} onChange={(e) => set(i, { ...m, day: e.target.value })} />
                <select value={m.field} onChange={(e) => set(i, { ...m, field: e.target.value as NumField })}>{NUM_FIELDS.map((f) => <option key={f} value={f}>{COLUMN_RU[f]}</option>)}</select></div>}</td>
          </tr>; })}
        </tbody></table></div>
        <div className="confirm-row"><span className="muted small cm-n">сопоставлено столбцов: {used} из {header.length}</span>
          <button onClick={onClose}>Отмена</button>
          <button className="primary" disabled={!used || cols.some((c) => typeof c === 'object' && !c.day)} onClick={() => onRun({ kind, columns: cols })}>Разобрать</button></div>
      </div>
    </div>
  );
}
