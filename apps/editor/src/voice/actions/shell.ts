/**
 * Действия оболочки: переход между разделами, калибровка и голоса, справка.
 *
 * Событие окна `voice:open` (CustomEvent, detail: 'calibrate' | 'voices') — просьба открыть
 * соответствующий экран панели голоса; панель слушает его сама.
 */
import { SECTIONS } from '../../sections';
import { helpText } from '../dispatch';
import { register, type Action } from '../registry';

export function shellActions(deps: { section(): string; open?(id: string): void } = { section: () => 'editor' }): Action[] {
  const open = deps.open ?? ((id: string) => { location.hash = `#${id}`; }); // Shell слушает hashchange
  const emit = (what: 'calibrate' | 'voices') => window.dispatchEvent(new CustomEvent('voice:open', { detail: what }));
  const base = { section: 'global', available: () => true as const };
  return [
    {
      ...base, id: 'shell.open', title: 'Открыть раздел', describe: 'Переходит в раздел приложения.',
      params: { type: 'object', properties: { section: { enum: SECTIONS.map((s) => s.id) } }, required: ['section'] },
      say: ['штаб, открой переигровку'],
      run: async (p: { section: string }) => {
        const s = SECTIONS.find((x) => x.id === p?.section);
        if (!s) return 'Нет такого раздела.';
        open(s.id);
      },
    },
    { ...base, id: 'shell.calibrate', title: 'Калибровка голоса', describe: 'Открывает калибровку микрофона.', say: ['штаб, калибровка'], run: async () => { emit('calibrate'); } },
    { ...base, id: 'shell.voices', title: 'Голоса', describe: 'Открывает выбор голоса штаба.', say: ['штаб, голоса'], run: async () => { emit('voices'); } },
    { ...base, id: 'shell.help', title: 'Что можно сказать', describe: 'Зачитывает примеры команд раздела.', say: ['штаб, что я могу сказать'], run: async () => helpText(deps.section()) },
  ];
}

/** Регистрирует все действия оболочки; возвращает функцию снятия. */
export function registerShellActions(deps?: Parameters<typeof shellActions>[0]): () => void {
  const offs = shellActions(deps).map(register);
  return () => offs.forEach((o) => o());
}
