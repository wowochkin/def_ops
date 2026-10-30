/**
 * Отпечаток модели: хеш выжимки кода и нормативов модели (packages/knowledge/data/model-index.json; тест сверяет её
 * с исходниками ядра и модели), подставляется при сборке (vite.config.ts, define). Изменилась модель — другой
 * отпечаток, и посчитанное старой моделью (сводка «без вмешательства») не выдаётся за посчитанное новой. Вне сборки
 * (тесты) — 'dev'.
 */
declare const __MODEL_STAMP__: string | undefined;

export const MODEL_STAMP: string = typeof __MODEL_STAMP__ === 'string' ? __MODEL_STAMP__ : 'dev';
