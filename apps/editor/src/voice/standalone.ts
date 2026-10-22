/**
 * Голос без голосового управления: диктовка в поле (кнопка микрофона) и чтение текста вслух — независимо от того,
 * включено ли управление голосом, дежурит ли штаб и есть ли вообще голосовой сервис.
 *
 * Чем: сервис голоса на связи (настольное приложение на Mac) — его распознавание и синтез (панель голоса ставит
 * провайдера, `setServiceVoice`); нет — средства окна: распознавание речи браузера (SpeechRecognition, если есть) и
 * синтез речи (speechSynthesis). Ни того ни другого — кнопка микрофона недоступна с объяснением.
 */

export interface DictateOpts {
  /** Текст по мере распознавания (final — реплика закончена). */
  onText(text: string, final: boolean): void;
  /** Диктовка закончилась (err — почему не вышло). */
  onEnd(err?: string): void;
}

/** Голос сервиса (ставит панель голоса, пока сервис на связи). */
export interface ServiceVoice {
  /** Одна реплика с микрофона — мимо разбора команд; микрофон открывается и на время диктовки, если управление выключено. */
  dictate(o: DictateOpts): () => void;
  /** Сказать текст голосом начальника штаба (звук выключен — молчит); возвращает «остановить». */
  say(text: string): () => void;
}

let service: ServiceVoice | null = null;
const subs = new Set<() => void>();
export function setServiceVoice(v: ServiceVoice | null): void { service = v; subs.forEach((f) => f()); }
export function onVoiceChange(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }

type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
const recCtor = (): (new () => Rec) | null => {
  const w = (typeof window !== 'undefined' ? window : {}) as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Можно ли диктовать: true или почему нельзя. */
export function dictateReady(): true | string {
  if (service || recCtor()) return true;
  return 'Распознавания речи нет: нужен голосовой сервис (настольное приложение на Mac) или браузер с распознаванием речи (Chrome, Safari).';
}

const REC_ERR: Record<string, string> = {
  'not-allowed': 'нет доступа к микрофону — разрешите его в настройках', 'service-not-allowed': 'распознавание речи запрещено в этом окне',
  'no-speech': 'речь не услышана', 'audio-capture': 'микрофон не найден', network: 'распознавание браузера недоступно без сети',
};

/** Продиктовать одну реплику; возвращает «остановить». */
export function dictate(o: DictateOpts): () => void {
  if (service) return service.dictate(o);
  const C = recCtor();
  if (!C) { o.onEnd(dictateReady() as string); return () => {}; }
  const r = new C();
  r.lang = 'ru-RU'; r.interimResults = true; r.continuous = false;
  let done = false, last = '';
  const end = (err?: string) => { if (!done) { done = true; o.onEnd(err); } };
  r.onresult = (e) => {
    const res = Array.from(e.results);
    last = res.map((x) => x[0]?.transcript ?? '').join(' ').trim();
    o.onText(last, res.every((x) => x.isFinal));
  };
  r.onerror = (e) => end(REC_ERR[e.error] ?? `распознавание: ${e.error}`);
  r.onend = () => end(last ? undefined : 'речь не услышана');
  try { r.start(); } catch (e) { end(String((e as Error).message ?? e)); }
  return () => { try { r.stop(); } catch { /* */ } };
}

/** Текст для чтения: без разметки и ссылок. */
export const plainSpeech = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_#>`]+/g, ' ').replace(/^\s*[-•]\s*/gm, '').replace(/\s+/g, ' ').trim();

/** Прочитать вслух; возвращает «остановить». Ни сервиса, ни синтеза окна — молча. */
export function sayAloud(text: string): () => void {
  const t = plainSpeech(text);
  if (!t) return () => {};
  if (service) return service.say(t);
  const ss = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!ss) return () => {};
  ss.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = 'ru-RU';
  const ru = ss.getVoices().find((v) => v.lang.toLowerCase().startsWith('ru'));
  if (ru) u.voice = ru;
  ss.speak(u);
  return () => ss.cancel();
}

/** Читать вслух умеем (сервис или синтез окна). */
export const canSayAloud = (): boolean => !!service || (typeof window !== 'undefined' && !!window.speechSynthesis);
