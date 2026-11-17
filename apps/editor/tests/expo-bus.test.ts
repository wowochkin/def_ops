import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { expoBus, type BusMsg } from '../src/expo/bus';
import { initialState, type Phase } from '../src/expo/director';
import { EXPO_DEFAULTS } from '../src/expo/settings';

type Envelope = { from: string; seq: number; m: BusMsg };
const native = vi.hoisted(() => ({
  listen: vi.fn<(event: string, handler: (e: { payload: Envelope }) => void) => Promise<() => void>>(),
  emit: vi.fn<(event: string, envelope: Envelope) => Promise<void>>(),
}));
vi.mock('@tauri-apps/api/event', () => native);

const state = (phase: Phase): BusMsg => ({
  k: 'state', state: { ...initialState(0), phase }, settings: EXPO_DEFAULTS, count: 3,
});

beforeEach(() => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  native.listen.mockResolvedValue(() => {});
  native.emit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('боковой экран игнорирует заставку, доставленную позже кадра текущего сеанса', async () => {
  const bus = expoBus();
  const receive = vi.fn<(m: BusMsg) => void>();
  bus.on(receive);
  try {
    await vi.waitFor(() => expect(native.listen).toHaveBeenCalledOnce());
    const onEvent = native.listen.mock.calls[0][1];
    const briefing = state({ kind: 'briefing', point: 0 });
    const attract = state({ kind: 'attract' });
    const result = state({ kind: 'result' });
    onEvent({ payload: { from: 'host', seq: 8, m: briefing } });
    onEvent({ payload: { from: 'host', seq: 7, m: attract } });
    onEvent({ payload: { from: 'host', seq: 8, m: briefing } });
    onEvent({ payload: { from: 'host', seq: 9, m: result } });
    expect(receive.mock.calls).toEqual([[briefing], [result]]);
  } finally { bus.close(); }
});

it('первый запрос кадра отправляется после регистрации слушателя', async () => {
  let registered!: () => void;
  native.listen.mockReturnValue(new Promise(resolve => { registered = () => resolve(() => {}); }));
  const bus = expoBus();
  try {
    bus.send({ k: 'hello', window: 2 });
    await vi.waitFor(() => expect(native.listen).toHaveBeenCalledOnce());
    expect(native.emit).not.toHaveBeenCalled();
    registered();
    await vi.waitFor(() => expect(native.emit).toHaveBeenCalledOnce());
    expect(native.emit.mock.calls[0][1]).toMatchObject({ seq: 1, m: { k: 'hello', window: 2 } });
  } finally { bus.close(); }
});
