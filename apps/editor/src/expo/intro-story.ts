/** Монтаж визитной карточки. Записи в банке — единственный источник дикторского текста. */
export const INTRO_CUES = [
  { key: 'intro-1', scene: 'identity', chapter: "Система моделирования боя", title: "Увидеть больше —\nрешить точнее", detail: "Исторические данные · Математическая модель · Искусственный интеллект", durationMs: 10000 },
  { key: 'intro-13', scene: 'demo', chapter: "Демонстрационный стенд", title: "Управление\nходом операции", detail: "Возможности модели в упрощенном интерфейсе", durationMs: 14000 },
  { key: 'intro-11', scene: 'scale', chapter: "Возможности развития", title: "От демонстрации\nк применению", detail: "Современные операции · Текущие условия · Данные в реальном времени", durationMs: 21000 },
  { key: 'intro-10', scene: 'berlin', chapter: "Берлинская операция", title: "Реальная операция ·\nОткрытые данные", detail: "Берлин, апрель - май 1945 года", durationMs: 11000 },
  { key: 'intro-2', scene: 'archive', chapter: "Исторические данные", title: "История становится\nданными", detail: "Документы · Карты · Боевой состав · Хронология", durationMs: 11000 },
  { key: 'intro-3', scene: 'math', chapter: "Математическая модель", title: "За каждым действием\nстоит расчет", detail: "Движение → Бой → Расход ресурсов → Новое состояние", durationMs: 16000 },
  { key: 'intro-4', scene: 'agents', chapter: "Агентное моделирование", title: "Каждое соединение\nв общем замысле", detail: "Приказ · Действие · Взаимодействие · Обратная связь", durationMs: 15000 },
  { key: 'intro-5', scene: 'factors', chapter: "Факторы боя", title: "Ни один фактор\nне существует отдельно", detail: "Силы и средства связаны с пространством, временем и снабжением", durationMs: 18000 },
  { key: 'intro-6', scene: 'space', chapter: "Пространственные данные", title: "Местность меняет все", detail: "Рельеф · Дороги · Реки · Города · Положение войск", durationMs: 13000 },
  { key: 'intro-7', scene: 'ai', chapter: "Искусственный интеллект", title: "Целостная картина\nиз множества сигналов", detail: "Обстановка → Связи → Риски → Аргументы", durationMs: 10000 },
  { key: 'intro-8', scene: 'variants', chapter: "Варианты действий", title: "Проиграть варианты\nи сравнить последствия", detail: "Направление удара · Время · Резервы · Снабжение", durationMs: 14000 },
  { key: 'intro-9', scene: 'decision', chapter: "Решение командующего", title: "Последнее слово\nза человеком", detail: "Анализ поддерживает решение, командующий осуществляет управление", durationMs: 9000 },
  { key: 'intro-12', scene: 'final', chapter: "Штабные игры", title: "Понять обстановку\nи принять командование", detail: "Данные. Модель. Искусственный интеллект. Ваше решение.", durationMs: 9000 },
] as const;

export type IntroSceneId = typeof INTRO_CUES[number]['scene'];

export const INTRO_GAP_MS = 3000;
export const introGap = (index: number) => index >= 0 && index < INTRO_CUES.length ? INTRO_GAP_MS : 0;
export const INTRO_DURATION_MS = INTRO_CUES.reduce((sum, cue, i) => sum + cue.durationMs + introGap(i), 0);
export const INTRO_KEYS: readonly string[] = INTRO_CUES.map((cue) => cue.key);
export function introCueStart(line: number) {
  return INTRO_CUES.slice(0, Math.max(0, line - 1)).reduce((sum, cue, index) => sum + cue.durationMs + introGap(index), 0);
}
export function introCueAt(elapsedMs: number) {
  let start = 0;
  for (let i = 0; i < INTRO_CUES.length; i++) {
    const duration = INTRO_CUES[i].durationMs;
    if (elapsedMs < start + duration + introGap(i) || i === INTRO_CUES.length - 1) {
      return { line: i + 1, start, progress: Math.max(0, Math.min(1, (elapsedMs - start) / duration)) };
    }
    start += duration + introGap(i);
  }
  return { line: 1, start: 0, progress: 0 };
}

export const INTRO_FACTORS = ['Личный состав', 'Танки и артиллерия', 'Соотношение сил', 'Боеприпасы', 'Горючее и подвоз', 'Потери и резервы', 'Усталость', 'Слаженность', 'Приказы и задержки', 'Разведка', 'Время суток', 'Рельеф', 'Дороги', 'Реки и переправы', 'Укрепления', 'Окружение'] as const;
