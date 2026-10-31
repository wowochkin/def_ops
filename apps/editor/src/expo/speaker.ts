/**
 * Чем говорит стенд: голосовой сервис системы (голос начальника штаба, `VoiceClient`), пока он на связи; иначе синтез
 * речи окна; нет и его — молча (фраза «звучит» столько, сколько её читать, текст — на экране).
 */
import { VoiceClient } from '../voice/client';
import type { Speaker } from './voice-queue';

/** Сколько читать фразу вслух, мс. */
export const readMs = (text: string) => 1500 + text.length * 65;

export function silentSpeaker(): Speaker {
  return {
    speak(text) {
      let t: ReturnType<typeof setTimeout>;
      let finish = () => {};
      const done = new Promise<void>((r) => { finish = r; t = setTimeout(r, readMs(text)); });
      return { done, stop: () => { clearTimeout(t); finish(); } };
    },
  };
}

function windowSpeaker(): Speaker | null {
  const ss = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!ss) return null;
  return {
    speak(text) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU';
      const ru = ss.getVoices().find((v) => v.lang.toLowerCase().startsWith('ru'));
      if (ru) u.voice = ru;
      let finish = () => {};
      const done = new Promise<void>((r) => {
        finish = r;
        u.onend = () => r();
        u.onerror = () => r();
        setTimeout(r, readMs(text) * 2);
      });
      ss.speak(u);
      return { done, stop: () => { ss.cancel(); finish(); } };
    },
  };
}

export function expoSpeaker(): { speaker: Speaker; resume(): void; dispose(): void } {
  const client = new VoiceClient();
  void client.refreshApi();
  client.connect();
  const fallback = windowSpeaker() ?? silentSpeaker();
  const waits = new Map<number, () => void>();
  const off = client.onPlayed((id) => { waits.get(id)?.(); waits.delete(id); });
  return {
    speaker: {
      speak(text) {
        if (client.status !== 'ready') return fallback.speak(text);
        const id = client.newSayId();
        let finish = () => {};
        const done = new Promise<void>((r) => {
          finish = r;
          waits.set(id, r);
          // сервис не доложил о конце — очередь не встаёт
          setTimeout(r, readMs(text) * 2 + 5000);
        });
        client.say(id, 'chief', text);
        return { done, stop: () => { client.stop(id); waits.delete(id); finish(); } };
      },
    },
    resume: () => client.resume(),
    dispose: () => { off(); client.close(); },
  };
}
