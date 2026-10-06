/**
 * Слои: подсказка слоя для пресета, упорядочивание объектов для отрисовки,
 * операции над слоями и миграция документов старых версий.
 */
import type { Feature, Layer, LayerRole, MapDocument } from './model';
import { defaultLayers, newId } from './model';

/** В какой слой по смыслу попадает знак, созданный из пресета. */
export function roleForPreset(kind: Feature['kind'], preset = ''): LayerRole {
  const p = preset.toLowerCase();
  // подписи и населённые пункты — поверх обстановки (кроме подписей противника — они в его слое)
  if (/enemy/.test(p)) return 'enemy';
  if (kind === 'label' || /settlement|\.town$/.test(p)) return 'labels';
  if (/river|rail|lake|block|citycenter/.test(p)) return 'base';
  if (/german|counter|retreat|defense|fortification|encircled|destroyed|reserve|fortcity|pennant|ditch|strongpoint/.test(p)) return 'enemy';
  if (/front(15|19|25|dresden|edge)|meetline|\.pos/.test(p)) return 'front';
  return 'friendly';
}

/** Слой для нового объекта: явно заданный, иначе первый слой подходящей роли, иначе верхний доступный. */
export function pickLayer(doc: MapDocument, kind: Feature['kind'], preset?: string, explicit?: string | null): string {
  const usable = (l: Layer) => !l.locked && !l.source?.readOnly;
  if (explicit) {
    const l = doc.layers.find((x) => x.id === explicit);
    if (l && usable(l)) return l.id;
  }
  const role = roleForPreset(kind, preset);
  const byRole = doc.layers.find((l) => l.role === role && usable(l));
  if (byRole) return byRole.id;
  const any = [...doc.layers].reverse().find(usable);
  return any ? any.id : ensureLayer(doc, 'custom').id;
}

function ensureLayer(doc: MapDocument, role: LayerRole): Layer {
  const l: Layer = { id: newId('l'), name: 'Слой', role, visible: true, locked: false, opacity: 1 };
  doc.layers.push(l);
  return l;
}

/** Объекты в порядке отрисовки: по слоям (снизу вверх), внутри слоя — по порядку в документе. */
export function orderedFeatures(doc: MapDocument): { layer: Layer; features: Feature[] }[] {
  const groups = new Map<string, Feature[]>(doc.layers.map((l) => [l.id, []]));
  const fallback = doc.layers[doc.layers.length - 1]?.id;
  for (const f of doc.features) (groups.get(f.layerId) ?? (fallback ? groups.get(fallback) : undefined))?.push(f);
  return doc.layers.map((layer) => ({ layer, features: groups.get(layer.id) ?? [] }));
}

export function layerOf(doc: MapDocument, f: Feature): Layer | undefined {
  return doc.layers.find((l) => l.id === f.layerId);
}

/** Можно ли сейчас видеть / править объект с учётом его слоя. */
export function isFeatureVisible(doc: MapDocument, f: Feature): boolean {
  const l = layerOf(doc, f);
  return !f.hidden && (l ? l.visible : true);
}
export function isFeatureEditable(doc: MapDocument, f: Feature): boolean {
  const l = layerOf(doc, f);
  return isFeatureVisible(doc, f) && !f.locked && !(l && (l.locked || l.source?.readOnly));
}

/* ------------------------- операции над слоями ------------------------- */

export function addLayer(doc: MapDocument, p: Partial<Layer> = {}, aboveId?: string): { doc: MapDocument; layer: Layer } {
  const layer: Layer = { id: newId('l'), name: 'Новый слой', role: 'custom', visible: true, locked: false, opacity: 1, ...p };
  const layers = doc.layers.slice();
  const i = aboveId ? layers.findIndex((l) => l.id === aboveId) : -1;
  layers.splice(i >= 0 ? i + 1 : layers.length, 0, layer);
  return { doc: { ...doc, layers }, layer };
}

export function updateLayer(doc: MapDocument, id: string, p: Partial<Layer>): MapDocument {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, ...p, id } : l)) };
}

/** Удалить слой; его объекты переносятся в moveTo или удаляются. */
export function removeLayer(doc: MapDocument, id: string, moveTo?: string | null): MapDocument {
  const layers = doc.layers.filter((l) => l.id !== id);
  if (!layers.length) return doc; // последний слой не удаляем
  const removedIds = new Set(doc.features.filter((f) => f.layerId === id).map((f) => f.id));
  let features: Feature[];
  if (moveTo && layers.some((l) => l.id === moveTo)) {
    features = doc.features.map((f) => (f.layerId === id ? { ...f, layerId: moveTo } : f));
  } else {
    features = doc.features
      .filter((f) => f.layerId !== id)
      .map((f) => (f.kind === 'arrow' && f.anchor && removedIds.has(f.anchor.featureId) ? { ...f, anchor: null } : f));
  }
  return { ...doc, layers, features };
}

/** Сдвинуть слой в порядке отрисовки: +1 — выше, −1 — ниже. */
export function moveLayer(doc: MapDocument, id: string, delta: number): MapDocument {
  const layers = doc.layers.slice();
  const i = layers.findIndex((l) => l.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= layers.length) return doc;
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...doc, layers };
}

export function setFeatureLayer(doc: MapDocument, featureId: string, layerId: string): MapDocument {
  if (!doc.layers.some((l) => l.id === layerId)) return doc;
  // объект переносится в конец целевого слоя (поверх его объектов)
  const f = doc.features.find((x) => x.id === featureId);
  if (!f) return doc;
  const rest = doc.features.filter((x) => x.id !== featureId);
  return { ...doc, features: [...rest, { ...f, layerId }] };
}

/** Показать только один слой (или вернуть все, если он уже единственный видимый). */
export function soloLayer(doc: MapDocument, id: string): MapDocument {
  const onlyThis = doc.layers.every((l) => l.visible === (l.id === id));
  return { ...doc, layers: doc.layers.map((l) => ({ ...l, visible: onlyThis ? true : l.id === id })) };
}

/* ------------------------------ миграция ------------------------------ */

/**
 * Приводит документ любой поддерживаемой версии к текущей.
 * v1 → v2: появились слои; объекты раскладываются по слоям по смыслу пресета.
 */
export function migrateDocument(input: unknown): MapDocument {
  if (!input || typeof input !== 'object') throw new Error('Документ должен быть объектом');
  const d = structuredClone(input) as Record<string, unknown> & Partial<MapDocument>;
  if (!Array.isArray(d.features)) throw new Error('В документе нет списка объектов');
  const v = Number(d.version ?? 1);
  if (v > 2) throw new Error(`Версия документа ${v} новее поддерживаемой (2)`);
  if (!Array.isArray(d.layers) || !d.layers.length) d.layers = defaultLayers();
  if (!Array.isArray(d.overlays)) d.overlays = [];
  const doc = d as unknown as MapDocument;
  const ids = new Set(doc.layers.map((l) => l.id));
  for (const f of doc.features) {
    if (!f.layerId || !ids.has(f.layerId)) f.layerId = pickLayer(doc, f.kind, f.preset);
  }
  doc.version = 2;
  return doc;
}
