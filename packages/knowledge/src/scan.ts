/**
 * Чтение скана моделью со зрением: страница (или полоса высокой страницы) → дословная расшифровка и формальные факты
 * с цитатой — куском расшифровки — и местом на странице. Проверку цитаты по расшифровке делает runChecks.
 */
import { claimRules, isDoctrinal, isNormative, SCAN_SCHEMA, type OperationHint, type ParamHint } from './extract';

export { SCAN_SCHEMA };
export type { ExtractedClaim } from './extract';

/** Сообщение модели: текст или картинка (data: URL) — как ChatMessage клиента моделей. */
export type ScanMessage = { role: 'system' | 'user'; content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] };

/** Перечень параметров модели — только если название документа с признаками норматива, строка вида doctrine — с признаками устава (текста страницы до чтения нет). */
export function scanMessages(imageDataUrl: string, docName: string, op?: OperationHint, params?: ParamHint[]): ScanMessage[] {
  return [
    { role: 'system', content: `Вы — читатель архивных документов 1945 года (машинопись, рукопись, таблицы). По изображению страницы (или её полосы) сделайте два дела.

1. transcript — расшифровка того, что напечатано или написано, ДОСЛОВНО: ничего не исправляйте, не пересказывайте, не сокращайте, не дополняйте по смыслу, сохраняйте строки и порядок. Неразборчивые знаки замените на «?» (цифра, в которой вы не уверены, — тоже «?»). Таблицы — строка за строкой, ячейки через « | ».
2. claims — формальные факты, прямо сказанные на странице. quote каждого факта — кусок расшифровки, скопированный из transcript без изменений (до 200 знаков), с числами факта; box — место этого куска на изображении в долях от ширины и высоты [левый, верхний, правый, нижний], от 0 до 1.

${claimRules(op, isNormative(docName) ? params : undefined, isDoctrinal(docName))}Ответ — один JSON-объект по схеме.` },
    { role: 'user', content: [
      { type: 'text', text: `Документ: «${docName}»${op ? ` (материал операции «${op.title}»)` : ''}. Изображение страницы:` },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ] },
  ];
}

/**
 * Полосы страницы в пикселях: 1 — если высота не больше 1,6 ширины, иначе 2–4 полосы
 * (по числу ширин в высоте) с перекрытием не меньше 10 % полосы.
 */
export function stripes(width: number, height: number): { y: number; h: number }[] {
  if (!(width > 0) || !(height > 0) || height / width <= 1.6) return [{ y: 0, h: Math.max(0, Math.round(height)) }];
  const n = Math.min(4, Math.max(2, Math.ceil(height / width)));
  const h = Math.min(height, Math.ceil(height / (n - 0.1 * (n - 1))) + n);
  const step = h - Math.ceil(0.1 * h);
  return Array.from({ length: n }, (_, i) => ({ y: Math.max(0, Math.min(i * step, height - h)), h }));
}

/** Место на полосе (доли полосы) → место на странице (доли страницы). */
export function boxOnPage(box: [number, number, number, number], stripe: { y: number; h: number }, pageHeight: number): [number, number, number, number] {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return [c(box[0]), c((stripe.y + box[1] * stripe.h) / pageHeight), c(box[2]), c((stripe.y + box[3] * stripe.h) / pageHeight)];
}
