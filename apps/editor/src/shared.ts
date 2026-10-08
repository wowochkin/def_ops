/**
 * Общее для разделов приложения: подложки (выбор, прозрачность, офлайн, свои и
 * локальные карты) и доступность сервера. Живут в оболочке, чтобы редактор,
 * переигровка и раздел «Карты» видели одно и то же.
 */
import { useEffect, useMemo, useState } from 'react';
import type { MapSource } from '@def-ops/core';
import { DefOpsClient } from '@def-ops/api-client';
import type { BasemapSpec } from './engine/types';
import { BUILTIN_BASEMAPS, loadCustomBasemaps, saveCustomBasemaps } from './engine/basemaps';
import { cartography } from './MapsPanel';
import type { LlmSettings } from './sim/game-protocol';

export const api = new DefOpsClient({ baseUrl: '/api', apiKey: localStorage.getItem('def_ops.apiKey') || undefined, sourceSystem: 'editor' });

export type ServerState = { status: 'unknown' | 'online' | 'offline'; services?: Record<string, string> };

export function useServer(): ServerState {
  const [server, setServer] = useState<ServerState>({ status: 'unknown' });
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const h = await api.health();
      if (alive) setServer(h ? { status: 'online', services: h.services } : { status: 'offline' });
    };
    check();
    const t = setInterval(check, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return server;
}

export interface Basemaps {
  id: string; setId: (id: string) => void;
  opacity: number; setOpacity: (v: number) => void;
  offline: boolean; setOffline: (v: boolean) => void;
  custom: BasemapSpec[]; addCustom: (b: BasemapSpec) => void;
  local: BasemapSpec[]; setLocalMaps: (m: MapSource[]) => void;
  /** Локальные карты с метаданными (охват, детальность, год) — для автоподстановки. */
  localMeta: MapSource[];
  /** Доступные сейчас (локальные + интернет, если не офлайн) и выбранная. */
  all: BasemapSpec[]; current: BasemapSpec | null;
}

export function useBasemaps(): Basemaps {
  const [id, setId] = useState<string>(() => localStorage.getItem('def_ops.basemap') || 'none');
  const [custom, setCustom] = useState<BasemapSpec[]>(loadCustomBasemaps);
  const [opacity, setOpacity] = useState(0.55);
  const [offline, setOfflineState] = useState(() => localStorage.getItem('def_ops.offline') === '1');
  const [localMaps, setLocalMaps] = useState<MapSource[]>([]);
  const local: BasemapSpec[] = useMemo(() => localMaps.map((m) => ({
    id: `local-${m.id}`, name: `${m.name}${m.date ? ` (${m.date})` : ''}`, tiles: [cartography.tileTemplate(m)], tileSize: m.tileSize,
    attribution: m.attribution, maxzoom: m.maxzoom,
  })), [localMaps]);
  const all = useMemo(() => [...local, ...(offline ? [] : [...BUILTIN_BASEMAPS, ...custom])], [local, custom, offline]);
  useEffect(() => { try { localStorage.setItem('def_ops.basemap', id); } catch { /* */ } }, [id]);
  // локальные карты подгружаются из сервиса картографии (если он есть)
  useEffect(() => { cartography.list().then(setLocalMaps).catch(() => {}); }, []);
  return {
    id, setId, opacity, setOpacity, offline,
    setOffline: (v) => { setOfflineState(v); try { localStorage.setItem('def_ops.offline', v ? '1' : '0'); } catch { /* */ } if (v && !id.startsWith('local-')) setId('none'); },
    custom, addCustom: (b) => { const l = [...custom, b]; setCustom(l); saveCustomBasemaps(l); setId(b.id); },
    local, setLocalMaps, localMeta: localMaps, all, current: all.find((b) => b.id === id) ?? null,
  };
}

/* ───────────── локальная модель штаба (LM Studio) ───────────── */

export const LLM_DEFAULTS: LlmSettings = { url: '/llm/v1', model: '', thinking: 'off' };

export function loadLlm(): LlmSettings {
  try { return { ...LLM_DEFAULTS, ...JSON.parse(localStorage.getItem('def_ops.llm') || '{}') }; } catch { return LLM_DEFAULTS; }
}

/** models — модели для ответов; embedModels — модели эмбеддингов (в названии embed), для смыслового поиска по базе знаний. */
export type LlmCheck = { state: 'unknown' | 'checking' } | { state: 'ok'; models: string[]; embedModels: string[] } | { state: 'fail'; error: string };

/** Проверить связь с сервером модели: список загруженных моделей. */
export async function checkLlm(url: string): Promise<LlmCheck> {
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { state: 'fail', error: `сервер ответил ${r.status}` };
    const j = (await r.json()) as { data?: { id: string }[] };
    const all = (j.data ?? []).map((m) => m.id);
    const models = all.filter((m) => !/embed/i.test(m));
    return models.length ? { state: 'ok', models, embedModels: all.filter((m) => /embed/i.test(m)) } : { state: 'fail', error: 'на сервере не загружена ни одна модель' };
  } catch (e) {
    return { state: 'fail', error: (e as Error).name === 'TimeoutError' ? 'сервер не отвечает' : (e as Error).message };
  }
}

export interface Llm { settings: LlmSettings; set: (p: Partial<LlmSettings>) => void; check: LlmCheck; recheck: () => void }

export function useLlm(): Llm {
  const [settings, setSettings] = useState<LlmSettings>(loadLlm);
  const [check, setCheck] = useState<LlmCheck>({ state: 'unknown' });
  const recheck = () => { setCheck({ state: 'checking' }); checkLlm(settings.url).then(setCheck); };
  useEffect(recheck, [settings.url]); // eslint-disable-line react-hooks/exhaustive-deps
  // модели загружают в другом приложении — список перечитывается при возврате в окно
  useEffect(() => { const f = () => checkLlm(settings.url).then(setCheck); window.addEventListener('focus', f); return () => window.removeEventListener('focus', f); }, [settings.url]);
  return {
    settings, check, recheck,
    set: (p) => { const s = { ...settings, ...p }; setSettings(s); try { localStorage.setItem('def_ops.llm', JSON.stringify(s)); } catch { /* */ } },
  };
}

/* ───────────── автоподстановка подложки для участка ───────────── */

type BBox = [number, number, number, number];
const area = (b: BBox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlap = (a: BBox, b: BBox) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
const year = (d?: string | null) => (d ? Number(/(1[89]\d\d|20\d\d)/.exec(d)?.[1] ?? NaN) : NaN);

/**
 * Подложка для участка: локальная карта, покрывающая его (не меньше 70 % площади) и достаточно
 * детальная для его масштаба — из таких ближе по году к операции (историческая), затем крупнее
 * масштабом (меньше охват листа); нет таких — из интернета: для города — OpenStreetMap, для
 * местности — топографическая; офлайн — без подложки.
 */
export function pickBasemap(bm: Basemaps, bbox: BBox, zoom: number, opYear: number): { id: string; why: string } {
  const cands = bm.localMeta.filter((m) => overlap(m.bounds as BBox, bbox) >= 0.7 * area(bbox) && m.maxzoom >= Math.min(zoom, 14) - 1)
    .map((m) => ({ m, dy: Number.isFinite(year(m.date)) ? Math.abs(year(m.date) - opYear) : 50, a: area(m.bounds as BBox) }))
    .sort((x, y) => x.dy - y.dy || x.a - y.a);
  if (cands.length) return { id: `local-${cands[0].m.id}`, why: `локальная карта: ${cands[0].m.name}${cands[0].m.date ? ` (${cands[0].m.date})` : ''}` };
  if (bm.offline) return { id: bm.id.startsWith('local-') ? bm.id : 'none', why: 'офлайн: подходящей локальной карты нет' };
  return zoom >= 12 ? { id: 'osm', why: 'город — OpenStreetMap (подходящей локальной карты нет)' } : { id: 'topo', why: 'местность — топографическая карта (подходящей локальной карты нет)' };
}
