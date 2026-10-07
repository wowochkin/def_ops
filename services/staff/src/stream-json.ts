/**
 * Разбор ответа модели на лету: элементы массива (например, orders) выдаются
 * по одному, как только объект элемента закрыт, — не дожидаясь конца ответа.
 * Так приказ уходит в движок через секунды после того, как модель его дописала.
 *
 * Работает по сырому потоку текста: учитывает строки и экранирование, ищет
 * ключ "<key>": [ и выдаёт каждый закрытый объект верхнего уровня этого массива.
 * Текст до JSON (размышление, ```json) пропускается.
 */
export class ArrayItemStream<T = unknown> {
  private buf = '';
  private pos = 0;
  /** Где начинается массив (индекс после «[»), −1 — ещё не найден. */
  private arrayStart = -1;
  private itemStart = -1;
  private depth = 0;
  private inStr = false;
  private esc = false;
  private closed = false;
  readonly items: T[] = [];

  constructor(private readonly key: string, private readonly onItem: (item: T, index: number) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    if (this.closed) return;
    if (this.arrayStart < 0) {
      const m = new RegExp(`"${this.key}"\\s*:\\s*\\[`).exec(this.buf);
      if (!m) return;
      this.arrayStart = this.pos = m.index + m[0].length;
    }
    for (; this.pos < this.buf.length; this.pos++) {
      const c = this.buf[this.pos];
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === '\\') this.esc = true;
        else if (c === '"') this.inStr = false;
        continue;
      }
      if (c === '"') { this.inStr = true; continue; }
      if (c === '{') { if (this.depth === 0) this.itemStart = this.pos; this.depth++; continue; }
      if (c === '}') {
        this.depth--;
        if (this.depth === 0 && this.itemStart >= 0) {
          const text = this.buf.slice(this.itemStart, this.pos + 1);
          this.itemStart = -1;
          try {
            const item = JSON.parse(text) as T;
            this.items.push(item);
            this.onItem(item, this.items.length - 1);
          } catch { /* битый элемент — пропускаем, итоговая проверка покажет */ }
        }
        continue;
      }
      if (c === ']' && this.depth === 0) { this.closed = true; this.pos++; return; }
    }
  }
}
