import { describe, expect, it } from 'vitest';
import { GpuHandoff } from '../src/expo/gpu-handoff';

describe('GPU handoff', () => {
  it('постоянный профиль сохраняет обе модели во всех циклах LLM/TTS', async () => {
    const calls: string[] = [];
    const gpu = new GpuHandoff({ managed: () => false, model: () => 'bonsai',
      resource: async op => { calls.push(`tts:${op}`); },
      fetcher: async url => { calls.push(url); throw new Error('постоянный режим не должен переключать модели'); },
    });
    for (const voice of ['chief-10s', 'zhukov-14s', 'konev-12s']) {
      await gpu.llm(); await gpu.tts(voice); await gpu.idle();
    }
    expect(calls).toEqual([]);
    expect(gpu.chatModel()).toBeUndefined(); // основной выбор ИИ остаётся у вызывающего кода
  });
  it('unloads only the selected instance and verifies it before loading TTS', async () => {
    const calls: string[] = [];
    let loaded = true;
    const fetcher = async (url: string, init?: RequestInit) => {
      const path = url.split('/').pop()!;
      calls.push(path + (init?.body ? ':' + init.body : ''));
      if (path === 'unload') loaded = false;
      return new Response(JSON.stringify(path === 'models' ? { models: [
        { key: 'chosen', type: 'llm', loaded_instances: loaded ? [{ id: 'alias' }] : [] },
        { key: 'other', type: 'llm', loaded_instances: [{ id: 'other-id' }] },
      ] } : {}), { status: 200 });
    };
    const gpu = new GpuHandoff({ managed: () => true, model: () => 'alias', resource: async (op) => { calls.push('tts:' + op); }, fetcher });
    await gpu.tts('voice');
    expect(calls).toEqual(['models', 'unload:{"instance_id":"alias"}', 'models', 'tts:load']);
  });
  it('does not load a rival after unload failure', async () => {
    const calls: string[] = [];
    const gpu = new GpuHandoff({ managed: () => true, model: () => 'chosen', resource: async (op) => { calls.push(op); }, fetcher: async (url) => {
      if (url.endsWith('/unload')) return new Response('', { status: 500 });
      return Response.json({ models: [{ key: 'chosen', type: 'llm', loaded_instances: [{ id: 'x' }] }] });
    } });
    await expect(gpu.tts('voice')).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

it('serializes parallel transitions and waits for a cancelled native load before the next operation', async () => {
  const calls: string[] = [];
  let release!: () => void;
  let loaded = false;
  let signalLoad!: () => void;
  const started = new Promise<void>(resolve => { signalLoad = resolve; });
  const gpu = new GpuHandoff({ managed: () => true, model: () => 'chosen', resource: async (op) => { calls.push('tts:' + op); }, fetcher: async (url) => {
    if (url.endsWith('/load')) { calls.push('load'); signalLoad(); await new Promise<void>(r => { release = r; }); loaded = true; return Response.json({ instance_id: 'x' }); }
    if (url.endsWith('/unload')) { calls.push('unload'); loaded = false; return Response.json({}); }
    return Response.json({ models: [{ key: 'chosen', type: 'llm', loaded_instances: loaded ? [{ id: 'x' }] : [] }] });
  } });
  const first = gpu.llm();
  await started;
  expect(calls).toEqual(['tts:unload', 'load']);
  gpu.cancel();
  const second = gpu.tts('voice');
  await Promise.resolve();
  expect(calls).toEqual(['tts:unload', 'load']);
  release();
  await expect(first).rejects.toThrow();
  await second;
  expect(calls).toEqual(['tts:unload', 'load', 'unload', 'tts:load']);
});

it('does not unload other instances of the same model key', async () => {
  const calls: string[] = [];
  let ids = ['chosen', 'other-alias'];
  const gpu = new GpuHandoff({ managed: () => true, model: () => 'chosen', resource: async () => {}, fetcher: async (url, init) => {
    if (url.endsWith('/unload')) { const id = JSON.parse(String(init?.body)).instance_id; calls.push(id); ids = ids.filter(x => x !== id); }
    return Response.json(url.endsWith('/models') ? { models: [{ key: 'chosen', type: 'llm', loaded_instances: ids.map(id => ({ id })) }] } : {});
  } });
  await gpu.tts('voice');
  expect(calls).toEqual(['chosen']);
});

it('uses the new exact instance after reloading a selected alias', async () => {
  let ids = ['old-alias'];
  const gpu = new GpuHandoff({ managed: () => true, model: () => 'old-alias', resource: async () => {}, fetcher: async (url) => {
    if (url.endsWith('/unload')) { ids = []; return Response.json({}); }
    if (url.endsWith('/load')) { ids = ['new-instance']; return Response.json({ instance_id: 'new-instance' }); }
    return Response.json({ models: [{ key: 'chosen', type: 'llm', loaded_instances: ids.map(id => ({ id })) }] });
  } });
  await gpu.tts('voice');
  await gpu.llm();
  expect(gpu.chatModel()).toBe('new-instance');
  await gpu.tts('voice');
  expect(ids).toEqual([]);
});

function switchingFixture(startLoaded: boolean) {
  let selected = 'A';
  const residents = new Set(startLoaded ? ['A-instance', 'other-instance'] : ['other-instance']);
  const events: string[] = [];
  let release!: () => void;
  let signalLoad!: () => void;
  const started = new Promise<void>(resolve => { signalLoad = resolve; });
  let delayLoad = false;
  const gpu = new GpuHandoff({ managed: () => true, model: () => selected, resource: async op => { events.push(`tts:${op}`); if (op === 'load') expect(residents.has('A-instance')).toBe(false); }, fetcher: async (url, init) => {
    if (url.endsWith('/load')) {
      const body = JSON.parse(String(init?.body)); events.push(`load:${body.model}`);
      signalLoad();
      if (delayLoad) await new Promise<void>(r => { release = r; });
      residents.add(`${body.model}-instance`);
      return Response.json({ instance_id: `${body.model}-instance` });
    }
    if (url.endsWith('/unload')) { const id = JSON.parse(String(init?.body)).instance_id; events.push(`unload:${id}`); residents.delete(id); return Response.json({}); }
    return Response.json({ models: ['A', 'B', 'other'].map(key => ({ key, type: 'llm', loaded_instances: residents.has(`${key}-instance`) ? [{ id: `${key}-instance` }] : [] })) });
  } });
  return { gpu, residents, events, started, select: (s: string) => { selected = s; }, delay: () => { delayLoad = true; }, release: () => release() };
}

it('unloads the instance loaded for A when the setting changes during its native load', async () => {
  const f = switchingFixture(false); f.delay();
  const pending = f.gpu.llm();
  await f.started;
  expect(f.events).toContain('load:A');
  f.select('B'); f.release();
  await pending;
  await f.gpu.tts('voice');
  expect(f.events).toContain('unload:A-instance');
  expect(f.residents).toEqual(new Set(['other-instance']));
});

it('unloads owned A before loading B after a change following preload', async () => {
  const f = switchingFixture(true);
  await f.gpu.llm(); f.select('B'); await f.gpu.llm();
  expect(f.events.indexOf('unload:A-instance')).toBeLessThan(f.events.indexOf('load:B'));
  expect(f.residents).toEqual(new Set(['B-instance', 'other-instance']));
});

it('restores supported live load configuration for the same canonical model', async () => {
  let loaded = true;
  let loadBody: Record<string, unknown> | undefined;
  const gpu = new GpuHandoff({ managed: () => true, model: () => 'A', resource: async () => {}, fetcher: async (url, init) => {
    if (url.endsWith('/unload')) { loaded = false; return Response.json({}); }
    if (url.endsWith('/load')) { loadBody = JSON.parse(String(init?.body)); loaded = true; return Response.json({ instance_id: 'A' }); }
    return Response.json({ models: [{ key: 'A', type: 'llm', loaded_instances: loaded ? [{ id: 'A', config: { context_length: 4096, eval_batch_size: 512, flash_attention: true, offload_kv_cache_to_gpu: false, parallel: 1 } }] : [] }] });
  } });
  await gpu.tts('voice'); await gpu.llm();
  expect(loadBody).toEqual({ model: 'A', context_length: 4096, eval_batch_size: 512, flash_attention: true, offload_kv_cache_to_gpu: false });
});

it('does not unload the new setting on a repeated TTS request after releasing owned A', async () => {
  const f = switchingFixture(true);
  await f.gpu.llm();
  f.select('B'); f.residents.add('B-instance');
  await f.gpu.tts('voice');
  await f.gpu.tts('voice');
  expect(f.events).not.toContain('unload:B-instance');
  expect(f.residents).toContain('B-instance');
});

it('keeps ownership after failed unload and refuses rival TTS', async () => {
  let fail = true;
  const calls: string[] = [];
  const gpu = new GpuHandoff({ managed: () => true, model: () => 'A', resource: async op => { calls.push('tts:' + op); }, fetcher: async url => {
    if (url.endsWith('/unload')) { calls.push('unload'); if (fail) return new Response('', { status: 500 }); return Response.json({}); }
    return Response.json({ models: [{ key: 'A', type: 'llm', loaded_instances: fail ? [{ id: 'A' }] : [] }] });
  } });
  await gpu.llm();
  await expect(gpu.tts('voice')).rejects.toThrow();
  expect(calls).not.toContain('tts:load');
  fail = false;
  await gpu.tts('voice');
  expect(calls.at(-1)).toBe('tts:load');
});

it('blocks rival TTS when native load disconnects before its outcome is known', async () => {
  const events: string[] = [];
  let nativeLoading = false;
  const gpu = new GpuHandoff({ managed: () => true, model: () => 'A', resource: async op => { events.push(`tts:${op}`); }, fetcher: async url => {
    if (url.endsWith('/load')) { nativeLoading = true; throw new Error('connection reset'); }
    return Response.json({ models: [{ key: 'A', type: 'llm', loaded_instances: [] }] });
  } });
  await expect(gpu.llm()).rejects.toThrow('connection reset');
  expect(nativeLoading).toBe(true);
  gpu.cancel();
  await expect(gpu.tts('voice')).rejects.toThrow('Перезапустите LM Studio');
  await expect(gpu.llm()).rejects.toThrow('Перезапустите LM Studio');
  expect(events).toEqual(['tts:unload']);
});

it('не объявляет GPU свободным после потери ответа native load', async () => {
  const gpu = new GpuHandoff({ managed: () => true, model: () => 'A', resource: async () => {}, fetcher: async url => {
    if (url.endsWith('/load')) throw new Error('connection reset');
    return Response.json({ models: [{ key: 'A', type: 'llm', loaded_instances: [] }] });
  } });
  await expect(gpu.llm()).rejects.toThrow();
  await expect(gpu.idle()).rejects.toThrow('Перезапустите LM Studio');
});

it('не объявляет GPU свободным после потери ответа голосовой службы', async () => {
  const gpu = new GpuHandoff({ managed: () => true, model: () => 'A', resource: async () => { throw new Error('нет связи'); } });
  await expect(gpu.llm()).rejects.toThrow();
  await expect(gpu.idle()).rejects.toThrow();
});
