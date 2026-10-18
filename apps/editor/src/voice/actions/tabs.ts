/**
 * Вкладки разделов голосом и кнопками: `modeling.tab {tab}`, `knowledge.tab {tab}`, `maps.tab {tab}`. Кнопки вкладок
 * (ActButton) и голос вызывают одно действие; переключают вкладку теми же путями, что и переходы извне:
 * - Моделирование — запоминаемая вкладка `def_ops.modeling.tab` и событие окна `def_ops.modeling.open` ({ tab });
 * - Знания — событие `def_ops.kb.tab` ({ tab }) и разовая запись `def_ops.kb.tab` (раздел ещё не смонтирован);
 * - Карты — запоминаемая вкладка `def_ops.maps.tab` и событие `def_ops.maps.tab` ({ tab }) (раздел размонтируется
 *   при уходе и при входе читает запомненную).
 *
 * Без модели параметр из фразы не разобрать (разборщик сопоставляет примеры `say` дословно), поэтому у каждой вкладки —
 * ещё своё действие без параметров (`modeling.tab.calibrate` …) с фразами «Штаб, открой вкладку Калибровка»; оно
 * вызывает общее. Действия — раздела: «открой вкладку Театры» понимается, когда открыт раздел «Карты».
 */
import { register, type Action } from '../registry';

export interface Tab { id: string; title: string; hint?: string }

/** Вкладки разделов: id — как в состоянии раздела, title — надпись на кнопке. */
export const TABS = {
  modeling: [
    { id: 'models', title: 'Модели', hint: 'описание правил, профилей, языковых моделей' },
    { id: 'compare', title: 'Сравнение', hint: 'модели между собой и с историей' },
    { id: 'tune', title: 'Настройка', hint: 'свой вариант правил' },
    { id: 'calibrate', title: 'Калибровка', hint: 'подбор по истории операции' },
    { id: 'agents', title: 'Агентная модель', hint: 'сравнение вариантов параметров с историей и калибровка (ядро приложения)' },
    { id: 'ops', title: 'Операции', hint: 'загрузка и подготовка к переигровке' },
    { id: 'assistant', title: 'Ассистент', hint: 'вопросы об устройстве модели' },
  ],
  knowledge: [
    { id: 'browse', title: 'Материалы' },
    { id: 'queue', title: 'На проверку', hint: 'Кандидаты-факты, которые проверки не пропустили в базу сразу: решает человек' },
    { id: 'docs', title: 'Документы' },
    { id: 'coverage', title: 'Полнота', hint: 'Полнота материалов операции по каркасу' },
  ],
  maps: [
    { id: 'base', title: 'Подложки' },
    { id: 'theatres', title: 'Театры' },
  ],
} as const satisfies Record<string, readonly Tab[]>;

export type TabSection = keyof typeof TABS;
export type TabOf<S extends TabSection> = (typeof TABS)[S][number]['id'];

const SECTION_TITLE: Record<TabSection, string> = { modeling: 'Моделирование', knowledge: 'Знания', maps: 'Карты' };

/** События окна: раздел переключает вкладку. */
export const MODELING_OPEN = 'def_ops.modeling.open';
export const KB_TAB = 'def_ops.kb.tab';
export const MAPS_TAB = 'def_ops.maps.tab';

const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };
const emit = (name: string, tab: string) => window.dispatchEvent(new CustomEvent(name, { detail: { tab } }));

/** Как каждый раздел переключает вкладку. */
const SWITCH: Record<TabSection, (tab: string) => void> = {
  modeling: (tab) => { lsSet('def_ops.modeling.tab', tab); emit(MODELING_OPEN, tab); },
  knowledge: (tab) => { lsSet(KB_TAB, tab); emit(KB_TAB, tab); },
  maps: (tab) => { lsSet(MAPS_TAB, tab); emit(MAPS_TAB, tab); },
};

/** Фразы для вкладки: «штаб, открой вкладку калибровка», «штаб, вкладка калибровка». */
export const tabSay = (title: string) => { const t = title.toLowerCase(); return [`штаб, открой вкладку ${t}`, `штаб, вкладка ${t}`]; };

export function tabActions(): Action[] {
  const out: Action[] = [];
  for (const sec of Object.keys(TABS) as TabSection[]) {
    const tabs: readonly Tab[] = TABS[sec];
    const run = async (p: { tab: string }) => {
      const t = tabs.find((x) => x.id === p?.tab);
      if (!t) return 'Нет такой вкладки.';
      SWITCH[sec](t.id);
      return `Открыта вкладка «${t.title}».`;
    };
    out.push({
      id: `${sec}.tab`, section: sec, title: 'Открыть вкладку',
      describe: `Открывает вкладку раздела «${SECTION_TITLE[sec]}»: ${tabs.map((t) => `${t.id} — «${t.title}»`).join(', ')}.`,
      params: { type: 'object', properties: { tab: { enum: tabs.map((t) => t.id) } }, required: ['tab'] },
      available: () => true, run,
    });
    for (const t of tabs) {
      out.push({
        id: `${sec}.tab.${t.id}`, section: sec, title: `Вкладка «${t.title}»`, describe: `Открывает вкладку «${t.title}».`,
        say: tabSay(t.title), available: () => true, run: () => run({ tab: t.id }),
      });
    }
  }
  return out;
}

/** Регистрирует действия вкладок; возвращает функцию снятия. */
export function registerTabActions(): () => void {
  const offs = tabActions().map(register);
  return () => offs.forEach((o) => o());
}
