/**
 * Разговор с агентом через локальную языковую модель (docs/plans/agents.md, раздел 8.2). Два голоса:
 * «Командир» отвечает из выбранного часа и знает только своё (состояние, приказ, свой журнал, противника рядом);
 * «Разбор» видит ещё исходные данные с источниками и положения по документам. Ответ строится на выданных записях
 * со ссылками [S1], [J3]…; где записи нет — модель должна сказать, что это её мнение.
 */
import { useState } from 'react';
import type { RunData, Settings } from './data';
import { chatLLM, hourOf, km, posAt, rowAt, shortName, timeLabel } from './data';

type Voice = 'commander' | 'analyst';
interface Rec { id: string; text: string; tick?: number }
interface Msg { role: 'user' | 'assistant'; text: string; voice: Voice; hour: number; records?: Rec[] }

export function buildRecords(data: RunData, id: string, hour: number, voice: Voice): Rec[] {
  const { trace, history } = data;
  const i = trace.divisions.findIndex((d) => d.id === id);
  const d = trace.divisions[i];
  const row = rowAt(trace, i, hour);
  const recs: Rec[] = [];
  recs.push({ id: 'S1', text: `Время ${timeLabel(trace.start, hour)} МСК. Состояние: ${row[2]}. Люди ${Math.round(row[3])}, танки ${Math.round(row[4])}, орудия ${Math.round(row[5])}, боекомплектов ${row[6]}, заправок ${row[7]}, усталость ${row[8]}, организованность ${row[9]}.` });
  const ev = trace.journal.filter((e) => e.agent === id && e.tick <= hour);
  const lim = voice === 'commander' ? ev.slice(-25) : ev;
  lim.forEach((e, k) => recs.push({ id: `J${k + 1}`, text: `${e.time.slice(8, 10)}.${e.time.slice(5, 7)} ${e.time.slice(11, 16)}: ${e.text}`, tick: e.tick }));
  // противник в 15 км — то, что видит штаб дивизии
  const me = posAt(trace, i, hour);
  let k = 0;
  trace.divisions.forEach((o, j) => {
    if (o.side === d.side) return;
    const dist = km(me, posAt(trace, j, hour));
    if (dist <= 15) recs.push({ id: `E${++k}`, text: `Противник: ${shortName(o)} в ${dist.toFixed(1)} км, ${rowAt(trace, j, hour)[2]}.` });
  });
  if (voice === 'analyst') {
    d.note.split('; ').filter(Boolean).forEach((n, m) => recs.push({ id: `P${m + 1}`, text: `Исходные данные: ${n}.` }));
    history.divisions.filter((p) => p.formation === id).forEach((p, m) => {
      const h = Math.max(0, Math.min(trace.hours, hourOf(trace.start, p.time)));
      recs.push({ id: `H${m + 1}`, text: `По документам (${p.set}, достоверность ${p.reliability ?? '—'}): ${p.time} — ${p.at[1].toFixed(3)}° с. ш., ${p.at[0].toFixed(3)}° в. д.; расчётное положение на это время — в ${km(posAt(trace, i, h), p.at).toFixed(1)} км.`, tick: Math.round(h) });
    });
  }
  return recs;
}

function systemPrompt(data: RunData, id: string, voice: Voice): string {
  const d = data.trace.divisions.find((x) => x.id === id)!;
  const who = voice === 'commander'
    ? `Ты — командир (начальник штаба) соединения «${d.name}» в Берлинской операции 1945 года. Отвечай от первого лица, коротко, по-военному. Ты знаешь только то, что в записях ниже: своё состояние, свои приказы и события, противника рядом. Будущего и того, как всё было на самом деле, ты не знаешь.`
    : `Ты — аналитик стенда переигровки. Разбираешь, почему агент-соединение «${d.name}» в расчёте вело себя так, и сравниваешь расчёт с документами. Ты видишь записи ниже: состояние, журнал модели с причинами, исходные данные с источниками, положения по документам.`;
  return `${who}
Правила: отвечай по-русски. Опирайся только на записи и ссылайся на них в квадратных скобках, например [J3] или [S1]. Если ответа в записях нет, прямо скажи «в записях этого нет» и, если отвечаешь всё же, пометь это как «мнение модели». Не придумывай цифр.`;
}

export function Chat({ data, id, hour, onHour, settings, onSettings }: { data: RunData; id: string; hour: number; onHour: (h: number) => void; settings: Settings; onSettings: () => void }) {
  const [voice, setVoice] = useState<Voice>('commander');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function ask() {
    const q = text.trim();
    if (!q || busy) return;
    const records = buildRecords(data, id, hour, voice);
    const user: Msg = { role: 'user', text: q, voice, hour };
    setMsgs((m) => [...m, user]);
    setText('');
    setBusy(true);
    try {
      const recText = records.map((r) => `[${r.id}] ${r.text}`).join('\n');
      const history = msgs.filter((m) => m.voice === voice).slice(-6).map((m) => ({ role: m.role, content: m.text }));
      const answer = await chatLLM(settings.llmUrl, settings.chatModel || 'local-model', [{ role: 'system', content: `${systemPrompt(data, id, voice)}\n\nЗаписи:\n${recText}` }, ...history, { role: 'user', content: q }]);
      setMsgs((m) => [...m, { role: 'assistant', text: answer, voice, hour, records }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: `Языковая модель недоступна (${(e as Error).message}). Запустите LM Studio с сервером OpenAI на ${settings.llmUrl} и выберите модель в «Модель и штабы».`, voice, hour, records }]);
    } finally { setBusy(false); }
  }

  const cite = (m: Msg, s: string) => s.split(/(\[[A-Z]\d+\])/).map((part, k) => {
    const rid = part.match(/^\[([A-Z]\d+)\]$/)?.[1];
    const rec = rid ? m.records?.find((r) => r.id === rid) : undefined;
    if (!rec) return <span key={k}>{part}</span>;
    return <span key={k} className="cite" title={rec.text} onClick={() => rec.tick !== undefined && onHour(rec.tick)}>{part}</span>;
  });

  return (
    <div className="chat">
      <div className="voices">
        <button className={voice === 'commander' ? 'on' : ''} onClick={() => setVoice('commander')}>Командир</button>
        <button className={voice === 'analyst' ? 'on' : ''} onClick={() => setVoice('analyst')}>Разбор</button>
        <span className="hint">{voice === 'commander' ? 'знает только своё на выбранный час' : 'видит расчёт, источники и документы'}</span>
      </div>
      <div className="msgs">
        {msgs.length === 0 && <div className="hint">Спросите, например: «Почему остановились?», «Что вам известно о противнике?», «Откуда взята численность?»</div>}
        {msgs.map((m, k) => (
          <div key={k} className={`msg ${m.role}`}>
            <div className="meta">{m.role === 'user' ? 'Вопрос' : m.voice === 'commander' ? 'Командир' : 'Разбор'} · {timeLabel(data.trace.start, m.hour)}</div>
            <div>{m.role === 'assistant' ? cite(m, m.text) : m.text}</div>
            {m.records && <details><summary>записи, выданные модели ({m.records.length})</summary><ul>{m.records.map((r) => <li key={r.id}>[{r.id}] {r.text}</li>)}</ul></details>}
          </div>
        ))}
      </div>
      <div className="ask">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Вопрос агенту…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }} />
        <button onClick={() => void ask()} disabled={busy}>{busy ? '…' : 'Спросить'}</button>
      </div>
      <div className="llm">Модель: {settings.chatModel || 'не выбрана'} · <a href="#" onClick={(e) => { e.preventDefault(); onSettings(); }}>выбрать</a></div>
    </div>
  );
}
