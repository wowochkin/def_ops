// Штаб противника после хода ждёт доклада посредника голосом (umpire-done), но не дольше предела; новый ход, смена
// режима противника и «повтори запрос» снимают ожидание сразу.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiHold, UMPIRE_HOLD_MS } from '../src/sim/ai-hold';

afterEach(() => { vi.useRealTimers(); });

describe('удержание штаба противника до доклада посредника', () => {
  it('держит до umpire-done — запускает один раз', () => {
    const start = vi.fn();
    const h = aiHold(start);
    h.hold();
    expect(start).not.toHaveBeenCalled();
    expect(h.held()).toBe(true);
    h.release();
    expect(start).toHaveBeenCalledTimes(1);
    h.release(); // поздний второй сигнал — ничего
    expect(start).toHaveBeenCalledTimes(1);
  });
  it('доклада нет дольше предела — запускает сам', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const h = aiHold(start);
    h.hold();
    vi.advanceTimersByTime(UMPIRE_HOLD_MS - 1);
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(start).toHaveBeenCalledTimes(1);
    expect(h.held()).toBe(false);
  });
  it('новый ход — release (запуск сейчас); смена режима, «повтори запрос» — drop (запускает вызывающий) и предел не сработает', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const h = aiHold(start);
    h.hold();
    h.drop();
    expect(h.held()).toBe(false);
    vi.advanceTimersByTime(UMPIRE_HOLD_MS * 2);
    expect(start).not.toHaveBeenCalled();
    h.release();
    expect(start).not.toHaveBeenCalled();
  });
  it('без удержания release ничего не запускает (ход без доклада)', () => {
    const start = vi.fn();
    aiHold(start).release();
    expect(start).not.toHaveBeenCalled();
  });
});
