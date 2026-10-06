/**
 * Системные диалоги браузера. Во встроенном фрейме (например, когда редактор
 * опубликован как страница-артефакт) confirm/prompt не показываются — тогда
 * действие выполняется без вопроса (отменяется через Ctrl+Z), а для ввода текста
 * берётся значение по умолчанию (его можно поправить в инспекторе).
 */
export const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();

export function ask(message: string, inFrameAnswer = true): boolean {
  return inFrame ? inFrameAnswer : window.confirm(message);
}

export function askText(message: string, def: string): string | null {
  return inFrame ? def : window.prompt(message, def);
}
