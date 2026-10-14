/**
 * Системные диалоги браузера. Во встроенном фрейме (например, когда редактор
 * опубликован как страница-артефакт) confirm/prompt не показываются — тогда
 * действие выполняется без вопроса (отменяется через Ctrl+Z), а для ввода текста
 * берётся значение по умолчанию (его можно поправить в инспекторе).
 */
export const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();

/** Да/нет — диалогом внутри страницы (системный confirm в настольном окне не работает). */
export function ask(message: string, inFrameAnswer = true): Promise<boolean> {
  return inFrame ? Promise.resolve(inFrameAnswer) : confirmAsync(message);
}

/** Строка текста — диалогом внутри страницы (системный prompt в настольном окне не работает). */
export function askText(message: string, def: string): Promise<string | null> {
  return inFrame ? Promise.resolve(def) : dialog(message, { input: def, ok: 'ОК' }).then((r) => (r === false ? null : (r as string)));
}

/**
 * Подтверждение внутри страницы. Системный confirm в окне настольного приложения (WebKit на macOS) не
 * показывается и сразу отвечает «нет» — действие молча не выполнялось; этот диалог работает везде.
 */
export function confirmAsync(message: string, o: { ok?: string; cancel?: string; danger?: boolean } = {}): Promise<boolean> {
  return dialog(message, o).then((r) => r !== false);
}

/** Диалог: с input — возвращает введённую строку или false (отмена); без — true / false. */
function dialog(message: string, o: { ok?: string; cancel?: string; danger?: boolean; input?: string }): Promise<string | boolean> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'confirm-back';
    const box = document.createElement('div');
    box.className = 'confirm-box';
    box.setAttribute('role', 'dialog');
    const p = document.createElement('p');
    p.textContent = message;
    const row = document.createElement('div');
    row.className = 'confirm-row';
    const no = document.createElement('button');
    no.textContent = o.cancel ?? 'Отмена';
    const yes = document.createElement('button');
    yes.className = o.danger ? 'danger' : 'primary';
    yes.textContent = o.ok ?? 'Да';
    row.append(no, yes);
    const inp = o.input != null ? document.createElement(/\n/.test(o.input) ? 'textarea' : 'input') : null;
    if (inp) { inp.value = o.input!; inp.className = 'confirm-input'; }
    box.append(...(inp ? [p, inp, row] : [p, row]));
    back.append(box);
    const done = (v: boolean) => {
      const out: string | boolean = v && inp ? inp.value : v;
      window.removeEventListener('keydown', key, true);
      back.remove();
      resolve(out);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Enter' && !(e.shiftKey && inp)) { e.preventDefault(); e.stopPropagation(); done(true); }
    };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    back.onclick = (e) => { if (e.target === back) done(false); };
    window.addEventListener('keydown', key, true);
    document.body.append(back);
    if (inp) { inp.focus(); inp.select(); } else yes.focus();
  });
}
