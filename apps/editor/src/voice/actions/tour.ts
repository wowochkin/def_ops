/**
 * Действия тура: запуск (тур раздела, вступление, панель голоса), «дальше», «назад», «повтори», «подробнее»,
 * «пауза» / «продолжай», «хватит», вступление при запуске — включить и выключить (и флажком в панели голоса). Кнопки подписи тура вызывают те же действия.
 * Примеры `say` разборщик сопоставляет дословно (dispatch.ts, bySay) — «дальше» понимается без модели.
 *
 * `voice.panel` — открыть панель голоса (событие окна `voice:open`, detail 'panel'): подготовка тура по панели.
 */
import { SECTIONS } from '../../sections';
import { register, type Action } from '../registry';

/** Что действиям нужно от движка тура (voice/tour.tsx). */
export interface TourControl {
  active(): boolean;
  hasMore(): boolean;
  paused(): boolean;
  section(): string;
  /** Есть ли тур с таким идентификатором или по такому разделу. */
  has(idOrSection: string): boolean;
  start(idOrSection: string): Promise<string | void>;
  next(): void;
  back(): void;
  repeat(): void;
  more(): void;
  pause(): void;
  resume(): void;
  /** Закончить тур; строка — что штаб уже сказал сам (после вступления — как его выключить), иначе ничего. */
  stop(): string | void;
  introOn(): void;
  introOff(): void;
  /** Идёт игра: раздел «Переигровка» показывает командование (его тур — 'command'). */
  inGame?(): boolean;
}

const NO_TOUR = 'Тур сейчас не идёт.';
const title = (id: string) => SECTIONS.find((s) => s.id === id)?.title ?? id;

/**
 * «Тур по …» — название раздела в дательном падеже. Без модели параметр из фразы не разобрать (разборщик
 * сопоставляет `say` дословно), поэтому у каждого раздела — ярлык `tour.of.<раздел>` («Штаб, тур по картам»;
 * `shortcut` — модели не виден, у неё есть `tour.start {section}`). Тура по разделу нет — честный ответ.
 * «Штаб, покажи раздел» — тур текущего раздела; «Штаб, покажи <раздел>» — переход (правило разборщика); фразы
 * «покажи раздел <название>» нет: она отличалась бы от перехода одним словом.
 */
const DATIVE: Record<string, string[]> = {
  editor: ['редактору'], replay: ['переигровке'], modeling: ['моделированию'], maps: ['картам'],
  library: ['знакам'], knowledge: ['знаниям'], staff: ['разделу ии', 'ии'],
};
export const tourSay = (id: string) => (DATIVE[id] ?? []).map((d) => `штаб, тур по ${d}`);
/** Тур по командованию (игре в «Переигровке»): в игре — по экрану игры, вне её — как в неё попасть. */
export const COMMAND_SAY = ['штаб, тур по командованию', 'штаб, расскажи о командовании'];
export const IN_GAME = 'Сейчас идёт игра, на экране — командование. Тур по нему — «Штаб, тур по командованию»; тур по переигровке — после выхода из игры: «Штаб, выйди из игры».';

export function tourActions(c: TourControl): Action[] {
  const always = { section: 'global', available: () => true as const };
  const during = { section: 'global', available: () => (c.active() ? true as const : NO_TOUR) };
  const game = () => !!c.inGame?.();
  /** Тур текущего экрана: в «Переигровке» во время игры — командование. */
  const here = () => (c.section() === 'replay' && game() ? 'command' : c.section());
  const startSection = async (s: string) => (s === 'replay' && game() ? IN_GAME : c.has(s) ? c.start(s)
    : `По разделу «${title(s)}» тура пока нет. Могу рассказать о приложении: скажите «Штаб, расскажи о приложении».`);
  return [
    { ...always, id: 'tour.intro', title: 'Рассказать о приложении', describe: 'Вступление: что это за приложение, его разделы, как говорить со штабом.',
      say: ['штаб, расскажи о приложении'], run: async () => c.start('intro') },
    {
      ...always, id: 'tour.start', title: 'Тур по разделу',
      describe: 'Показывает раздел с подсветкой: что в нём есть и что сказать («Штаб, тур по картам» — section: maps; «тур по командованию» — command). Без параметра — текущий раздел; intro — о приложении, voice — панель голоса.',
      params: { type: 'object', properties: { section: { enum: [...SECTIONS.map((s) => s.id), 'command', 'intro', 'voice'] } } },
      // в «Что можно сказать» — и «тур по» текущему разделу (в игре — по командованию), если тур по нему есть
      get say() { const s = here(); return ['штаб, покажи раздел', ...(s === 'command' ? COMMAND_SAY.slice(0, 1) : c.has(s) ? tourSay(s).slice(0, 1) : [])]; },
      run: async (p?: { section?: string }) => startSection(p?.section ?? here()),
    },
    ...SECTIONS.map((sec): Action => ({
      id: `tour.of.${sec.id}`, section: 'global', title: `Тур по разделу «${sec.title}»`, shortcut: true,
      describe: `Показывает раздел «${sec.title}» с подсветкой: что в нём есть и что сказать.`,
      say: tourSay(sec.id),
      // тура нет — ярлык всё равно понимается, и штаб отвечает честно (в списках ярлыков и так нет)
      available: () => true,
      run: async () => startSection(sec.id),
    })),
    { id: 'tour.of.command', section: 'global', title: 'Тур по командованию', shortcut: true,
      describe: 'Показывает командование (игру в «Переигровке»): в игре — что на экране и что сказать, вне игры — как в неё попасть.',
      say: COMMAND_SAY, available: () => true, run: async () => c.start('command') },
    { ...always, id: 'tour.voice', title: 'Рассказать о панели голоса', describe: 'Тур по панели голоса.',
      say: ['штаб, расскажи о панели голоса'], run: async () => c.start('voice') },
    {
      ...always, id: 'tour.introOn', title: 'Показывать вступление', describe: 'Вступление снова звучит при каждом запуске.',
      say: ['штаб, показывай вступление при запуске', 'штаб, включи вступление'],
      run: async () => { c.introOn(); return 'Хорошо, вступление будет звучать при каждом запуске.'; },
    },
    {
      ...always, id: 'tour.introOff', title: 'Не показывать вступление', describe: 'Вступление при запуске больше не звучит.',
      say: ['штаб, без вступления', 'штаб, больше не показывай вступление', 'штаб, не показывай вступление', 'штаб, выключи вступление'],
      run: async () => {
        c.introOff();
        return 'Хорошо, при запуске вступления больше не будет. Включить его снова — флажок «Вступление при запуске» в тонкой настройке панели голоса.';
      },
    },
    { ...during, id: 'tour.next', title: 'Дальше', describe: 'Следующий шаг тура.', say: ['дальше', 'далее', 'следующий'], run: async () => { c.next(); } },
    { ...during, id: 'tour.back', title: 'Назад', describe: 'Предыдущий шаг тура.', say: ['назад', 'предыдущий', 'вернись'], run: async () => { c.back(); } },
    { ...during, id: 'tour.repeat', title: 'Повторить шаг', describe: 'Повторяет текущий шаг тура.', say: ['повтори', 'ещё раз'], run: async () => { c.repeat(); } },
    {
      ...during, id: 'tour.more', title: 'Подробнее', describe: 'Подробнее о текущем шаге тура.', say: ['подробнее'],
      available: () => (!c.active() ? NO_TOUR : c.hasMore() ? true : 'У этого шага подробностей нет.'),
      run: async () => { c.more(); },
    },
    { ...during, id: 'tour.pause', title: 'Пауза', describe: 'Приостанавливает тур.', say: ['пауза', 'подожди', 'подождите', 'погоди'], run: async () => { c.pause(); } },
    { ...during, id: 'tour.resume', title: 'Продолжить', describe: 'Продолжает тур с текущего шага.', say: ['продолжай', 'продолжи', 'продолжим'], run: async () => { c.resume(); } },
    { ...during, id: 'tour.stop', title: 'Хватит', describe: 'Заканчивает тур.', say: ['хватит', 'пропустить', 'пропусти', 'закончи тур'], run: async () => (c.stop() ? undefined : 'Хорошо.') },
    {
      ...always, id: 'voice.panel', title: 'Открыть панель голоса', describe: 'Разворачивает панель голоса.', say: ['штаб, открой панель голоса'],
      run: async () => { window.dispatchEvent(new CustomEvent('voice:open', { detail: 'panel' })); },
    },
  ];
}

/** Регистрирует действия тура; возвращает функцию снятия. */
export function registerTourActions(c: TourControl): () => void {
  const offs = tourActions(c).map(register);
  return () => offs.forEach((o) => o());
}
