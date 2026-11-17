// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { OperatorMenu } from '../src/expo/OperatorMenu';
import { EXPO_DEFAULTS, normalizeSettings, localSettingsStore, type ExpoSettings } from '../src/expo/settings';
import { initialState, step, type DirectorState } from '../src/expo/director';

afterEach(cleanup);
const config = (comments: boolean, debrief: boolean): ExpoSettings => ({ ...EXPO_DEFAULTS, generation: { ...EXPO_DEFAULTS.generation, comments, debrief } });
const scrolling = (n: 1 | 2 | 3): DirectorState => ({ ...initialState(0), session: 7, front: 'su_1uf', phase: { kind: 'turn', n, step: 'scroll', deadline: null, warned: false, offered: false, replacements: 0, choice: 0, scrollBegan: true } });
it('прежние настройки включают оба этапа; новые значения сохраняются независимо', async () => {
  const old = { ...EXPO_DEFAULTS } as Partial<ExpoSettings>;
  delete old.generation;
  expect(normalizeSettings(old)).toMatchObject({ settings: { generation: { comments: true, debrief: true } }, problems: [] });
  localStorage.clear();
  const store = localSettingsStore(localStorage);
  await store.save(config(false, true));
  expect((await store.load()).generation).toEqual({ comments: false, debrief: true, temperature: 0.2, batchSize: 4, cpuThreads: 2, commentVoice: true, debriefVoice: true });
  expect(normalizeSettings({ ...EXPO_DEFAULTS, generation: { comments: 'нет', debrief: false } }).settings.generation).toEqual({ comments: true, debrief: false, temperature: 0.2, batchSize: 4, cpuThreads: 2, commentVoice: true, debriefVoice: true });
});
it.each([1, 2, 3] as const)('выключенный комментарий %s не запрашивается; переход сразу после конца карты', n => {
  const cfg = config(false, true);
  const finished = step(scrolling(n), { t: 'scrollDone' }, cfg);
  expect(finished.effects.some(e => e.e === 'commentChoice')).toBe(false);
  if (n === 3) expect(finished.effects).toEqual([{ e: 'prepareDebrief' }]);
  else expect(finished.state.phase).toMatchObject({ kind: 'turn', n: n + 1, step: 'explain' });
});
it.each([true, false])('выключенный итог пропускает подготовку, комментарии=%s', comments => {
  const cfg = config(comments, false);
  let ended = step(scrolling(3), { t: 'scrollDone' }, cfg);
  if (comments) {
    expect(ended.effects[0]).toMatchObject({ e: 'commentChoice' });
    const p = ended.state.phase;
    if (p.kind !== 'turn' || !p.commenting) throw Error('Нет комментария');
    ended = step(ended.state, { t: 'commentDone', n: 3, session: 7, token: p.commenting.token }, cfg);
  }
  expect(ended.state.phase.kind).toBe('result');
  expect(ended.effects.some(e => e.e === 'prepareDebrief')).toBe(false);
});
it('оператор сохраняет два независимых переключателя без изменения режима ИИ', () => {
  const save = vi.fn(async (_s: ExpoSettings) => {});
  const props = { settings: EXPO_DEFAULTS, onSave: save, onClose() {}, onExit() {}, onAction() {} };
  const view = render(<OperatorMenu {...props} />);
  fireEvent.change(view.getByLabelText('ПИН'), { target: { value: '0000' } });
  fireEvent.click(view.getByRole('button', { name: 'Открыть меню' }));
  fireEvent.click(view.getByRole('checkbox', { name: 'Комментарии после решений' }));
  expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ aiMode: 'ai', generation: { comments: false, debrief: true } });
  view.rerender(<OperatorMenu {...props} settings={config(false, true)} />);
  fireEvent.click(view.getByRole('checkbox', { name: 'Итоговый разбор' }));
  expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ aiMode: 'ai', generation: { comments: false, debrief: false } });
});

it('прежний объект generation получает параметры синтеза без резервной копии порчи', async () => {
  localStorage.clear();
  localStorage.setItem('def_ops.expo.settings', JSON.stringify({ ...EXPO_DEFAULTS, generation: { comments: false, debrief: true } }));
  const settings = await localSettingsStore(localStorage).load();
  expect(settings.generation).toEqual({ comments: false, debrief: true, temperature: 0.2, batchSize: 4, cpuThreads: 2, commentVoice: true, debriefVoice: true });
  expect(localStorage.getItem('def_ops.expo.settings.bad')).toBeNull();
});
it('оператор сохраняет температуру0 и пакет2 через обычное хранилище', async () => {
  let settings = { ...EXPO_DEFAULTS, generation: { ...EXPO_DEFAULTS.generation } };
  const store = localSettingsStore(localStorage);
  const save = vi.fn(async (next: ExpoSettings) => { settings = next; await store.save(next); });
  const props = { onSave: save, onClose() {}, onExit() {}, onAction() {} };
  const view = render(<OperatorMenu {...props} settings={settings} />);
  fireEvent.change(view.getByLabelText('ПИН'), { target: { value: '0000' } });
  fireEvent.click(view.getByRole('button', { name: 'Открыть меню' }));
  const temperature = view.getByLabelText(/Температура голоса/);
  expect(temperature.getAttribute('min')).toBe('0');
  expect(temperature.getAttribute('max')).toBe('1');
  expect(temperature.getAttribute('step')).toBe('0.1');
  fireEvent.change(temperature, { target: { value: '0' } });
  view.rerender(<OperatorMenu {...props} settings={settings} />);
  fireEvent.change(view.getByLabelText('Размер пакета'), { target: { value: '2' } });
  await Promise.resolve();
  expect((await store.load()).generation).toEqual({ comments: true, debrief: true, temperature: 0, batchSize: 2, cpuThreads: 2, commentVoice: true, debriefVoice: true });
});
it.each([{ temperature: -1, batchSize: 3 }, { temperature: NaN, batchSize: '4' }, { temperature: '0.2', batchSize: 8 }])('повреждённые параметры синтеза заменяются defaults: %o', values => {
  const result = normalizeSettings({ ...EXPO_DEFAULTS, generation: { comments: false, debrief: true, ...values } });
  expect(result.settings.generation).toEqual({ comments: false, debrief: true, temperature: 0.2, batchSize: 4, cpuThreads: 2, commentVoice: true, debriefVoice: true });
  expect(result.problems).toHaveLength(2);
});

it('оператор отдельно сохраняет CPU-потоки и выключение звука, оставляя текстовые этапы включёнными', async () => {
  let settings={...EXPO_DEFAULTS,generation:{...EXPO_DEFAULTS.generation}};
  const props={onSave:vi.fn(async (next:ExpoSettings)=>{settings=next;}),onClose(){},onExit(){},onAction(){}};
  const view=render(<OperatorMenu {...props} settings={settings} />);
  fireEvent.change(view.getByLabelText('ПИН'),{target:{value:'0000'}});
  fireEvent.click(view.getByRole('button',{name:'Открыть меню'}));
  fireEvent.change(view.getByLabelText('Потоки CPU для TTS'),{target:{value:'1'}});
  view.rerender(<OperatorMenu {...props} settings={settings} />);
  fireEvent.click(view.getByRole('checkbox',{name:'Озвучивать комментарии'}));
  view.rerender(<OperatorMenu {...props} settings={settings} />);
  fireEvent.click(view.getByRole('checkbox',{name:'Догенерировать озвучку итога'}));
  expect(settings.generation).toMatchObject({comments:true,debrief:true,commentVoice:false,debriefVoice:false,cpuThreads:1});
  expect(normalizeSettings({...EXPO_DEFAULTS,generation:{comments:true,debrief:true,temperature:0.2,batchSize:4}})).toMatchObject({settings:{generation:{cpuThreads:2,commentVoice:true,debriefVoice:true}},problems:[]});
});

it('испорченные CPU-потоки и флаги звука не проходят в рабочие настройки',()=>{
  const result=normalizeSettings({...EXPO_DEFAULTS,generation:{...EXPO_DEFAULTS.generation,cpuThreads:3,commentVoice:'нет',debriefVoice:0}});
  expect(result.settings.generation).toMatchObject({cpuThreads:2,commentVoice:true,debriefVoice:true});
  expect(result.problems).toHaveLength(3);
});

it('быстрые изменения озвучки и CPU не теряются, пока предыдущая запись файла ещё выполняется',()=>{
  const save=vi.fn((_s: ExpoSettings)=>new Promise<void>(()=>{}));
  const view=render(<OperatorMenu settings={EXPO_DEFAULTS} onSave={save} onClose={()=>{}} onExit={()=>{}} onAction={()=>{}} />);
  fireEvent.change(view.getByLabelText('ПИН'),{target:{value:'0000'}});
  fireEvent.click(view.getByRole('button',{name:'Открыть меню'}));
  fireEvent.click(view.getByRole('checkbox',{name:'Озвучивать комментарии'}));
  fireEvent.click(view.getByRole('checkbox',{name:'Догенерировать озвучку итога'}));
  fireEvent.change(view.getByLabelText('Потоки CPU для TTS'),{target:{value:'1'}});
  expect(save.mock.calls.at(-1)?.[0]?.generation).toMatchObject({commentVoice:false,debriefVoice:false,cpuThreads:1,comments:true,debrief:true});
});
