/**
 * Калибровка — четыре шага стенда (scripts/voice-bench/talk.html): тишина, ваш голос, голос штаба через динамики,
 * перебивание. Сервис копит уверенность речи на каждом шаге и сам считает регуляторы (`calib finish`).
 *
 * Голосом («Штаб, калибровка» — окно открыто голосом, auto): штаб говорит, что будет, и шаги идут сами — шаг тишины
 * начинается, когда человек замолчал; по итогу штаб говорит результат, дальше «готово» / «заново» / «закрой».
 * Действия окна — в реестре (`voice.calibrate.start | done | again | close`); кнопки вызывают их же. Пока шаги идут,
 * сервис фраз штаба не произносит (испортили бы замер) — всё нужное написано в окне крупно.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { VoiceClient } from './client';
import type { CalibStep, ServerMsg, VoiceSettings } from './protocol';
import { act, openModal, useAction } from './registry';

/** Ответы окна калибровки голосом (реплика без обращения) → действие окна. */
export function calibParse(rest: string): { id: string } | null {
  if (/^(?:начать|начинай|начни|начинаем|поехали|записывай|запиши)$/.test(rest)) return { id: 'voice.calibrate.start' };
  if (/^(?:готово|понятно|хорошо|да)$/.test(rest)) return { id: 'voice.calibrate.done' };
  if (/^(?:заново|еще раз|снова|повтори калибровку|сначала)$/.test(rest)) return { id: 'voice.calibrate.again' };
  if (/^(?:закрой|закрыть|отмена|отменить|выйди|нет)(?: окно| калибровку)?$/.test(rest)) return { id: 'voice.calibrate.close' };
  return null;
}

const INTRO = 'Калибровка: четыре шага, они пойдут сами, а подсказка будет крупно на экране. Сначала помолчите, потом прочитайте '
  + 'вслух текст с экрана, потом молчите, пока я говорю, и в конце перебейте меня — говорите громко, пока я говорю.';
/** Итог калибровки словами — кончается не словом-ответом (быстрое «готово» сервис иначе принял бы за эхо). */
export const CALIB_DONE_SAY = 'Калибровка закончена, регуляторы выставлены. Скажите «готово» или «заново». Жду ответа.';
export const CALIB_FAIL_SAY = (why: string) => `Калибровка не получилась: ${why.replace(/[.\s]+$/, '')}. Скажите «заново» или «закрой». Жду ответа.`;
const HINT_MANUAL = 'Калибровка. Нажимайте «Записать» на каждом шаге — или скажите «начать», и шаги пойдут сами.';
/** Пауза перед шагом, когда шаги идут сами (чтобы прочитать подсказку; на шаге «Ваш голос» — и найти текст глазами). */
const PAUSE_MS: Record<CalibStep, number> = { noise: 0, speech: 2500, echo: 800, over: 800, finish: 0, cancel: 0 };
/** Сигнал шага «Ваш голос»: высокий — «читайте», низкий — «хватит» (между шагами сервис фраз штаба не произносит). */
const BEEP_GO = 880, BEEP_END = 520, BEEP_MS = 220;
let beepCtx: AudioContext | null = null;
/** Короткий тон, сыгранный окном (без сервиса); промис — когда отзвучал. */
function beep(freq: number): Promise<void> {
  try {
    beepCtx ??= new AudioContext();
    const c = beepCtx;
    void c.resume();
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = freq;
    const t0 = c.currentTime;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
    g.gain.linearRampToValueAtTime(0, t0 + BEEP_MS / 1000);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + BEEP_MS / 1000 + 0.02);
  } catch { /* звука нет — шаг всё равно идёт, подсказка на экране */ }
  return new Promise((r) => setTimeout(r, BEEP_MS + 300));
}
/** Шаг тишины — когда человек замолчал: тихо столько после речи, или столько тихо вообще, или ждали уже столько. */
const QUIET_AFTER_MS = 300, QUIET_LONG_MS = 4500, QUIET_MAX_MS = 15000, QUIET_P = 0.3;
const STEPS: { step: CalibStep; sec?: number; title: string; txt: string; say?: string }[] = [
  { step: 'noise', sec: 3, title: 'Тишина', txt: 'Помолчите 3 секунды — запишем, как звучит комната.' },
  { step: 'speech', sec: 6, title: 'Ваш голос', txt: 'Прочитайте вслух обычным голосом, как будете говорить со штабом:',
    say: 'Штаб, доложите обстановку на участке восьмой гвардейской армии и что нужно для прорыва второй полосы.' },
  { step: 'echo', title: 'Голос штаба', txt: 'Начальник штаба произнесёт фразу через динамики — молчите, пока он говорит. Так узнаем, насколько его слышит микрофон.' },
  { step: 'over', title: 'Перебивание', txt: 'Начальник штаба снова заговорит — перебейте его: говорите громко всё время, пока он звучит, например:',
    say: 'Стоп, стоп, подождите. Доложите сначала о потерях за сутки.' },
];

type Result = Extract<ServerMsg, { type: 'calib_result' }>;
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function Calibration({ client, onClose, onResult, setBusy, auto = false, say, meter }: {
  client: VoiceClient;
  /** полоса «слышу вас / перебиваете» (из панели): видно, слышит ли штаб, пока идут шаги */
  meter?: ReactNode;
  onClose(): void;
  onResult(cfg: VoiceSettings): void;
  setBusy(s: string | null): void;
  /** открыто голосом: шаги идут сами */
  auto?: boolean;
  /** фраза штаба; промис — когда договорил (или фразу сняли) */
  say?(text: string): Promise<void>;
}) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'wait' | 'prep' | 'rec' | 'count'>('wait');
  const [sec, setSec] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [restart, setRestart] = useState<string | null>(null);
  const [up, setUp] = useState(client.status === 'ready');
  const iRef = useRef(i);
  iRef.current = i;
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [running, setRunning] = useState(false);  // шаги идут сами
  const runRef = useRef(false);
  runRef.current = running;
  const alive = useRef(true);
  const timers = useRef<(() => void)[]>([]);
  const later = (f: () => void, ms: number) => { const t = setTimeout(f, ms); timers.current.push(() => clearTimeout(t)); };
  const unwait = () => { timers.current.forEach((f) => f()); timers.current = []; };
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const resultRef = useRef(result);
  resultRef.current = result;
  const errRef = useRef(err);
  errRef.current = err;
  const sayRef = useRef(say);
  sayRef.current = say;

  const fail = (why: string) => {
    setErr(why.replace(/[.\s]+$/, ''));
    setPhase('wait');
    client.stopPlayback();
    // шаги шли сами — остановиться и сказать, что делать (калибровка снята: иначе сервис не даст штабу говорить)
    if (runRef.current) {
      unwait();
      setRunning(false);
      client.calib('cancel');
      iRef.current = 0;
      setI(0);
      void sayRef.current?.(`Шаг не записался${why ? `: ${why.replace(/[.\s]+$/, '')}` : ''}. Скажите «заново» или «закрой». Жду ответа.`);
    }
  };

  /** Записать текущий шаг. */
  const go = () => {
    const s = STEPS[iRef.current];
    setErr(null);
    setRestart(null);
    setPhase(s.sec ? 'rec' : 'prep');
    setSec(s.sec ?? 0);
    client.calib(s.step, s.sec ?? 0);
  };
  /** Шаги сами: шаг тишины — когда человек замолчал, остальные — после короткой паузы. */
  const runStep = () => {
    if (!alive.current || !runRef.current) return;
    const s = STEPS[iRef.current];
    if (s.step === 'speech') {
      // «Ваш голос»: подсказка крупно, пауза, сигнал — и запись; после записи — второй сигнал
      later(() => { if (runRef.current) void beep(BEEP_GO).then(() => { if (runRef.current && alive.current) go(); }); }, PAUSE_MS.speech);
      return;
    }
    if (s.step !== 'noise') { later(() => { if (runRef.current) go(); }, PAUSE_MS[s.step]); return; }
    const t0 = Date.now();
    let loud = false, quietSince = t0;
    const off = client.on('level', (m) => {
      const now = Date.now();
      if (m.p >= QUIET_P) { loud = true; quietSince = now; return; }
      if ((loud && now - quietSince >= QUIET_AFTER_MS) || now - quietSince >= QUIET_LONG_MS || now - t0 >= QUIET_MAX_MS) start();
    });
    const cap = setTimeout(() => start(), QUIET_MAX_MS);
    let done = false;
    function start() {
      if (done) return;
      done = true;
      off();
      clearTimeout(cap);
      if (runRef.current && alive.current) go();
    }
    timers.current.push(() => { done = true; off(); clearTimeout(cap); });
  };
  /** Калибровку ведут голосом (открыта голосом или «начать»): «заново» — тоже сами. */
  const byVoice = useRef(auto);
  const startRun = () => {
    byVoice.current = true;
    runRef.current = true;
    setRunning(true);
    runStep();
  };

  useEffect(() => {
    setBusy('Калибровка');
    const offs = [
      client.on('calib_rec', (m) => { setSec(m.sec); setPhase('rec'); }),
      client.on('calib_step', () => {
        if (runRef.current && STEPS[iRef.current].step === 'speech') void beep(BEEP_END);
        if (iRef.current < STEPS.length - 1) {
          iRef.current += 1;
          setI(iRef.current);
          setPhase('wait');
          if (runRef.current) runStep();
        } else { setPhase('count'); client.calib('finish'); }
      }),
      // сбой сервиса посреди шага: шаг не записан — показать причину и вернуть кнопку
      client.on('error', (m) => { fail(m.text); }),
      // связь оборвалась: замеры прежних шагов были только у голоса и пропали — на первом шаге просто повторить,
      // дальше — калибровка с первого шага (иначе в конце «нет шага»)
      client.onStatus((st) => {
        setUp(st === 'ready');
        if (st === 'ready') return;
        if (iRef.current === 0) { fail('связь с голосом прервалась'); return; }
        fail('');
        setErr(null);
        iRef.current = 0;
        setI(0);
        setRestart('Связь с голосом прервалась, и прежние шаги потерялись — начнём калибровку сначала.');
      }),
      client.on('calib_result', (m) => {
        setResult(m);
        setPhase('wait');
        if (m.cfg) onResultRef.current(m.cfg);
        // калибровка закончена — сервис снова даёт штабу говорить: итог словами
        void sayRef.current?.(m.error || !m.cfg ? CALIB_FAIL_SAY(m.error ?? 'сервис не прислал результат') : CALIB_DONE_SAY);
        setRunning(false);
      }),
    ];
    // голосом: что будет, и шаги — сами, когда штаб договорил; иначе — короткая подсказка
    if (auto) void (sayRef.current?.(INTRO) ?? Promise.resolve()).then(() => { if (alive.current && !resultRef.current) startRun(); });
    else void sayRef.current?.(HINT_MANUAL);
    // окно закрыто как угодно (кнопка, выключение голоса): шаг отменён, звук калибровки погашен — и не зазвучит позже
    return () => { alive.current = false; unwait(); offs.forEach((o) => o()); client.calib('cancel'); setBusy(null); };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  // окно ждёт ответа: голосом — только его действия (и стоп-слова, «отбой», «повтори»)
  useEffect(() => openModal({
    get question() {
      return resultRef.current ? 'Калибровка закончена. Скажите «готово», «заново» или «закрой».'
        : 'Идёт калибровка. Скажите «начать», «заново» или «закрой».';
    },
    read: auto ? INTRO : HINT_MANUAL,
    quiet: true,
    parse: calibParse,
    isAnswer: (rest) => calibParse(rest) !== null,
  }), []);

  const cancel = () => {
    unwait();
    client.calib('cancel');
    client.stopPlayback();
    onClose();
  };
  const again = () => {
    unwait();
    setResult(null); setErr(null); setRestart(null); iRef.current = 0; setI(0); setPhase('wait');
    if (runRef.current) client.calib('cancel');
  };

  // действия окна — голосом и кнопками
  useAction({
    id: 'voice.calibrate.start', section: 'global', title: 'Начать калибровку', describe: 'Начинает шаги калибровки: дальше они идут сами.',
    say: ['начать'], params: { type: 'object', properties: { one: { type: 'boolean' } } },
    available: () => (resultRef.current ? 'калибровка уже закончена — скажите «заново»' : phaseRef.current !== 'wait' || runRef.current ? 'шаг уже идёт' : !up ? 'голос не на связи' : true),
    run: async (p?: { one?: boolean }) => { if (p?.one) go(); else startRun(); },
  });
  useAction({
    id: 'voice.calibrate.done', section: 'global', title: 'Готово', describe: 'Закрывает окно калибровки после итога.', say: ['готово'],
    available: () => (resultRef.current ? true : 'калибровка ещё идёт'),
    run: async () => { onClose(); },
  });
  useAction({
    id: 'voice.calibrate.again', section: 'global', title: 'Калибровать заново', describe: 'Начинает калибровку с первого шага.', say: ['заново'],
    available: () => (resultRef.current || errRef.current || !runRef.current ? true : 'калибровка ещё идёт'),
    run: async () => { again(); if (byVoice.current) { setRunning(false); runRef.current = false; later(startRun, 300); } },
  });
  useAction({
    id: 'voice.calibrate.close', section: 'global', title: 'Закрыть калибровку', describe: 'Закрывает окно калибровки.', say: ['закрой'],
    available: () => true,
    run: async () => { cancel(); },
  });

  const s = STEPS[i];
  return (
    <div className="vp-back" onClick={(e) => { if (e.target === e.currentTarget && !result) void act('voice.calibrate.close'); }}>
      <div className="vp-dialog calib" role="dialog" aria-label="Калибровка">
        {!result ? (
          <>
            <div className="vp-stepn">Калибровка · шаг {i + 1} из {STEPS.length}</div>
            <h3>{s.title}</h3>
            <p>{s.txt}</p>
            {meter}
            {s.say && <p className="vp-say">{s.say}</p>}
            {restart && <p className="vp-error" role="alert">{restart}</p>}
            {err && <p className="vp-error" role="alert">Этот шаг не записался: {err}. Попробуйте ещё раз.</p>}
            {running && s.step === 'speech' && (
              <p className="vp-hint big">{phase === 'rec' ? 'Читайте вслух текст ниже — сейчас!' : 'После сигнала читайте вслух текст ниже.'}</p>
            )}
            {running && s.step !== 'speech' && <p className="vp-hint">Шаги идут сами{phase === 'wait' && s.step === 'noise' ? ' — помолчите' : ''}.</p>}
            <div className="vp-prog">
              <i key={`${i}-${phase}`} className={phase === 'rec' ? 'run' : ''} style={phase === 'rec' ? { animationDuration: `${sec}s` } : undefined} />
            </div>
            <div className="vp-row">
              <button onClick={() => { void act('voice.calibrate.close'); }}>Отмена</button>
              {err && i > 0 && <button onClick={() => { void act('voice.calibrate.again'); }}>Заново</button>}
              <button className="primary" onClick={() => { void act('voice.calibrate.start', { one: true }); }} disabled={phase !== 'wait' || !up || running}>
                {running && phase === 'wait' ? 'Сейчас начну…' : phase === 'wait' ? 'Записать' : phase === 'prep' ? 'Готовлю голос штаба…' : phase === 'count' ? 'Считаю…' : 'Записываю…'}
              </button>
            </div>
          </>
        ) : result.error || !result.cfg ? (
          <>
            <div className="vp-stepn">Калибровка</div>
            <h3>Не получилось</h3>
            <p>{result.error ?? 'Сервис не прислал результат.'}</p>
            <div className="vp-row">
              <button onClick={() => { void act('voice.calibrate.close'); }}>Закрыть</button>
              <button className="primary" onClick={() => { void act('voice.calibrate.again'); }}>Заново</button>
            </div>
          </>
        ) : (
          <>
            <div className="vp-stepn">Калибровка</div>
            <h3>Регуляторы выставлены</h3>
            <p>
              Чувствительность в тишине — {pct(1 - result.cfg.vad)}, когда говорит штаб — {pct(1 - result.cfg.barge_vad)};
              {result.cfg.barge_mode === 'word'
                ? ' перебить штаб — словом: скажите «Стоп» или «Штаб…».'
                : ` перебить штаб можно, говоря дольше ${result.cfg.barge_ms} мс.`} Значения запомнены; их можно подправить
              в «Тонкой настройке».
            </p>
            {(result.warn ?? []).map((w) => <p key={w} className="vp-warn">{w}</p>)}
            {result.stats && (
              <details className="vp-stats">
                <summary>Замеры</summary>
                <p className="vp-note">Насколько уверенно слышна речь, от 0 до 1; всплеск — самое долгое срабатывание на голос штаба.</p>
                <table><tbody>
                  {Object.entries(result.stats).map(([k, v]) => <tr key={k}><td>{k}</td><td><b>{v ?? '—'}</b></td></tr>)}
                </tbody></table>
              </details>
            )}
            <div className="vp-row">
              <button onClick={() => { void act('voice.calibrate.again'); }}>Заново</button>
              <button className="primary" onClick={() => { void act('voice.calibrate.done'); }}>Готово</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
