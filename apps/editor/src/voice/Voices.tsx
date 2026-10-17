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
import { act, openModal, useAction } from './registry';
import type { VoiceReady } from './VoicePanel';

const ORDS = ['первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const trimVoice = (s: string) => s.replace(/^голос /, '').replace(/ голос$/, '').trim();

/** Ответы окна «Голоса» голосом (реплика без обращения) → действие окна. */
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
  if (/^(?:закрой|закрыть|выйди|отмена|готово)(?: окно)?$/.test(rest)) return { id: 'voices.close' };
  return null;
}

/** Голос по имени или номеру в списке: найден — voice; несколько похожих или нет такого — что спросить. */
export function voiceByName<V extends { id: string; name: string }>(name: string, list: V[]): { voice: V } | { ask: string } {
  const i = ordinalIndex(name, list.length);
  if (i !== null && list[i]) return { voice: list[i] };
  const hit = pickByName(name, list.map((v) => v.name));
  if (hit.length === 1) return { voice: list[hit[0]] };
  if (hit.length > 1) return { ask: `Какой голос: ${hit.map((k) => `${ORDS[k] ?? `номер ${k + 1}`} — «${list[k].name}»`).join(', ')}? Скажите номер.` };
  return { ask: `Голоса «${name}» нет. Есть: ${list.map((v) => `«${v.name}»`).join(', ')}.` };
}

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
        if (!m.ok) { void talk(`Запись не подошла: ${(m.reasons[0] ?? 'перечитайте текст').replace(/[.\s]+$/, '')}. Скажите «запиши заново» или «закрой».`); return; }
        if (v.name) { void talk(`Запись подходит. Сохраняю голос «${v.name}».`); send('save', { name: v.name }); return; }
        void talk('Запись подходит. Скажите: «сохрани как …» и имя голоса — или «прослушай пробу», «запиши заново».');
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
      void act('voices.delete', { name: String(st.current.voices.findIndex((x) => x.id === v.id) + 1) });
  };
  /** Голос по сказанному имени или номеру (или ответ, что спросить). */
  const find = (name: unknown) => voiceByName(String(name ?? ''), st.current.voices);
  const idle = () => (st.current.rec === 'rec' || st.current.rec === 'checking' ? 'сейчас идёт запись голоса' : true as const);

  useAction({
    id: 'voices.preview', section: 'global', title: 'Прослушать голос', describe: 'Проигрывает образец голоса (по имени или номеру в списке; «пробу» — проверенную запись).',
    params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, say: ['прослушай второй голос'], available: idle,
    run: async (p: { name: string }) => {
      if (/^проб/.test(String(p?.name ?? ''))) { if (st.current.rec === 'checked' && st.current.check?.ok) { listen(); return; } return 'Пробы пока нет — сначала запишите голос.'; }
      const r = find(p?.name);
      if ('ask' in r) return r.ask;
      listen({ voice_id: r.voice.id });
    },
  });
  useAction({
    id: 'voices.assign', section: 'global', title: 'Назначить голос', describe: 'Назначает голос роли: начальник штаба или посредник.',
    params: { type: 'object', properties: { name: { type: 'string' }, role: { enum: ROLES } }, required: ['name', 'role'] },
    say: ['назначь первый голос посреднику'], available: () => true,
    run: async (p: { name: string; role: VoiceRole }) => {
      const r = find(p?.name);
      if ('ask' in r) return r.ask;
      if (!ROLES.includes(p?.role)) return 'Кому назначить: начальнику штаба или посреднику?';
      send('assign', { role: p.role, voice_id: r.voice.id });
      return `«${r.voice.name}» — теперь ${ROLE_OF[p.role]}.`;
    },
  });
  useAction({
    id: 'voices.record', section: 'global', title: 'Записать новый голос', describe: 'Записывает новый голос с микрофона: текст зачитывается, запись идёт сама.',
    params: { type: 'object', properties: { name: { type: 'string' } } }, say: ['запиши новый голос'], available: idle,
    run: async (p?: { name?: string }) => {
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
    id: 'voices.save', section: 'global', title: 'Сохранить голос', describe: 'Сохраняет проверенную запись как новый голос с именем.',
    params: { type: 'object', properties: { name: { type: 'string' } } }, say: ['сохрани как Гость'],
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
    params: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, say: ['удали голос Гость'], irreversible: true,
    confirm: (p: { name: string }) => {
      const r = find(p?.name);
      return `Удалить голос «${'voice' in r ? r.voice.name : p?.name}»? Файлы образца будут стёрты с этого компьютера.`;
    },
    available: () => true,
    run: async (p: { name: string }) => {
      const r = find(p?.name);
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
      <div className="vp-dialog voices" role="dialog" aria-label="Голоса">
        <h3>Голоса</h3>
        <p className="vp-roles">
          {ROLES.map((r) => <span key={r}>{ROLE_NAME[r]} — <b>{voices.find((v) => v.id === roles[r])?.name ?? 'образец по умолчанию'}</b></span>)}
        </p>
        {error && <p className="vp-error" role="alert">{error}</p>}

        <ul className="vp-voices">
          {!voices.length && <li className="vp-note">Образцов пока нет — запишите новый голос.</li>}
          {voices.map((v) => {
            const has = ROLES.filter((r) => roles[r] === v.id);
            return (
              <li key={v.id} className="vp-voice">
                <div className="vp-vname">
                  <b>{v.name}</b> {v.builtin ? <span className="vp-tag">встроенный</span> : <span className="vp-tag">{v.source}</span>}
                  {has.map((r) => <span key={r} className="vp-tag role">{ROLE_OF[r]}</span>)}
                </div>
                <div className="vp-row left">
                  <button onClick={() => { void act('voices.preview', { name: String(voices.indexOf(v) + 1) }); }}>Прослушать</button>
                  <span className="vp-note">Назначить:</span>
                  {ROLES.map((r) => (
                    <button key={r} disabled={roles[r] === v.id} onClick={() => { void act('voices.assign', { name: String(voices.indexOf(v) + 1), role: r }); }}>{ROLE_NAME[r]}</button>
                  ))}
                  {!v.builtin && <button className="danger" onClick={() => { void remove(v); }}>Удалить</button>}
                </div>
              </li>
            );
          })}
        </ul>

        {rec === 'none' && (
          <div className="vp-row">
            <button onClick={() => { void act('voices.close'); }}>Закрыть</button>
            <button className="primary" onClick={() => setRec('intro')}>Записать новый голос</button>
          </div>
        )}
        {rec !== 'none' && (
          <section className="vp-record">
            <h4>Новый голос</h4>
            <p className="vp-warn">Голос будет использоваться системой, хранится только на этом компьютере.</p>
            <p>Прочитайте вслух спокойно, обычным голосом — это займёт 15–20 секунд:</p>
            <p className="vp-say">{text || 'Текст для чтения придёт от голосового сервиса.'}</p>
            {rec === 'intro' && (
              <div className="vp-row">
                <button onClick={discard}>Отмена</button>
                <button className="primary" onClick={start}>Начать запись</button>
              </div>
            )}
            {rec === 'rec' && (
              <div className="vp-row">
                <span className="vp-recdot">Идёт запись: {secs} с</span>
                <button className="primary" onClick={stop}>Закончить запись</button>
              </div>
            )}
            {rec === 'checking' && <p className="vp-note">Проверяю запись…</p>}
            {rec === 'failed' && (
              <div className="vp-row">
                <button onClick={discard}>Отмена</button>
                <button className="primary" onClick={start}>Записать заново</button>
              </div>
            )}
            {rec === 'checked' && check && (
              <div className="vp-check">
                {check.ok ? (
                  <>
                    <p className="vp-good">Запись подходит{check.audio_s ? ` (${check.audio_s.toFixed(1)} с)` : ''}.</p>
                    <div className="vp-row left">
                      <button onClick={() => listen()}>Прослушать пробу</button>
                    </div>
                    <label className="vp-name">Имя голоса
                      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="например, Гость" />
                    </label>
                    <div className="vp-row">
                      <button onClick={discard}>Не сохранять</button>
                      <button onClick={start}>Записать заново</button>
                      <button className="primary" disabled={!name.trim()} onClick={() => send('save', { name: name.trim() })}>Сохранить</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="vp-bad">Перечитайте текст:</p>
                    <ul>{check.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    <div className="vp-row">
                      <button onClick={discard}>Отмена</button>
                      <button className="primary" onClick={start}>Записать заново</button>
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
