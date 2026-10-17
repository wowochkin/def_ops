/**
 * Калибровка — четыре шага стенда (scripts/voice-bench/talk.html): тишина, ваш голос, голос штаба через динамики,
 * перебивание. Сервис копит уверенность речи на каждом шаге и сам считает регуляторы (`calib finish`).
 */
import { useEffect, useRef, useState } from 'react';
import type { VoiceClient } from './client';
import type { CalibStep, ServerMsg, VoiceSettings } from './protocol';

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

export function Calibration({ client, onClose, onResult, setBusy }: {
  client: VoiceClient;
  onClose(): void;
  onResult(cfg: VoiceSettings): void;
  setBusy(s: string | null): void;
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

  const fail = (why: string) => {
    setErr(why.replace(/[.\s]+$/, ''));
    setPhase('wait');
    client.stopPlayback();
  };

  useEffect(() => {
    setBusy('Калибровка');
    const offs = [
      client.on('calib_rec', (m) => { setSec(m.sec); setPhase('rec'); }),
      client.on('calib_step', () => {
        if (iRef.current < STEPS.length - 1) { setI(iRef.current + 1); setPhase('wait'); }
        else { setPhase('count'); client.calib('finish'); }
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
        setI(0);
        setRestart('Связь с голосом прервалась, и прежние шаги потерялись — начнём калибровку сначала.');
      }),
      client.on('calib_result', (m) => {
        setResult(m);
        setPhase('wait');
        if (m.cfg) onResultRef.current(m.cfg);
      }),
    ];
    // окно закрыто как угодно (кнопка, выключение голоса): шаг отменён, звук калибровки погашен — и не зазвучит позже
    return () => { offs.forEach((o) => o()); client.calib('cancel'); setBusy(null); };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = () => {
    const s = STEPS[i];
    setErr(null);
    setRestart(null);
    setPhase(s.sec ? 'rec' : 'prep');
    setSec(s.sec ?? 0);
    client.calib(s.step, s.sec ?? 0);
  };
  const cancel = () => {
    client.calib('cancel');
    client.stopPlayback();
    onClose();
  };
  const again = () => { setResult(null); setErr(null); setRestart(null); setI(0); setPhase('wait'); };

  const s = STEPS[i];
  return (
    <div className="vp-back" onClick={(e) => { if (e.target === e.currentTarget && !result) cancel(); }}>
      <div className="vp-dialog calib" role="dialog" aria-label="Калибровка">
        {!result ? (
          <>
            <div className="vp-stepn">Калибровка · шаг {i + 1} из {STEPS.length}</div>
            <h3>{s.title}</h3>
            <p>{s.txt}</p>
            {s.say && <p className="vp-say">{s.say}</p>}
            {restart && <p className="vp-error" role="alert">{restart}</p>}
            {err && <p className="vp-error" role="alert">Этот шаг не записался: {err}. Попробуйте ещё раз.</p>}
            <div className="vp-prog">
              <i key={`${i}-${phase}`} className={phase === 'rec' ? 'run' : ''} style={phase === 'rec' ? { animationDuration: `${sec}s` } : undefined} />
            </div>
            <div className="vp-row">
              <button onClick={cancel}>Отмена</button>
              {err && i > 0 && <button onClick={again}>Заново</button>}
              <button className="primary" onClick={go} disabled={phase !== 'wait' || !up}>
                {phase === 'wait' ? 'Записать' : phase === 'prep' ? 'Готовлю голос штаба…' : phase === 'count' ? 'Считаю…' : 'Записываю…'}
              </button>
            </div>
          </>
        ) : result.error || !result.cfg ? (
          <>
            <div className="vp-stepn">Калибровка</div>
            <h3>Не получилось</h3>
            <p>{result.error ?? 'Сервис не прислал результат.'}</p>
            <div className="vp-row">
              <button onClick={onClose}>Закрыть</button>
              <button className="primary" onClick={again}>Заново</button>
            </div>
          </>
        ) : (
          <>
            <div className="vp-stepn">Калибровка</div>
            <h3>Регуляторы выставлены</h3>
            <p>
              Чувствительность в тишине — {pct(1 - result.cfg.vad)}, когда говорит штаб — {pct(1 - result.cfg.barge_vad)};
              перебить штаб можно, говоря дольше {result.cfg.barge_ms} мс. Значения запомнены; их можно подправить
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
              <button onClick={again}>Заново</button>
              <button className="primary" onClick={onClose}>Готово</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
