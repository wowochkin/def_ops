/**
 * Вкладки разделов голосом и кнопками: `modeling.tab {tab}`, `knowledge.tab {tab}`, `maps.tab {tab}`. Кнопки вкладок
 * (ActButton) и голос вызывают одно действие; переключают вкладку теми же путями, что и переходы извне:
 * - Моделирование — запоминаемая вкладка `def_ops.modeling.tab` и событие окна `def_ops.modeling.open` ({ tab });
 * - Знания — событие `def_ops.kb.tab` ({ tab }) и разовая запись `def_ops.kb.tab` (раздел ещё не смонтирован);
 * - Карты — запоминаемая вкладка `def_ops.maps.tab` и событие `def_ops.maps.tab` ({ tab }) (раздел размонтируется
 *   при уходе и при входе читает запомненную).
 *
 * Без модели параметр из фразы не разобрать (разборщик сопоставляет примеры `say` дословно), поэтому у каждой вкладки —
 * ещё ярлык без параметров (`modeling.tab.calibrate` …, `shortcut`) с фразами «Штаб, открой вкладку Калибровка»,
 * «Штаб, вкладка Калибровка», «Штаб, открой калибровку»; он вызывает общее. Модели ярлыки не видны, в «Что можно
 * сказать» вкладки — одной строкой общего действия (`hint`); в ответах штаба («Да, скажите: …», «Можно сказать: …») —
 * фраза нужной вкладки. Действия — раздела: «открой театры» понимается, когда открыт
 * раздел «Карты».
 */
import { register, type Action } from '../registry';

/** acc — как вкладку называют после «открой» (винительный); note — продолжение ответа «Открыта вкладка «…» — …». */
export interface Tab { id: string; title: string; acc: string; hint?: string; note?: string }

/** Вкладки разделов: id — как в состоянии раздела, title — надпись на кнопке. */
export const TABS = {
  modeling: [
    { id: 'models', title: 'Модели', acc: 'модели', hint: 'описание правил, профилей, языковых моделей' },
    { id: 'compare', title: 'Сравнение', acc: 'сравнение', hint: 'модели между собой и с историей' },
    { id: 'tune', title: 'Настройка', acc: 'настройку', hint: 'свой вариант правил' },
    { id: 'calibrate', title: 'Калибровка', acc: 'калибровку', hint: 'подбор по истории операции',
      note: 'подбор правил по истории. Микрофон калибруют словами «Штаб, калибровка».' },
    { id: 'agents', title: 'Агентная модель', acc: 'агентную модель', hint: 'сравнение вариантов параметров с историей и калибровка (ядро приложения)' },
    { id: 'ops', title: 'Операции', acc: 'операции', hint: 'загрузка и подготовка к переигровке' },
    { id: 'assistant', title: 'Ассистент', acc: 'ассистента', hint: 'вопросы об устройстве модели' },
  ],
  knowledge: [
    { id: 'browse', title: 'Материалы', acc: 'материалы' },
    { id: 'queue', title: 'На проверку', acc: 'очередь на проверку', hint: 'Кандидаты-факты, которые проверки не пропустили в базу сразу: решает человек' },
    { id: 'docs', title: 'Документы', acc: 'документы' },
    { id: 'coverage', title: 'Полнота', acc: 'полноту', hint: 'Полнота материалов операции по каркасу' },
  ],
  maps: [
    { id: 'base', title: 'Подложки', acc: 'подложки' },
    { id: 'theatres', title: 'Театры', acc: 'театры' },
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

/** Фразы для вкладки: «штаб, открой вкладку калибровка», «штаб, вкладка калибровка», «штаб, открой калибровку». */
export const tabSay = (t: Tab) => { const n = t.title.toLowerCase(); return [`штаб, открой вкладку ${n}`, `штаб, вкладка ${n}`, `штаб, открой ${t.acc}`]; };

/**
 * Открытая сейчас вкладка раздела: запомненная (Моделирование и Карты пишут её при каждом переключении), у Знаний —
 * по кнопке `.on` на экране; иначе — первая. Тур запоминает её перед тем, как листать вкладки, и возвращает в конце.
 */
export function currentTab(sec: TabSection): string {
  const tabs: readonly Tab[] = TABS[sec];
  const ok = (t: string | null | undefined) => (t && tabs.some((x) => x.id === t) ? t : null);
  let shown: string | null = null;
  if (typeof document !== 'undefined') {
    const on = document.querySelector(`[data-tour^="${sec}-tab-"].on`)?.getAttribute('data-tour');
    shown = ok(on?.slice(`${sec}-tab-`.length));
  }
  let kept: string | null = null;
  if (sec !== 'knowledge') { try { kept = ok(localStorage.getItem(sec === 'modeling' ? 'def_ops.modeling.tab' : MAPS_TAB)); } catch { /* */ } }
  return kept ?? shown ?? tabs[0].id;
}

export function tabActions(): Action[] {
  const out: Action[] = [];
  for (const sec of Object.keys(TABS) as TabSection[]) {
    const tabs: readonly Tab[] = TABS[sec];
    const run = async (p: { tab: string }) => {
      const t = tabs.find((x) => x.id === p?.tab);
      if (!t) return 'Нет такой вкладки.';
      SWITCH[sec](t.id);
      return `Открыта вкладка «${t.title}»${t.note ? ` — ${t.note}` : '.'}`;
    };
    out.push({
      id: `${sec}.tab`, section: sec, title: 'Открыть вкладку',
      describe: `Открывает вкладку раздела «${SECTION_TITLE[sec]}»: ${tabs.map((t) => `${t.id} — «${t.title}»`).join(', ')}.`,
      params: { type: 'object', properties: { tab: { enum: tabs.map((t) => t.id) } }, required: ['tab'] },
      // в панели — одной строкой-перечнем; в ответах штаба — фраза одной вкладки (а нужной — у ярлыка)
      hint: `штаб, открой вкладку …: ${tabs.map((t) => t.title).join(', ')}`,
      say: tabSay(tabs[0]).slice(0, 1),
      available: () => true, run,
    });
    for (const t of tabs) {
      out.push({
        id: `${sec}.tab.${t.id}`, section: sec, title: `Открыть вкладку «${t.title}»`, describe: `Открывает вкладку «${t.title}».`,
        shortcut: true, say: tabSay(t), available: () => true, run: () => run({ tab: t.id }),
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
