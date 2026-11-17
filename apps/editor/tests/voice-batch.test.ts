import { afterEach, expect, it, vi } from 'vitest';
import { VoiceClient } from '../src/voice/client';

function connected(batch = true, temperature = true) {
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const client = new VoiceClient();
  const raw = client as unknown as Record<string, any>;
  const sent: any[] = [];
  raw.ws = { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)), close() {} };
  raw.wsState = 'open';
  const message = (m: unknown) => raw.onMessage(m);
  message({ type: 'ready', voices: [], roles: {}, loaded: true, capabilities: { prepare_batch: batch, tts_temperature: temperature } });
  return { client, raw, sent, message };
}
afterEach(() => vi.unstubAllGlobals());

it('отправляет восемь фраз одним групповым запросом и ждёт оба пакета по четыре', async () => {
  const f = connected();
  const progress: number[][] = [];
  let ready = false;
  const texts = ['а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з'];
  const pending = f.client.prepareBatch('chief', texts, 'marshal', undefined, { temperature: 0, batchSize: 4, onProgress: (done, total) => progress.push([done, total]) }).then(ok => { ready = ok; });
  expect(f.client.supportsPrepareBatch).toBe(true);
  expect(f.sent).toEqual([{ type: 'prepare-batch', id: 1, role: 'chief', texts, voice_id: 'marshal', temperature: 0, batch_size: 4 }]);
  f.message({ type: 'prepared-batch', id: 1, done: 4, total: 8 });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(progress).toEqual([[4, 8]]);
  f.message({ type: 'prepared-batch', id: 1, done: 8, total: 8, audio_s: texts.map(() => 1) });
  await pending;
  expect(ready).toBe(true);
  expect(progress).toEqual([[4, 8], [8, 8]]);
});
it('отмена группы отбрасывает позднюю готовность и не затрагивает следующую группу', async () => {
  const f = connected();
  const abort = new AbortController();
  const progress = vi.fn();
  const first = f.client.prepareBatch('chief', ['а', 'б'], undefined, abort.signal, { onProgress: progress });
  abort.abort();
  expect(await first).toBe(false);
  expect(f.sent.at(-1)).toEqual({ type: 'cancel-prepare-batch', id: 1 });
  const second = f.client.prepareBatch('chief', ['в']);
  f.message({ type: 'prepared-batch', id: 1, done: 2, total: 2 });
  expect(progress).not.toHaveBeenCalled();
  f.message({ type: 'prepared-batch', id: 2, done: 1, total: 1 });
  expect(await second).toBe(true);
});
it('ошибка группы сохраняет причину, разрыв сбрасывает возможность batch и завершает ожидание', async () => {
  const f = connected();
  const first = f.client.prepareBatch('chief', ['а']);
  const failed = expect(first).rejects.toThrow('CUDA memory');
  f.message({ type: 'prepared-batch', id: 1, done: 0, total: 1, error: 'CUDA memory' });
  await failed;
  const next = f.client.prepareBatch('chief', ['б']);
  f.client.close();
  expect(await next).toBe(false);
  expect(f.client.supportsPrepareBatch).toBe(false);
});
it('старый сервис готовит последовательно при0.2 и явно отказывает другой температуре', async () => {
  const f = connected(false, false);
  const pending = f.client.prepareBatch('chief', ['а', 'б'], 'marshal', undefined, { temperature: 0.2, batchSize: 4 });
  expect(f.sent).toEqual([{ type: 'prepare', id: 1, role: 'chief', text: 'а', voice_id: 'marshal' }]);
  f.message({ type: 'prepared', id: 1 });
  await vi.waitFor(() => expect(f.sent).toHaveLength(2));
  expect(f.sent.at(-1)).toEqual({ type: 'prepare', id: 2, role: 'chief', text: 'б', voice_id: 'marshal' });
  f.message({ type: 'prepared', id: 2 });
  expect(await pending).toBe(true);
  await expect(f.client.prepareBatch('chief', ['в'], undefined, undefined, { temperature: 0 })).rejects.toThrow(/температур/i);
  await expect(f.client.prepare('chief', 'в', undefined, undefined, 0.7)).rejects.toThrow(/температур/i);
  expect(() => f.client.say(3, 'chief', 'в', undefined, undefined, 0)).toThrow(/температур/i);
  expect(f.sent).toHaveLength(2);
});
it('температура prepare и say передаётся без потери нуля', async () => {
  const f = connected();
  const pending = f.client.prepare('chief', 'а', 'marshal', undefined, 0);
  f.message({ type: 'prepared', id: 1 });
  expect(await pending).toBe(true);
  f.client.say(5, 'chief', 'а', undefined, 'marshal', 0);
  expect(f.sent).toEqual([
    { type: 'prepare', id: 1, role: 'chief', text: 'а', voice_id: 'marshal', temperature: 0 },
    { type: 'say', id: 5, role: 'chief', text: 'а', voice_id: 'marshal', temperature: 0 },
  ]);
});
it.each([-1, 1.1, NaN, '0.2'])('не отправляет неверную температуру %s', async temperature => {
  const f = connected();
  await expect(f.client.prepareBatch('chief', ['а'], undefined, undefined, { temperature: temperature as number })).rejects.toThrow(/температур/i);
  expect(f.sent).toEqual([]);
});
it('отмена старого последовательного fallback не запускает оставшиеся фразы', async () => {
  const f = connected(false, false);
  const abort = new AbortController();
  const pending = f.client.prepareBatch('chief', ['а', 'б', 'в'], undefined, abort.signal, { temperature: 0.2 });
  abort.abort();
  expect(await pending).toBe(false);
  f.message({ type: 'prepared', id: 1 });
  await Promise.resolve();
  expect(f.sent.map(m => m.type)).toEqual(['prepare', 'cancel-prepare']);
});

it('старый ready после нового подключения не оставляет capability от прежнего сервиса', () => {
  const f = connected();
  expect(f.client.supportsPrepareBatch).toBe(true);
  f.message({ type: 'ready', voices: [], roles: {}, loaded: true });
  expect(f.client.supportsPrepareBatch).toBe(false);
});
it('неверный счётчик группы не даёт ложную готовность', async () => {
  const f = connected();
  const pending = f.client.prepareBatch('chief', ['а', 'б']);
  const failed = expect(pending).rejects.toThrow(/счётчик/i);
  f.message({ type: 'prepared-batch', id: 1, done: 1, total: 1 });
  await failed;
  expect(f.sent.at(-1)).toEqual({ type: 'cancel-prepare-batch', id: 1 });
});

it('CPU-потоки проходят в prepare, batch и say; старый сервис явно отказывает нестандартному выбору', async () => {
  const f = connected();
  f.message({ type:'ready', voices:[], roles:{}, loaded:true, capabilities:{prepare_batch:true,tts_temperature:true,tts_cpu_threads:true} });
  const one = f.client.prepare('chief','Один.','marshal',undefined,0.2,1);
  f.message({type:'prepared',id:1}); expect(await one).toBe(true);
  const group = f.client.prepareBatch('chief',['Два.'],undefined,undefined,{cpuThreads:4});
  f.message({type:'prepared-batch',id:2,done:1,total:1}); expect(await group).toBe(true);
  f.client.say(9,'chief','Один.',undefined,'marshal',0.2,1);
  expect(f.sent.map(m => m.cpu_threads)).toEqual([1,4,1]);
  const old=connected(false,false);
  await expect(old.client.prepare('chief','x',undefined,undefined,0.2,4)).rejects.toThrow(/поток/i);
  expect(old.sent).toEqual([]);
});

it.each([0,3,16,1.5,'2',true,NaN])('не отправляет недопустимое число CPU-потоков %s', async cpuThreads=>{
  const f=connected();
  await expect(f.client.prepareBatch('chief',['x'],undefined,undefined,{cpuThreads:cpuThreads as number})).rejects.toThrow(/поток/i);
  expect(f.sent).toEqual([]);
});
