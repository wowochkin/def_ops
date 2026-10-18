/**
 * Сохранение файлов игры (журнал .md, разбор PDF или .md, запись игры .json) — кнопкой и голосом одинаково.
 *
 * Настольное приложение: в папку «Загрузки» без окна выбора — окно отдаёт файл шлюзу приложения (POST /api/save?name=…),
 * шлюз пишет его в «Загрузки» (имя занято — «имя (2).md») и отвечает путём. Браузер: файл отдаётся браузеру ссылкой;
 * куда сохранить, решает браузер — если он спросит, это делается мышью (так штаб и говорит).
 */

export type Saved = { ok: true; where: 'downloads'; path: string } | { ok: true; where: 'browser' } | { ok: false; error: string };
/** Куда сохранять (тесты подменяют): путь в «Загрузках» или 'browser' — файл отдан браузеру. */
export type Saver = (name: string, data: Blob) => Promise<{ path: string } | 'browser'>;

let saver: Saver | null = null;
/** Подменить сохранение (тесты); null — как обычно. */
export function setSaver(s: Saver | null): void { saver = s; }

/** Окно настольного приложения (Tauri), а не браузер. */
const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Отдать файл браузеру ссылкой (имя файла сохраняется во всех браузерах). */
function browserDownload(name: string, data: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Настольное приложение: файл — шлюзу, он пишет его в «Загрузки»; адреса нет (шлюз не из запускателя) — null. */
async function toDownloads(name: string, data: Blob, f: typeof fetch): Promise<{ path: string } | null> {
  const r = await f(`/api/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: data, headers: { 'Content-Type': data.type || 'application/octet-stream' } });
  if (r.status === 404) return null;
  const j = (await r.json().catch(() => ({}))) as { path?: string; error?: { message?: string } };
  if (!r.ok || !j.path) throw new Error(j.error?.message ?? `шлюз ответил ${r.status}`);
  return { path: j.path };
}

/** Сохранить файл: в приложении — в «Загрузки», в браузере — через браузер. Не вышло — причина. */
export async function saveFile(name: string, data: Blob, o: { inApp?: boolean; download?: (name: string, data: Blob) => void; fetch?: typeof fetch } = {}): Promise<Saved> {
  try {
    let r: { path: string } | 'browser' | null = null;
    if (saver) r = await saver(name, data);
    else if (o.inApp ?? inApp()) r = await toDownloads(name, data, o.fetch ?? fetch);
    // браузер (или приложение без адреса сохранения): файл — браузеру, место выбирает он
    if (!r) { (o.download ?? browserDownload)(name, data); r = 'browser'; }
    return r === 'browser' ? { ok: true, where: 'browser' } : { ok: true, where: 'downloads', path: r.path };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/**
 * Что сказать после сохранения: done — «Разбор сохранён», what — «Разбор» (для браузера и сбоя). Путь — на экран
 * (screen), вслух — только папка: латинские имена файлов на слух не нужны.
 */
export function savedText(r: Saved, done: string, what: string): { say: string; screen: string } {
  if (r.ok && r.where === 'downloads') return { say: `${done} в папку «Загрузки».`, screen: `${done}: ${r.path}` };
  if (r.ok) return { say: `${what}: файл передан браузеру. Если браузер спросит, куда сохранить — это нужно сделать мышью.`, screen: `${what}: файл передан браузеру.` };
  const why = /[A-Za-z]{3}/.test(r.error) ? 'сбой записи, подробности на экране' : r.error.replace(/[.\s]+$/, '');
  return { say: `Сохранить не удалось (${what.toLowerCase()}): ${why}.`, screen: `Сохранить не удалось (${what.toLowerCase()}): ${r.error}` };
}

/** Текст как файл. */
export const textFile = (text: string, type: string) => new Blob([text], { type });
