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
    local, setLocalMaps, all, current: all.find((b) => b.id === id) ?? null,
  };
}
