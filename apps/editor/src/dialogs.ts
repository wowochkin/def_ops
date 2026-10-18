/**
 * Системные диалоги браузера. Во встроенном фрейме (например, когда редактор
 * опубликован как страница-артефакт) confirm/prompt не показываются — тогда
 * действие выполняется без вопроса (отменяется через Ctrl+Z), а для ввода текста
 * берётся значение по умолчанию (его можно поправить в инспекторе).
 *
 * Голосом (voiceDialog): открытое окно зачитывается штабом (вопрос, как отвечать, потом пояснения) и ждёт ответа; пока оно открыто,
 * в реестре временные действия `dialog.answer {choice}` («да» / «нет» / вариант по номеру или названию) и
 * `dialog.text {text}` (поле ввода — диктовкой); кнопки окна вызывают те же действия.
 */
import { ordinalIndex, pickByName, yesNo } from './voice/answers';
import { queueReading, readParts, stopReading } from './voice/dictation';
import { REMIND_YES_NO, WAIT_SAY } from './voice/dispatch';
import { act, openModal, register } from './voice/registry';
import { speakable } from './voice/speech';
export const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();

/** Окно настольного приложения (Tauri), а не браузер. */
export const IN_APP = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
/** Что делать, когда сервисы не отвечают: в приложении они запускаются вместе с окном, в браузере — отдельно. */
export const SERVICES_HINT = IN_APP
  ? 'сервисы запускаются вместе с окном приложения — если они не отвечают, перезапустите приложение'
  : 'запуск: npm run dev:services или ./scripts/start-local.sh';

/** Сообщение (ошибка, предупреждение) — диалогом внутри страницы: системный alert в настольном окне не показывается. */
export function say(message: string): Promise<void> {
  return inFrame ? Promise.resolve() : dialog(message, { ok: 'ОК', alone: true }).then(() => undefined);
}

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

/**
 * Выбор из нескольких действий (кнопки слева направо, последнее — основное): номер выбранного или null (отмена).
 */
export function chooseAsync(message: string, actions: { label: string; danger?: boolean }[], cancel = 'Отмена'): Promise<number | null> {
  return dialog(message, { cancel, actions }).then((r) => (typeof r === 'number' ? r : null));
}

/** Диалог: с input — возвращает введённую строку или false (отмена); без — true / false; с actions — номер действия. */
function dialog(message: string, o: { ok?: string; cancel?: string; danger?: boolean; input?: string; actions?: { label: string; danger?: boolean }[]; alone?: boolean }): Promise<string | boolean | number> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'confirm-back';
    const box = document.createElement('div');
    box.className = 'confirm-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('data-modal', ''); // окно: панель голоса его не закрывает
    const p = document.createElement('p');
    p.textContent = message;
    const row = document.createElement('div');
    row.className = 'confirm-row';
    const no = document.createElement('button');
    no.textContent = o.cancel ?? 'Отмена';
    const yes = document.createElement('button');
    yes.className = o.danger ? 'danger' : 'primary';
    yes.textContent = o.ok ?? 'Да';
    const extra = (o.actions ?? []).map((a, i) => {
      const b = document.createElement('button');
      b.className = a.danger ? 'danger' : i === o.actions!.length - 1 ? 'primary' : '';
      b.textContent = a.label;
      return b;
    });
    if (extra.length) row.append(no, ...extra); else if (o.alone) row.append(yes); else row.append(no, yes);
    const inp = o.input != null ? document.createElement(/\n/.test(o.input) ? 'textarea' : 'input') : null;
    if (inp) { inp.value = o.input!; inp.className = 'confirm-input'; }
    box.append(...(inp ? [p, inp, row] : [p, row]));
    back.append(box);
    let offVoice = () => {};
    const finish = (out: string | boolean | number) => {
      offVoice();
      window.removeEventListener('keydown', key, true);
      back.remove();
      resolve(out);
    };
    // кнопки и клавиши — те же действия, что голосом (dialog.answer)
    const answer = (choice: string) => { void act('dialog.answer', { choice }); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(o.alone ? 'понятно' : 'нет'); }
      // Enter — основная кнопка: «да» / последний вариант / поле ввода — «готово»
      else if (e.key === 'Enter' && !(e.shiftKey && inp)) { e.preventDefault(); e.stopPropagation(); answer(inp ? 'готово' : extra.length ? String(extra.length) : 'да'); }
    };
    no.onclick = () => answer('нет');
    yes.onclick = () => answer('да');
    extra.forEach((b, i) => { b.onclick = () => answer(String(i + 1)); });
    back.onclick = (e) => { if (e.target === back) answer('нет'); };
    window.addEventListener('keydown', key, true);
    document.body.append(back);
    offVoice = voiceDialog({
      message, ok: o.ok, cancel: o.cancel, alone: o.alone, labels: o.actions?.map((a) => a.label), dangers: o.actions?.map((a) => !!a.danger), danger: o.danger,
      input: inp ? { get: () => inp.value, set: (v) => { inp.value = v; } } : undefined,
    }, (out) => finish(out));
    if (inp) { inp.focus(); inp.select(); } else (extra[extra.length - 1] ?? yes).focus();
  });
}

/** Окно для голоса: что спрошено и как отвечать. labels — варианты chooseAsync, input — поле askText. */
export interface DialogVoice {
  message: string;
  ok?: string;
  cancel?: string;
  alone?: boolean;
  labels?: string[];
  /** Опасные варианты (по номеру labels) и опасное «да» (danger у confirmAsync): поверх речи — только переспрос. */
  dangers?: boolean[];
  danger?: boolean;
  input?: { get(): string; set(s: string): void };
}

/** Сообщение (одна кнопка) закрывают этими словами. */
const ACK = /^(?:понятно|ясно|хорошо|понял|поняла|принято|ладно|да|ок|окей|дальше|закрой|закрыть|закрой окно)$/;
/** Предупреждения, которые нельзя пропустить при чтении длинного вопроса частями. */
const WARN = /нельзя отменить|отменить нельзя|не(?:льзя)? будет вернуть|безвозвратно|будут (?:стёрты|стерты|удалены|потеряны)/i;
/**
 * Чтение окна: сначала вопрос (фразы до первой с «?»; её нет — первая фраза) и предупреждения, потом как отвечать
 * (options), потом пояснения, в конце — «Жду ответа.»: отвечают, едва услышав варианты, — пояснения можно перебить.
 * Всего больше четырёх фраз — пояснения не читаются сразу, а по «дальше».
 */
function questionRead(message: string, options: string): string {
  const all = readParts(message).join(' ');
  const sentences = (all.match(/[^.!?…]+[.!?…]+["»]?|[^.!?…]+$/g) ?? []).map((x) => x.trim()).filter(Boolean);
  const q = sentences.findIndex((x) => /\?["»]?$/.test(x));
  // вступление (первая фраза) и сам вопрос — где бы он ни стоял; прочее — пояснения
  const head = q > 0 ? [0, q] : [0];
  const lead = head.filter((i) => i < sentences.length).map((i) => sentences[i]).map((x) => (/[.!?…:]["»]?$/.test(x) ? x : `${x}.`));
  const rest = sentences.filter((_, i) => !head.includes(i));
  const warn = rest.filter((x) => WARN.test(x));
  const other = rest.filter((x) => !WARN.test(x));
  if (sentences.length <= 4 || !other.length) return [...lead, ...warn, options, ...other, WAIT_SAY].join(' ');
  queueReading(other.join(' ')); // «дальше» — пояснения частями (read.next)
  return [...lead, ...warn, options, 'Подробнее — скажите «дальше».', WAIT_SAY].join(' ');
}

const ORDS = ['первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Окна, открытые голосу (стопкой: отвечает верхнее); временные действия — пока есть хоть одно. */
const stack: { answer(choice: string): string | void; text(t: string): string }[] = [];
let offActions: (() => void) | null = null;

/**
 * Окно голосу: штаб зачитывает вопрос и варианты; ответ — `dialog.answer {choice}` («да», «нет», «второй», название
 * варианта), для поля — `dialog.text {text}` (диктовка) и «готово». finish — как у окна (true / false / номер /
 * строка); после ответа окно снимается само. Возвращает снятие (повторное — без действия).
 */
export function voiceDialog(d: DialogVoice, finish: (out: string | boolean | number) => void): () => void {
  const labels = d.labels ?? [];
  const cancel = (d.cancel ?? 'Отмена').toLowerCase();
  // как отвечать; во фразах вопрос кончается «Жду ответа.», а не словом-ответом (иначе быстрый ответ сервис принял бы за эхо)
  const how = labels.length
    ? `Варианты: ${labels.map((l, i) => `${ORDS[i] ?? `номер ${i + 1}`} — «${l}»`).join(', ')}. Или «${cancel}».`
    : d.input ? `${d.input.get() ? `Сейчас записано: «${d.input.get()}». ` : ''}Продиктуйте текст, затем скажите «готово».`
      : d.alone ? 'Скажите «понятно».'
        : d.ok && !/^(?:да|ок)$/i.test(d.ok) ? `Скажите «да» — «${d.ok}», или «нет».` : 'Скажите «да» или «нет».';
  const options = `${how} ${WAIT_SAY}`;
  // напоминание, если ответа нет (сообщение с одной кнопкой не напоминает)
  const remind = labels.length ? `Какой вариант? Скажите номер или «${cancel}». ${WAIT_SAY}`
    : d.input ? `Продиктуйте текст или скажите «готово». ${WAIT_SAY}` : d.alone ? undefined : REMIND_YES_NO;
  let closed = false;
  let closeModal = () => {};
  const self = {
    answer(choice: string): string | void {
      const yn = yesNo(choice);
      if (d.alone) return ACK.test(choice) || yn === 'yes' ? end(true) : `Скажите «понятно». ${WAIT_SAY}`;
      if (yn === 'no') return end(false);
      if (labels.length) {
        let i = ordinalIndex(choice, labels.length);
        if (i === null) { const hit = pickByName(choice, labels); if (hit.length === 1) i = hit[0]; }
        if (i !== null && i >= 0 && i < labels.length) return end(i);
        return `Такого варианта нет. ${options}`;
      }
      if (yn === 'yes' || /^(?:готово|все|записывай|сохрани)$/.test(choice)) return end(d.input ? d.input.get() : true);
      return `${d.input ? 'Скажите «готово» или «отмена».' : 'Скажите «да» или «нет».'} ${WAIT_SAY}`;
    },
    text(t: string): string {
      if (!d.input) return 'Здесь нечего диктовать.';
      d.input.set(t);
      return t ? `Записал: «${t}». Скажите «готово» или продиктуйте заново.` : 'Стёр. Продиктуйте текст.';
    },
  };
  function end(out: string | boolean | number): void { off(); finish(out); }
  function off(): void {
    if (closed) return;
    closed = true;
    stopReading();
    const i = stack.lastIndexOf(self);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length) { offActions?.(); offActions = null; }
    closeModal();
  }
  stack.push(self);
  if (!offActions) {
    const top = () => stack[stack.length - 1];
    const base = { section: 'global', available: () => (stack.length ? true as const : 'вопросов нет') };
    const offs = [
      register({ ...base, id: 'dialog.answer', title: 'Ответить на вопрос', describe: 'Отвечает на открытый вопрос: да, нет или вариант.',
        params: { type: 'object', properties: { choice: { type: 'string' } }, required: ['choice'] },
        run: async (p: { choice: string }) => top()?.answer(String(p?.choice ?? '').toLowerCase().trim()) }),
      register({ ...base, id: 'dialog.text', title: 'Продиктовать ответ', describe: 'Записывает продиктованный текст в поле открытого вопроса.',
        params: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        run: async (p: { text: string }) => top()?.text(String(p?.text ?? '')) }),
    ];
    offActions = () => offs.forEach((o) => o());
  }
  /** Номер варианта, названного ответом (нет — null). */
  const choiceOf = (rest: string): number | null => {
    const i = ordinalIndex(rest, labels.length);
    if (i !== null) return i;
    const hit = pickByName(rest, labels);
    return hit.length === 1 ? hit[0] : null;
  };
  const danger = (rest: string): boolean => {
    if (yesNo(rest) === 'no') return false;
    if (labels.length) { const i = choiceOf(rest); return i !== null && !!d.dangers?.[i]; }
    return !!d.danger && !d.input && !d.alone && yesNo(rest) === 'yes';
  };
  const isAnswer = (rest: string): boolean => {
    if (d.alone) return ACK.test(rest);
    if (d.input) return yesNo(rest) !== null || /^(?:готово|все|записывай|сохрани)$/.test(rest);
    if (labels.length) return yesNo(rest) === 'no' || ordinalIndex(rest, labels.length) !== null || pickByName(rest, labels).length === 1;
    return yesNo(rest) !== null;
  };
  closeModal = openModal({
    question: speakable(d.message),
    read: questionRead(d.message, how),
    ...(remind ? { remind } : {}),
    ...(d.alone ? {} : { how: labels.length ? `номер варианта или «${cancel}»` : d.input ? 'продиктуйте текст или «готово»' : '«да» или «нет»' }),
    isAnswer,
    danger,
    // сообщение с одной кнопкой: посторонняя команда закрывает его и исполняется (не теряется)
    ...(d.alone ? { dismiss: () => end(true) } : {}),
    parse: (rest) => {
      if (d.input) {
        if (yesNo(rest) || /^(?:готово|все|записывай|сохрани)$/.test(rest)) return { id: 'dialog.answer', params: { choice: rest } };
        if (/^(?:очисти|сотри)$/.test(rest)) return { id: 'dialog.text', params: { text: '' } };
        const add = /^(?:допиши|добавь) (.+)$/.exec(rest);
        if (add) { const cur = d.input.get().trim(); return { id: 'dialog.text', params: { text: cur ? `${cur} ${add[1]}` : cap(add[1]) } }; }
        const w = /^(?:напиши|введи|запиши|впиши) (.+)$/.exec(rest);
        return { id: 'dialog.text', params: { text: cap(w ? w[1] : rest) } };
      }
      if (d.alone) return ACK.test(rest) ? { id: 'dialog.answer', params: { choice: rest } } : null;
      if (labels.length) return { id: 'dialog.answer', params: { choice: rest } };
      return yesNo(rest) ? { id: 'dialog.answer', params: { choice: rest } } : null;
    },
  });
  return off;
}
