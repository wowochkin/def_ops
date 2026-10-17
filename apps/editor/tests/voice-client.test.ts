/** VoiceClient без браузера: разбор сообщений сервиса (звук и связь подменены). */
import { describe, expect, it } from 'vitest';
import { VoiceClient } from '../src/voice/client';

/** Клиент с «открытой» связью: что он шлёт сервису — в sent. */
function mk() {
  const c = new VoiceClient();
  const sent: unknown[] = [];
  const x = c as unknown as Record<string, any>;
  x.ws = { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) };
  x.wsState = 'open';
  return { c, x, sent, msg: (m: unknown) => x.onMessage(m) };
}

describe('VoiceClient', () => {
  it('ошибка сервиса до ready (модели не загрузились) — состояние error с причиной', () => {
    const { c, msg } = mk();
    expect(c.status).toBe('connecting');
    msg({ type: 'error', text: 'модели не загрузились: OSError: нет места' });
    expect(c.status).toBe('error');
    expect(c.errorText).toBe('модели не загрузились: OSError: нет места');
    msg({ type: 'ready', voices: [], roles: { chief: 'a', umpire: 'a' }, loaded: true });
    expect(c.status).toBe('ready');
    expect(c.errorText).toBeNull();
    // ошибка отдельного действия после ready — не «голос не запустился»
    msg({ type: 'error', text: 'нет такой роли' });
    expect(c.status).toBe('ready');
  });

  it('say-done stopped (остановил сервис) — звук фразы гасится, played не шлётся', () => {
    const { x, sent, msg } = mk();
    let stopped = 0;
    const src = { onended: null as null | (() => void), stop: () => { stopped++; } };
    x.sources = [{ src, id: 5 }];
    x.phrases.set(5, { done: true });
    const played: number[] = [];
    x.playedCbs.add((id: number) => played.push(id));
    msg({ type: 'say-done', id: 5, stopped: true });
    expect(stopped).toBe(1);
    expect(x.sources).toEqual([]);
    expect(sent).toEqual([]);
    expect(played).toEqual([]);
  });
});
