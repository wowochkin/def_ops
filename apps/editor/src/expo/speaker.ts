/**
 * Чем говорит стенд: только голосовой сервис системы (голос начальника штаба, `VoiceClient`), пока он на связи;
 * иначе молча — фраза «звучит» столько, сколько её читать, текст на экране. Синтез речи окна не берём:
 * чужой голос на стенде хуже тишины с субтитрами.
 */
import { VoiceClient } from '../voice/client';
import { speakable } from '../voice/speech';
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

export function expoSpeaker(): { speaker: Speaker; resume(): void; dispose(): void } {
  const client = new VoiceClient();
  void client.refreshApi();
  client.connect();
  const fallback = silentSpeaker();
  const waits = new Map<number, () => void>();
  const off = client.onPlayed((id) => { waits.get(id)?.(); waits.delete(id); });
  return {
    speaker: {
      speak(text) {
        if (client.status !== 'ready') return fallback.speak(text);
        const said = speakable(text, { full: true });
        const id = client.newSayId();
        let finish = () => {};
        const done = new Promise<void>((r) => {
          finish = r;
          waits.set(id, r);
          // сервис не доложил о конце — очередь не встаёт
          setTimeout(r, readMs(said) * 2 + 5000);
        });
        client.say(id, 'chief', said);
        return { done, stop: () => { client.stop(id); waits.delete(id); finish(); } };
      },
    },
    resume: () => client.resume(),
    dispose: () => { off(); client.close(); },
  };
}
