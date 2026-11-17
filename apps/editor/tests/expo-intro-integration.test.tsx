// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ExpoView } from '../src/expo/ExpoView';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import { initialState, type DirectorState } from '../src/expo/director';
import { NO_AI } from '../src/expo/ai-runner';
import { LINES } from '../src/expo/lines';
import { IntroView } from '../src/expo/intro-view';
import { mountIntroScene } from '../src/expo/intro-scene';
import { INTRO_CUES, introCueStart } from '../src/expo/intro-story';

// Здесь проверяется монтаж и управление; настоящий WebGL проверяется браузерным сценарием.
vi.mock('../src/expo/intro-scene', () => ({ mountIntroScene: vi.fn(async () => () => {}) }));

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());
const intro = (patch: Partial<DirectorState> = {}): DirectorState => ({
  ...initialState(1_000), phase: { kind: 'intro' }, phaseStart: 1_000, ...patch,
});

it('повторное состояние от другого окна не отбрасывает интерполированную камеру назад', async () => {
  let now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.mocked(mountIntroScene).mockClear();
  const v = render(<IntroView pane="film" line={3} elapsedMs={30000} cueElapsedMs={4000} />);
  await waitFor(() => expect(mountIntroScene).toHaveBeenCalled());
  const current = vi.mocked(mountIntroScene).mock.calls[0][2];
  now = 250;
  expect(current().elapsedMs).toBe(30150);
  v.rerender(<IntroView pane="film" line={3} elapsedMs={30000} cueElapsedMs={4000} />);
  expect(current().elapsedMs).toBe(30150);
  expect(current().progress).toBeCloseTo(4150 / INTRO_CUES[2].durationMs);
});

it('без WebGL рассказ и кнопка пропуска остаются доступны', async () => {
  vi.mocked(mountIntroScene).mockRejectedValueOnce(new Error('WebGL недоступен'));
  const skip = vi.fn();
  const v = render(<IntroView pane="film" line={8} onSkip={skip} />);
  await waitFor(() => expect(v.container.querySelector('.intro-no-webgl')).toBeTruthy());
  expect(v.getByText(LINES.say[INTRO_CUES[7].key][0])).toBeTruthy();
  fireEvent.click(v.getByRole('button', { name: 'Пропустить' }));
  expect(skip).toHaveBeenCalledOnce();
});

it('интро скрывает обычные органы стенда; только кнопка пропуска открывает выбор фронта', () => {
  const sent: unknown[] = [];
  const v = render(<ExpoView window={0} count={1} state={intro()} settings={EXPO_DEFAULTS} send={(e) => sent.push(e)} />);
  expect(v.container.querySelector('.expo-header')).toBeNull();
  expect(v.queryByRole('button', { name: 'Начать заново' })).toBeNull();
  expect(v.getByRole('group', { name: 'Экраны стенда' })).toBeTruthy();
  fireEvent.click(v.getByText('info@profdailog.ru'));
  expect(sent).toEqual([]);
  fireEvent.click(v.getByRole('button', { name: 'Пропустить' }));
  expect(sent).toEqual([{ t: 'skipIntro' }]);
});

it('подпись центра следует звучащей фразе, а при отсутствии речи — общим часам', () => {
  const props = { window: 0, count: 1 as const, settings: EXPO_DEFAULTS, send: () => {} };
  const state = intro({ now: 34_000 });
  const v = render(<ExpoView {...props} state={state} />);
  expect(v.getByText(LINES.say[INTRO_CUES[2].key][0])).toBeTruthy();
  v.rerender(<ExpoView {...props} state={state} ai={{ ...NO_AI, introLine: 2 }} />);
  expect(v.getByText(LINES.say[INTRO_CUES[1].key][0])).toBeTruthy();
  expect(v.queryByText(LINES.say[INTRO_CUES[2].key][0])).toBeNull();
});

it('вторая половина интро доступна на одном мониторе и следует голосу', () => {
  const props = { window: 0, count: 1 as const, settings: EXPO_DEFAULTS, send: () => {} };
  const v = render(<ExpoView {...props} state={intro()} ai={{ ...NO_AI, introLine: INTRO_CUES.findIndex(cue => cue.scene === 'variants') + 1 }} />);
  expect(v.getByRole('heading', { name: /Проиграть варианты\s+и сравнить последствия/ })).toBeTruthy();
  expect(v.getByText(LINES.say['intro-8'][0])).toBeTruthy();
  v.rerender(<ExpoView {...props} state={intro()} ai={{ ...NO_AI, introLine: INTRO_CUES.length }} />);
  expect(v.getByText(LINES.say['intro-12'][0])).toBeTruthy();
  expect(v.container.querySelector('[data-scene="final"]')).toBeTruthy();
});

it('пауза сохраняет текущую фразу и блокирует пропуск', () => {
  const sent: unknown[] = [];
  const v = render(<ExpoView window={0} count={1} state={intro({ now: 40_000, paused: true, pausedAt: 19_000 })} settings={EXPO_DEFAULTS} send={(e) => sent.push(e)} />);
  expect(v.getByText(LINES.say[INTRO_CUES[1].key][0])).toBeTruthy();
  fireEvent.click(v.getByRole('button', { name: 'Пропустить' }));
  expect(sent).toEqual([]);
});

it('три экрана показывают общую фразу; пропуск доступен лишь на экране карты', () => {
  for (const [window, pane] of [[0, 'factors'], [1, 'film'], [2, 'swarm']] as const) {
    const v = render(<ExpoView window={window} count={3} state={intro()} ai={{ ...NO_AI, introLine: 4 }} settings={EXPO_DEFAULTS} send={() => {}} />);
    expect(v.queryByText(LINES.say[INTRO_CUES[3].key][0]) !== null).toBe(window === 1);
    expect(v.queryByRole('heading') !== null).toBe(window === 1);
    if (window !== 1) expect(v.getByText(window === 0 ? 'Взаимосвязи факторов' : 'Пространство вариантов')).toBeTruthy();
    expect(v.container.querySelector(`.expo-intro3d-${pane}`)).toBeTruthy();
    expect(v.queryByRole('button', { name: 'Пропустить' }) !== null).toBe(window === 1);
    cleanup();
  }
});

it('два экрана сохраняют единственную кнопку пропуска, на основном экране', () => {
  for (const window of [0, 1]) {
    const v = render(<ExpoView window={window} count={2} state={intro()} settings={EXPO_DEFAULTS} send={() => {}} />);
    expect(v.queryByRole('button', { name: 'Пропустить' }) !== null).toBe(window === 0);
    cleanup();
  }
});

it('на одном мониторе вход в интро возвращает центр после просмотра бокового экрана', () => {
  const props = { window: 0, count: 1 as const, settings: EXPO_DEFAULTS, send: () => {} };
  const v = render(<ExpoView {...props} state={{ ...initialState(1_000), phase: { kind: 'attract' } }} />);
  act(() => dispatchEvent(new CustomEvent('expo-lens', { detail: { count: 3, window: 2 } })));
  v.rerender(<ExpoView {...props} state={intro()} />);
  expect(v.container.querySelector('.expo-intro3d-film')).toBeTruthy();
  expect(v.getByRole('button', { name: 'Пропустить' })).toBeTruthy();
});

it('переключатель экранов интро сохраняет сцену и не посылает событий режиссёру', () => {
  const send = vi.fn();
  const v = render(<ExpoView window={0} count={1} state={intro()} ai={{ ...NO_AI, introLine: 8 }} settings={EXPO_DEFAULTS} send={send} />);
  for (const [name, pane] of [['1','factors'],['3','swarm'],['2','film'],['Все вместе','film']]) {
    fireEvent.click(v.getByRole('button', { name }));
    expect(v.container.querySelector(`.expo-intro3d-${pane}[data-line="8"]`)).toBeTruthy();
  }
  expect(send).not.toHaveBeenCalled();
});

it('выбор сцены посылает её номер и сохраняет выбранный боковой экран', () => {
  const send = vi.fn();
  const props = { window: 0, count: 1 as const, settings: EXPO_DEFAULTS, send };
  const v = render(<ExpoView {...props} state={intro()} ai={{ ...NO_AI, introLine: 1 }} />);
  fireEvent.click(v.getByRole('button', { name: '3' }));
  const select = v.getByRole('button', { name: /^Перейти к сцене 2:/ });
  fireEvent.click(select);
  expect(send).toHaveBeenLastCalledWith({ t: 'introSeek', line: 2 });
  v.rerender(<ExpoView {...props} state={intro({ phase: { kind: 'intro', line: 2 } })} ai={{ ...NO_AI, introLine: 1 }} />);
  expect(v.container.querySelector('.expo-intro3d-swarm[data-line="2"]')).toBeTruthy();
  expect(select.getAttribute('aria-current')).toBe('step');
  fireEvent.click(v.getByRole('button', { name: 'Следующая сцена' }));
  expect(send).toHaveBeenLastCalledWith({ t: 'introSeek', line: 3 });
  fireEvent.click(v.getByRole('button', { name: 'Предыдущая сцена' }));
  expect(send).toHaveBeenLastCalledWith({ t: 'introSeek', line: 1 });
});

it('после ручного перехода без очереди речи резервные часы двигают текущую сцену', () => {
  const props = { window: 0, count: 1 as const, settings: EXPO_DEFAULTS, send: () => {} };
  const state = intro({ phase: { kind: 'intro', line: 2 }, phaseStart: -introCueStart(2), now: INTRO_CUES[1].durationMs / 2 });
  const v = render(<ExpoView {...props} state={state} ai={NO_AI} />);
  const fill = () => (v.container.querySelector('.intro-scene-link.is-current .intro-scene-track i') as HTMLElement).style.transform;
  expect(fill()).toBe('scaleX(0.5)');
  v.rerender(<ExpoView {...props} state={{ ...state, now: INTRO_CUES[1].durationMs * .75 }} ai={NO_AI} />);
  expect(fill()).toBe('scaleX(0.75)');
});

it('ручная навигация закрыта на физических боковых экранах, на паузе и за границами интро', () => {
  const select = vi.fn();
  const v = render(<IntroView pane="film" line={1} onSelectScene={select} />);
  expect((v.getByRole('button', { name: 'Предыдущая сцена' }) as HTMLButtonElement).disabled).toBe(true);
  v.rerender(<IntroView pane="film" line={INTRO_CUES.length} onSelectScene={select} />);
  expect((v.getByRole('button', { name: 'Следующая сцена' }) as HTMLButtonElement).disabled).toBe(true);
  v.rerender(<IntroView pane="film" line={6} paused onSelectScene={select} />);
  fireEvent.click(v.getByRole('button', { name: /^Перейти к сцене 2:/ }));
  fireEvent.click(v.getByRole('button', { name: 'Следующая сцена' }));
  expect(select).not.toHaveBeenCalled();
  v.unmount();
  const side = render(<ExpoView window={2} count={3} state={intro()} settings={EXPO_DEFAULTS} send={select} />);
  expect(side.queryByRole('navigation', { name: 'Сцены интро' })).toBeNull();
});

it('клавиши в интро листают сцены, сохраняя экран, и не перехватываются при вводе текста', () => {
  const send = vi.fn();
  const v = render(<ExpoView window={0} count={1} state={intro()} ai={{ ...NO_AI, introLine: 2 }} settings={{ ...EXPO_DEFAULTS, input: 'mouse-keyboard' }} send={send} />);
  fireEvent.click(v.getByRole('button', { name: '1' }));
  fireEvent.keyDown(document, { key: 'ArrowRight' });
  fireEvent.keyDown(document, { key: 'ArrowLeft' });
  expect(send.mock.calls.map(([event]) => event)).toEqual([{ t: 'introSeek', line: 3 }, { t: 'introSeek', line: 1 }]);
  expect(v.container.querySelector('.expo-intro3d-factors')).toBeTruthy();
  const input = document.createElement('input'); document.body.append(input);
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  input.remove();
  expect(send).toHaveBeenCalledTimes(2);
});
