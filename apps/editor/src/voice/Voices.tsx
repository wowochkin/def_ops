/**
 * Голоса: образцы с ролями (начальник штаба, посредник), прослушать, назначить роль, удалить;
 * запись нового голоса с микрофона — предупреждение, текст для чтения, запись, проверка с причинами,
 * проба новым голосом, сохранение с именем. Закрыли без сохранения — сервис стирает запись (`discard`).
 */
import { useEffect, useRef, useState } from 'react';
import { confirmAsync } from '../dialogs';
import type { VoiceClient } from './client';
import type { VoiceCheck, VoiceInfo, VoiceRole, VoiceRoles } from './protocol';
import type { VoiceReady } from './VoicePanel';

const ROLE_NAME: Record<VoiceRole, string> = { chief: 'Начальник штаба', umpire: 'Посредник' };
const ROLE_OF: Record<VoiceRole, string> = { chief: 'голос начальника штаба', umpire: 'голос посредника' };
const ROLES = Object.keys(ROLE_NAME) as VoiceRole[];

/** failed — сбой во время записи или проверки: причина вверху окна, кнопки «Отмена» и «Записать заново». */
type Rec = 'none' | 'intro' | 'rec' | 'checking' | 'checked' | 'failed';

export function Voices({ client, ready, onClose, setBusy, previewId }: {
  client: VoiceClient;
  ready: VoiceReady | null;
  onClose(): void;
  setBusy(s: string | null): void;
  /** новый номер фразы для пробы (панель не считает пробу ответом штаба) */
  previewId(): number;
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

  useEffect(() => {
    const offs = [
      client.on('voice_list', (m) => { setVoices(m.voices); setRoles(m.roles); }),
      client.on('voice_recording', (m) => { setText(m.text); setRec('rec'); setSecs(0); }),
      client.on('voice_check', (m) => { setCheck(m); setRec('checked'); }),
      client.on('voice_saved', () => { unsaved.current = false; setRec('none'); setCheck(null); setName(''); }),
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
      offs.forEach((o) => o());
      if (unsaved.current) client.voice('discard');
      setBusy(null);
    };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setBusy(rec === 'rec' ? 'Запись голоса' : null); }, [rec]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (rec !== 'rec') return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [rec]);

  const send = (op: string, args: Record<string, unknown> = {}) => { setError(null); client.voice(op, args); };
  const start = () => { unsaved.current = true; setCheck(null); send('record-start'); };
  const stop = () => { setRec('checking'); send('record-stop'); };
  const discard = () => {
    if (unsaved.current) client.voice('discard');
    unsaved.current = false;
    setRec('none'); setCheck(null); setName('');
  };
  const remove = async (v: VoiceInfo) => {
    if (await confirmAsync(`Удалить голос «${v.name}»? Файлы образца будут стёрты с этого компьютера.`, { ok: 'Удалить', danger: true }))
      send('delete', { voice_id: v.id });
  };

  return (
    <div className="vp-back" onClick={(e) => { if (e.target === e.currentTarget && rec !== 'rec') onClose(); }}>
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
                  <button onClick={() => send('preview', { id: previewId(), voice_id: v.id })}>Прослушать</button>
                  <span className="vp-note">Назначить:</span>
                  {ROLES.map((r) => (
                    <button key={r} disabled={roles[r] === v.id} onClick={() => send('assign', { role: r, voice_id: v.id })}>{ROLE_NAME[r]}</button>
                  ))}
                  {!v.builtin && <button className="danger" onClick={() => { void remove(v); }}>Удалить</button>}
                </div>
              </li>
            );
          })}
        </ul>

        {rec === 'none' && (
          <div className="vp-row">
            <button onClick={onClose}>Закрыть</button>
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
                      <button onClick={() => send('preview', { id: previewId() })}>Прослушать пробу</button>
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
