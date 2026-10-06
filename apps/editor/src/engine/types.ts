/**
 * Адаптер картографического движка.
 *
 * Редактор не зависит от конкретной библиотеки карт: всё, что ему нужно, —
 * перевод координат, вид, события указателя, подложка и растровые наложения.
 * Чтобы подключить другую карту (OpenLayers, Leaflet, Cesium, ведомственную ГИС),
 * достаточно реализовать этот интерфейс и зарегистрировать фабрику в registry.ts.
 *
 * Соглашение о масштабе: zoom — уровень Web Mercator с тайлом 512 px
 * (как в MapLibre/Mapbox). Движки с тайлом 256 px (Leaflet, OpenLayers)
 * передают zoom − 1. Поворот (bearing) — в градусах по часовой стрелке.
 */
import type { ImageOverlay, LngLat, Vec2 } from '@def-ops/core';

export interface ViewState {
  center: LngLat;
  zoom: number;
  bearing: number;
}

export interface PointerInfo {
  lngLat: LngLat;
  /** Экранная точка относительно контейнера карты. */
  point: Vec2;
  altKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
}

/** Растровая подложка из тайлов XYZ (в т. ч. WMS через шаблон {bbox-epsg-3857}). */
export interface BasemapSpec {
  id: string;
  name: string;
  tiles: string[];
  tileSize?: number;
  attribution?: string;
  maxzoom?: number;
}

export interface MapEngineEvents {
  /** Вид изменился (панорама, зум, поворот, размер). */
  view: () => void;
  click: (e: PointerInfo) => void;
  dblclick: (e: PointerInfo) => void;
  move: (e: PointerInfo) => void;
  ready: () => void;
}

export interface MapEngine {
  readonly id: string;
  project(ll: LngLat): Vec2;
  unproject(p: Vec2): LngLat;
  getView(): ViewState;
  setView(v: Partial<ViewState>): void;
  size(): { width: number; height: number };
  getContainer(): HTMLElement;
  setPaper(color: string): void;
  setBasemap(spec: BasemapSpec | null, opacity: number): void;
  setOverlays(list: ImageOverlay[]): void;
  /** Включить/выключить перетаскивание карты мышью (на время правки знаков). */
  setPanEnabled(on: boolean): void;
  on<K extends keyof MapEngineEvents>(ev: K, cb: MapEngineEvents[K]): () => void;
  destroy(): void;
}

export interface EngineOptions {
  view: ViewState;
  paper: string;
  basemap: BasemapSpec | null;
  basemapOpacity: number;
}

export type EngineFactory = (container: HTMLElement, opts: EngineOptions) => MapEngine;
