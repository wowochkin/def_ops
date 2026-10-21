/**
 * Голоса: образцы с ролями (начальник штаба, посредник), прослушать, назначить роль, удалить;
 * запись нового голоса с микрофона — предупреждение, текст для чтения, запись, проверка с причинами,
 * проба новым голосом, сохранение с именем. Закрыли без сохранения — сервис стирает запись (`discard`).
 * Проба звучит одна: новая проба, закрытие окна и начало записи останавливают прежнюю (звук в окне и синтез).
 *
 * Голосом — действия окна в реестре (кнопки вызывают их же): `voices.preview {name}` («прослушай второй голос»),
 * `voices.assign {name, role}` («назначь Гость начальнику штаба»), `voices.record {name?}` («запиши новый голос»: штаб
 * зачитывает текст, запись начинается сама и сама кончается, когда человек замолчал), `voices.save {name?}`,
 * `voices.discard`, `voices.delete {name}` (необратимое: голосом — после «да»), `voices.close`. Голос называют по имени
 * или номеру в списке; похожих несколько — штаб переспрашивает.
 */
import { useEffect, useRef, useState } from 'react';
import { confirmAsync } from '../dialogs';
import { ordinalIndex, pickByName } from './answers';
import type { VoiceClient } from './client';
import type { VoiceCheck, VoiceInfo, VoiceRole, VoiceRoles } from './protocol';
import { act, ActButton, openModal, useAction } from './registry';
import { hl, note, noted } from './highlight';
import type { VoiceReady } from './VoicePanel';

const ORDS = ['первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const trimVoice = (s: string) => s.replace(/^голос /, '').replace(/ голос$/, '').trim();

/** Ответы окна «Голоса» голосом (реплика без обращения) → действие окна. */
/** Записи одного человека («Жуков, 10 с», «Жуков, 14 с») — один голос с выбором записи. */
export function groupVoices(vs: VoiceInfo[]): { who: string; items: VoiceInfo[] }[] {
  const out: { who: string; items: VoiceInfo[] }[] = [];
  for (const v of vs) {
    const who = v.name.includes(', ') ? v.name.slice(0, v.name.indexOf(', ')) : v.name;
    const g = out.find((x) => x.who === who);
    if (g) g.items.push(v); else out.push({ who, items: [v] });
  }
  return out;
}
const sampleLabel = (v: VoiceInfo) => (v.name.includes(', ') ? v.name.slice(v.name.indexOf(', ') + 2) : v.name);

export function voicesParse(rest: string): { id: string; params?: Record<string, unknown> } | null {
  let m = /^(?:прослушай|послушай|прослушать|послушать|проиграй|включи)(?: голос)? (.+)$/.exec(rest);
  if (m) return { id: 'voices.preview', params: { name: trimVoice(m[1]) } };
  m = /^(?:назначь|поставь|сделай)(?: голос)? (.+?) (начальник\S* штаба|начштаба|посредник\S*)$/u.exec(rest);
  if (m) return { id: 'voices.assign', params: { name: trimVoice(m[1]), role: /^посредник/.test(m[2]) ? 'umpire' : 'chief' } };
  m = /^(?:запиши|записать|записывай)(?: новый| заново)? голос(?: (.+))?$/.exec(rest) ?? /^(?:запиши заново|записать заново)()$/.exec(rest);
  if (m) return { id: 'voices.record', params: m[1] ? { name: m[1] } : {} };
  m = /^(?:удали|удалить|сотри)(?: голос)? (.+)$/.exec(rest);
  if (m) return { id: 'voices.delete', params: { name: trimVoice(m[1]) } };
  m = /^(?:сохрани|сохранить)(?: голос)?(?: (?:как|под именем|с именем))?(?: (.+))?$/.exec(rest) ?? /^(?:имя|назови его|назови) (.+)$/.exec(rest);
  if (m) return { id: 'voices.save', params: m[1] ? { name: m[1] } : {} };
  if (/^(?:не сохраняй|не сохранять|отмена записи)$/.test(rest)) return { id: 'voices.discard' };
  if (/^(?:начать|начни|начинай|начинаю)(?: запись)?$/.test(rest)) return { id: 'voices.rec.start' };
  if (/^(?:закончи|закончить|заканчиваю|останови|остановить)(?: запись)?$/.test(rest)) return { id: 'voices.rec.stop' };
  if (/^(?:закрой|закрыть|выйди|отмена|готово)(?: окно)?$/.test(rest)) return { id: 'voices.close' };
  return null;
}

/**
 * Голос по имени или номеру в списке (кнопки окна передают voiceId — его и берём): найден — voice; несколько похожих
 * или нет такого — что спросить.
 */
export function voiceByName<V extends { id: string; name: string }>(name: string, list: V[], voiceId?: string): { voice: V } | { ask: string } {
  if (voiceId) { const v = list.find((x) => x.id === voiceId); return v ? { voice: v } : { ask: 'Этого голоса уже нет.' }; }
  const i = ordinalIndex(name, list.length);
  if (i !== null && list[i]) return { voice: list[i] };
  const hit = pickByName(name, list.map((v) => v.name));
  if (hit.length === 1) return { voice: list[hit[0]] };
  if (hit.length > 1) return { ask: `Какой голос: ${hit.map((k) => `${ORDS[k] ?? `номер ${k + 1}`} — «${list[k].name}»`).join(', ')}? Скажите номер.` };
  return { ask: `Голоса «${name}» нет. Есть: ${list.map((v) => `«${v.name}»`).join(', ')}.` };
}

/** Итог проверки записи словами — кончается «Жду ответа.», а не словом-ответом (иначе быстрый ответ — «эхо»). */
export const CHECK_BAD_SAY = (why: string) => `Запись не подошла: ${why.replace(/[.\s]+$/, '')}. Скажите «запиши заново» или «закрой». Жду ответа.`;
export const CHECK_OK_SAY = 'Запись подходит. Скажите: «сохрани как …» и имя голоса — или «прослушай пробу», «запиши заново». Жду ответа.';

/** Запись голосом кончается сама: не раньше этого, когда человек молчит столько; и не позже этого. */
const REC_MIN_MS = 14_000, REC_QUIET_MS = 2_500, REC_MAX_MS = 40_000, REC_P = 0.3;

const ROLE_NAME: Record<VoiceRole, string> = { chief: 'Начальник штаба', umpire: 'Посредник' };
const ROLE_OF: Record<VoiceRole, string> = { chief: 'голос начальника штаба', umpire: 'голос посредника' };
const ROLES = Object.keys(ROLE_NAME) as VoiceRole[];

/** failed — сбой во время записи или проверки: причина вверху окна, кнопки «Отмена» и «Записать заново». */
type Rec = 'none' | 'intro' | 'rec' | 'checking' | 'checked' | 'failed';

export function Voices({ client, ready, onClose, setBusy, previewId, say }: {
  client: VoiceClient;
  ready: VoiceReady | null;
  onClose(): void;
  setBusy(s: string | null): void;
  /** новый номер фразы для пробы (панель не считает пробу ответом штаба) */
  previewId(): number;
  /** фраза штаба; промис — когда договорил (или фразу сняли) */
  say?(text: string): Promise<void>;
}) {
  const [voices, setVoices] = useState<VoiceInfo[]>(ready?.voices ?? []);
  const [roles, setRoles] = useState<Partial<VoiceRoles>>(ready?.roles ?? {});
  const [rec, setRec] = useState<Rec>('none');
  /** Какая запись выбрана у человека с несколькими записями (имя → id). */
  const [pickId, setPickId] = useState<Record<string, string>>({});
  const [text, setText] = useState(ready?.recordText ?? '');
  const [check, setCheck] = useState<VoiceCheck | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const unsaved = useRef(false);  // на сервисе есть запись, не ставшая образцом
  const preview = useRef<number | null>(null);  // звучащая проба
  /** Запись ведётся голосом: начинается и кончается сама, итог проверки и сохранение — словами; имя — если сказано. */
  const byVoice = useRef<{ name?: string } | null>(null);
  const alive = useRef(true);
  const sayRef = useRef(say);
  sayRef.current = say;
  const talk = (t: string) => sayRef.current?.(t) ?? Promise.resolve();
  const st = useRef({ voices, roles, rec, check, name, text });
  st.current = { voices, roles, rec, check, name, text };

  /** Остановить звучащую пробу: звук в окне — сразу, синтез в сервисе — `stop {id}`. */
  const stopPreview = () => {
    if (preview.current !== null) client.stop(preview.current);
    preview.current = null;
  };

  useEffect(() => {
    const offs = [
      client.onPlayed((id) => { if (id === preview.current) preview.current = null; }),
      client.on('say-done', (m) => { if (m.stopped && m.id === preview.current) preview.current = null; }),
      client.on('barge', (m) => { if (m.id === preview.current) preview.current = null; }),
      client.on('voice_list', (m) => { setVoices(m.voices); setRoles(m.roles); }),
      client.on('voice_recording', (m) => { setText(m.text); setRec('rec'); setSecs(0); }),
      client.on('voice_check', (m) => {
        setCheck(m);
        setRec('checked');
        const v = byVoice.current;
        if (!v) return;
        if (!m.ok) { void talk(CHECK_BAD_SAY(m.reasons[0] ?? 'перечитайте текст')); return; }
        if (v.name) { void talk(`Запись подходит. Сохраняю голос «${v.name}».`); send('save', { name: v.name }); return; }
        void talk(CHECK_OK_SAY);
      }),
      client.on('voice_saved', () => {
        unsaved.current = false; setRec('none'); setCheck(null); setName('');
        if (byVoice.current) { const n = byVoice.current.name; byVoice.current = null; void talk(n ? `Голос «${n}» сохранён.` : 'Голос сохранён.'); }
      }),
      client.on('error', (m) => { setError(m.text); setRec((r) => (r === 'rec' || r === 'checking' ? 'failed' : r)); }),
      // связь оборвалась: сервис стёр запись этого подключения — начать заново, а не ждать «Проверяю запись…»
      client.onStatus((st) => {
        if (st === 'ready') return;
        setRec((r) => {
          if (r === 'none' || r === 'intro') return r;
          unsaved.current = false;
          setCheck(null);
          setError('Связь с голосом прервалась — запись не сохранилась. Запишите голос заново.');
          return 'none';
        });
      }),
    ];
    client.voice('list');
    return () => {
      alive.current = false;
      offs.forEach((o) => o());
      stopPreview();
      if (unsaved.current) client.voice('discard');
      setBusy(null);
    };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setBusy(rec === 'rec' ? 'Запись голоса' : null); }, [rec]); // eslint-disable-line react-hooks/exhaustive-deps
  // запись голосом кончается сама: человек дочитал и замолчал (или слишком долго)
  useEffect(() => {
    if (rec !== 'rec' || !byVoice.current) return;
    const t0 = Date.now();
    let heard = false, quietSince = t0;
    const off = client.on('level', (m) => { if (m.p >= REC_P) { heard = true; quietSince = Date.now(); } });
    const t = setInterval(() => {
      const now = Date.now();
      if ((heard && now - t0 >= REC_MIN_MS && now - quietSince >= REC_QUIET_MS) || now - t0 >= REC_MAX_MS) stop();
    }, 250);
    return () => { off(); clearInterval(t); };
  }, [rec]); // eslint-disable-line react-hooks/exhaustive-deps

  // окно ждёт ответа: голосом — только его действия (и стоп-слова, «отбой», «повтори»)
  useEffect(() => {
    const roleName = (r: VoiceRole) => st.current.voices.find((v) => v.id === st.current.roles[r])?.name ?? 'образец по умолчанию';
    return openModal({
      question: 'Окно «Голоса». Скажите: «прослушай второй голос», «назначь первый голос посреднику», «запиши новый голос» или «закрой».',
      get read() {
        return `Голоса. Начальник штаба — «${roleName('chief')}», посредник — «${roleName('umpire')}». Можно сказать: «прослушай второй голос», `
          + '«назначь первый голос посреднику», «запиши новый голос», «закрой».';
      },
      parse: voicesParse,
      isAnswer: (rest) => voicesParse(rest) !== null,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (rec !== 'rec') return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [rec]);

  const send = (op: string, args: Record<string, unknown> = {}) => { setError(null); client.voice(op, args); };
  const listen = (args: Record<string, unknown> = {}) => {
    stopPreview();
    const id = previewId();
    preview.current = id;
    send('preview', { ...args, id });
  };
  const start = () => { stopPreview(); unsaved.current = true; setCheck(null); send('record-start'); };
  const stop = () => { setRec('checking'); send('record-stop'); };
  const discard = () => {
    if (unsaved.current) client.voice('discard');
    unsaved.current = false;
    setRec('none'); setCheck(null); setName('');
  };
  const remove = async (v: VoiceInfo) => {
    if (await confirmAsync(`Удалить голос «${v.name}»? Файлы образца будут стёрты с этого компьютера.`, { ok: 'Удалить', danger: true }))
      void act('voices.delete', { voice_id: v.id });
  };
  /** Голос по сказанному имени или номеру (или ответ, что спросить). */
  const find = (p: { name?: unknown; voice_id?: string } | undefined) => voiceByName(String(p?.name ?? ''), st.current.voices, p?.voice_id);
  /** Параметры: имя или номер голоса (голосом) либо voice_id (кнопки окна). */
  const WHO = { name: { type: 'string' }, voice_id: { type: 'string' } };
  const idle = () => (st.current.rec === 'rec' || st.current.rec === 'checking' ? 'сейчас идёт запись голоса' : true as const);

  useAction({
    id: 'voices.preview', section: 'global', title: 'Прослушать голос', describe: 'Проигрывает образец голоса (по имени или номеру в списке; «пробу» — проверенную запись).',
    params: { type: 'object', properties: WHO }, say: ['прослушай второй голос'], available: idle,
    run: async (p: { name?: string; voice_id?: string }) => {
      if (/^проб/.test(String(p?.name ?? ''))) { if (st.current.rec === 'checked' && st.current.check?.ok) { listen(); return; } return 'Пробы пока нет — сначала запишите голос.'; }
      const r = find(p);
      if ('ask' in r) return r.ask;
      listen({ voice_id: r.voice.id });
    },
  });
  useAction({
    id: 'voices.assign', section: 'global', title: 'Назначить голос', describe: 'Назначает голос роли: начальник штаба или посредник.',
    params: { type: 'object', properties: { ...WHO, role: { enum: ROLES } }, required: ['role'] },
    say: ['назначь первый голос посреднику'], available: () => true, highlight: noted,
    run: async (p: { name?: string; voice_id?: string; role: VoiceRole }) => {
      const r = find(p);
      if ('ask' in r) return r.ask;
      if (!ROLES.includes(p?.role)) return 'Кому назначить: начальнику штаба или посреднику?';
      send('assign', { role: p.role, voice_id: r.voice.id });
      note(hl(`voice-${r.voice.id}`), hl('voice-roles'));
      return `«${r.voice.name}» — теперь ${ROLE_OF[p.role]}.`;
    },
  });
  useAction({
    id: 'voices.record', section: 'global', title: 'Записать новый голос', describe: 'Записывает новый голос с микрофона: текст зачитывается, запись идёт сама.',
    params: { type: 'object', properties: { name: { type: 'string' }, manual: { type: 'boolean' } } }, say: ['запиши новый голос'], available: idle, highlight: () => hl('voices-rec'),
    run: async (p?: { name?: string; manual?: boolean }) => {
      // кнопкой — текст на экране, запись — кнопками «Начать запись» / «Закончить запись»
      if (p?.manual) { byVoice.current = null; setCheck(null); setRec('intro'); return; }
      // голосом: показать текст, зачитать его — и записывать, когда штаб договорил; кончится сама
      const nm = p?.name ? cap(String(p.name).trim()) : undefined;
      byVoice.current = { name: nm };
      if (nm) setName(nm);
      setCheck(null);
      setRec('intro');
      const txt = st.current.text || ready?.recordText || '';
      void talk(`Прочитайте вслух текст с экрана, когда я договорю; запись кончится сама. Текст такой: ${txt}`).then(() => {
        if (alive.current && byVoice.current) start();
      });
    },
  });
  useAction({
    id: 'voices.rec.start', section: 'global', title: 'Начать запись голоса', describe: 'Начинает запись нового голоса (текст — на экране).', say: ['начать запись'],
    available: () => (['intro', 'failed', 'checked'].includes(st.current.rec) ? true : 'сначала скажите «запиши новый голос»'),
    run: async () => { start(); },
  });
  useAction({
    id: 'voices.rec.stop', section: 'global', title: 'Закончить запись голоса', describe: 'Заканчивает запись нового голоса и проверяет её.', say: ['закончить запись'],
    available: () => (st.current.rec === 'rec' ? true : 'запись не идёт'),
    run: async () => { stop(); },
  });
  useAction({
    id: 'voices.save', section: 'global', title: 'Сохранить голос', describe: 'Сохраняет проверенную запись как новый голос с именем.',
    params: { type: 'object', properties: { name: { type: 'string' } } }, say: ['сохрани как Гость'], highlight: () => [hl('voices-list'), hl('voices-rec')],
    available: () => (st.current.rec === 'checked' && st.current.check?.ok ? true : 'сохранять нечего — сначала запишите голос'),
    run: async (p?: { name?: string }) => {
      const nm = (p?.name ? cap(String(p.name).trim()) : st.current.name.trim());
      if (!nm) return 'Скажите имя голоса: «сохрани как …».';
      byVoice.current = byVoice.current ? { name: nm } : null;
      send('save', { name: nm });
    },
  });
  useAction({
    id: 'voices.discard', section: 'global', title: 'Не сохранять запись', describe: 'Отказ от записанного голоса.', say: ['не сохраняй'],
    available: () => (st.current.rec === 'none' ? 'записи нет' : true),
    run: async () => { byVoice.current = null; discard(); },
  });
  useAction({
    id: 'voices.delete', section: 'global', title: 'Удалить голос', describe: 'Удаляет записанный голос (файлы образца стираются).',
    params: { type: 'object', properties: WHO }, say: ['удали голос Гость'], irreversible: true,
    // какой голос — выясняется до вопроса «да / нет»: несколько похожих — сначала «какой»
    check: (p: { name?: string; voice_id?: string }) => {
      const r = find(p);
      if ('ask' in r) return r.ask;
      return r.voice.builtin ? 'Встроенный голос удалить нельзя.' : true;
    },
    confirm: (p: { name?: string; voice_id?: string }) => {
      const r = find(p);
      return `Удалить голос «${'voice' in r ? r.voice.name : p?.name}»? Файлы образца будут стёрты с этого компьютера.`;
    },
    available: () => true,
    run: async (p: { name?: string; voice_id?: string }) => {
      const r = find(p);
      if ('ask' in r) return r.ask;
      if (r.voice.builtin) return 'Встроенный голос удалить нельзя.';
      send('delete', { voice_id: r.voice.id });
      return `Голос «${r.voice.name}» удалён.`;
    },
  });
  useAction({
    id: 'voices.close', section: 'global', title: 'Закрыть окно «Голоса»', describe: 'Закрывает окно голосов.', say: ['закрой'],
    available: () => (st.current.rec === 'rec' ? 'идёт запись голоса' : true),
    run: async () => { byVoice.current = null; onClose(); },
  });

  return (
    <div className="vp-back" onClick={(e) => { if (e.target === e.currentTarget && rec !== 'rec') void act('voices.close'); }}>
      <div className="vp-dialog voices" data-modal role="dialog" aria-label="Голоса">
        <h3>Голоса</h3>
        <p className="vp-roles" data-hl="voice-roles">
          {ROLES.map((r) => <span key={r}>{ROLE_NAME[r]} — <b>{voices.find((v) => v.id === roles[r])?.name ?? 'образец по умолчанию'}</b></span>)}
        </p>
        {error && <p className="vp-error" role="alert">{error}</p>}

        <ul className="vp-voices" data-hl="voices-list">
          {!voices.length && <li className="vp-note">Образцов пока нет — запишите новый голос.</li>}
          {groupVoices(voices).map((g) => {
            const sel = g.items.find((v) => v.id === pickId[g.who]) ?? g.items.find((v) => ROLES.some((r) => roles[r] === v.id)) ?? g.items[0];
            const has = ROLES.filter((r) => g.items.some((v) => roles[r] === v.id));
            return (
              <li key={g.who} className={`vp-voice${has.length ? ' used' : ''}`} data-hl={`voice-${sel.id}`}>
                <button className="vp-play" title="Прослушать" aria-label="Прослушать" onClick={() => { void act('voices.preview', { voice_id: sel.id }); }}>▶</button>
                <div className="vp-vname">
                  <b>{g.items.length > 1 ? g.who : sel.name}</b>
                  {g.items.length > 1
                    ? <select aria-label={`Запись голоса «${g.who}»`} value={sel.id} onChange={(e) => setPickId((m) => ({ ...m, [g.who]: e.target.value }))}>
                        {g.items.map((v) => <option key={v.id} value={v.id}>{sampleLabel(v)}{ROLES.some((r) => roles[r] === v.id) ? ' ✓' : ''}</option>)}
                      </select>
                    : <span className="vp-vsub">{sel.builtin ? 'встроенный' : sel.source}</span>}
                </div>
                <div className="vp-seg" role="group" aria-label="Назначить роли">
                  {ROLES.map((r) => (
                    <button key={r} className={roles[r] === sel.id ? 'on' : g.items.some((v) => roles[r] === v.id) ? 'other' : ''} disabled={roles[r] === sel.id} onClick={() => { void act('voices.assign', { voice_id: sel.id, role: r }); }}>{ROLE_NAME[r]}</button>
                  ))}
                </div>
                {!sel.builtin && <button className="danger vp-del" onClick={() => { void remove(sel); }}>Удалить</button>}
              </li>
            );
          })}
        </ul>

        {rec === 'none' && (
          <div className="vp-row">
            <button onClick={() => { void act('voices.close'); }}>Закрыть</button>
            <ActButton className="primary" action="voices.record" params={{ manual: true }}>Записать новый голос</ActButton>
          </div>
        )}
        {rec !== 'none' && (
          <section className="vp-record" data-hl="voices-rec">
            <h4>Новый голос</h4>
            <p className="vp-warn">Голос будет использоваться системой, хранится только на этом компьютере.</p>
            <p>Прочитайте вслух спокойно, обычным голосом — это займёт 15–20 секунд:</p>
            <p className="vp-say">{text || 'Текст для чтения придёт от голосового сервиса.'}</p>
            {rec === 'intro' && (
              <div className="vp-row">
                <ActButton action="voices.discard">Отмена</ActButton>
                <ActButton className="primary" action="voices.rec.start">Начать запись</ActButton>
              </div>
            )}
            {rec === 'rec' && (
              <div className="vp-row">
                <span className="vp-recdot">Идёт запись: {secs} с</span>
                <ActButton className="primary" action="voices.rec.stop">Закончить запись</ActButton>
              </div>
            )}
            {rec === 'checking' && <p className="vp-note">Проверяю запись…</p>}
            {rec === 'failed' && (
              <div className="vp-row">
                <ActButton action="voices.discard">Отмена</ActButton>
                <ActButton className="primary" action="voices.rec.start">Записать заново</ActButton>
              </div>
            )}
            {rec === 'checked' && check && (
              <div className="vp-check">
                {check.ok ? (
                  <>
                    <p className="vp-good">Запись подходит{check.audio_s ? ` (${check.audio_s.toFixed(1)} с)` : ''}.</p>
                    <div className="vp-row left">
                      <ActButton action="voices.preview" params={{ name: 'пробу' }}>Прослушать пробу</ActButton>
                    </div>
                    <label className="vp-name">Имя голоса
                      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="например, Гость" />
                    </label>
                    <div className="vp-row">
                      <ActButton action="voices.discard">Не сохранять</ActButton>
                      <ActButton action="voices.rec.start">Записать заново</ActButton>
                      <ActButton className="primary" disabled={!name.trim()} action="voices.save" params={{ name: name.trim() }}>Сохранить</ActButton>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="vp-bad">Перечитайте текст:</p>
                    <ul>{check.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    <div className="vp-row">
                      <ActButton action="voices.discard">Отмена</ActButton>
                      <ActButton className="primary" action="voices.rec.start">Записать заново</ActButton>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
