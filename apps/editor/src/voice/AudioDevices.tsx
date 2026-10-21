/**
 * Выбор устройств звука: микрофон и вывод. Микрофон — всегда («Как в системе» и найденные устройства); вывод — только
 * если окно умеет его выбирать (иначе звук идёт на системное устройство вывода — «Системные настройки → Звук»).
 * Подключили устройство (веб-камеру) — список обновляется, микрофон «как в системе» переоткрывается сам.
 */
import { useEffect, useState } from 'react';
import type { VoiceClient } from './client';
import type { AudioDevice } from './audio-devices';

interface State { inputs: AudioDevice[]; outputs: AudioDevice[]; mic: string; out: string; outSupported: boolean; note?: string }

export function AudioDevices({ client }: { client: VoiceClient }) {
  const [s, setS] = useState<State | null>(null);
  useEffect(() => {
    let live = true;
    void client.devices().then((d) => { if (live) setS(d); });
    const off = client.onDevices((d) => { if (live) setS((p) => ({ ...d, note: d.note ?? p?.note })); });
    return () => { live = false; off(); };
  }, [client]);
  if (!s) return null;
  return (
    <div className="vp-devices" data-tour="voice-devices">
      <label>Микрофон
        <select value={s.mic} onChange={(e) => { void client.setMic(e.target.value); }}>
          <option value="">Как в системе</option>
          {s.inputs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      {s.outSupported && s.outputs.length > 0
        ? <label>Вывод звука
            <select value={s.out} onChange={(e) => { void client.setOut(e.target.value); }}>
              <option value="">Как в системе</option>
              {s.outputs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
        : <p className="vp-note">Звук идёт на устройство вывода, выбранное в системе (Системные настройки → Звук).</p>}
      {s.note && <p className="vp-hint" role="status">{s.note}</p>}
    </div>
  );
}
