/** Состояние редактора: документ с историей правок (undo/redo), выделение, инструмент. */
import { useCallback, useReducer } from 'react';
import type { Feature, FeatureKind, MapDocument, Side } from '@def-ops/core';

export type Tool =
  | { mode: 'select' }
  | { mode: 'draw'; kind: FeatureKind; preset: string; element?: string; side?: Side };

interface History {
  past: MapDocument[];
  present: MapDocument;
  future: MapDocument[];
  /** Ключ «склейки» серий мелких правок (перетаскивание, слайдер) в один шаг истории. */
  lastKey: string | null;
}

type Action =
  | { type: 'set'; doc: MapDocument; key?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; doc: MapDocument };

const LIMIT = 200;

function reducer(h: History, a: Action): History {
  switch (a.type) {
    case 'set': {
      if (a.doc === h.present) return h;
      if (a.key && a.key === h.lastKey) return { ...h, present: a.doc, future: [] };
      return { past: [...h.past, h.present].slice(-LIMIT), present: a.doc, future: [], lastKey: a.key ?? null };
    }
    case 'undo': {
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: null };
    }
    case 'redo': {
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastKey: null };
    }
    case 'reset':
      return { past: [], present: a.doc, future: [], lastKey: null };
  }
}

/** Порядок слоёв по умолчанию: районы → стрелки → линии → знаки → надписи. */
const RANK: Record<FeatureKind, number> = { area: 0, arrow: 1, line: 2, symbol: 3, label: 4 };

/** Вставка объекта в его слой: после последнего объекта слоя с рангом не выше (районы под стрелками и т.д.). */
export function insertFeature(doc: MapDocument, f: Feature): MapDocument {
  const feats = doc.features.slice();
  let idx = feats.length;
  for (let i = feats.length - 1; i >= 0; i--) {
    if (feats[i].layerId !== f.layerId) continue;
    if (RANK[feats[i].kind] <= RANK[f.kind]) { idx = i + 1; break; }
    idx = i;
  }
  feats.splice(idx, 0, f);
  return { ...doc, features: feats };
}

export function updateFeature(doc: MapDocument, id: string, fn: (f: Feature) => Feature): MapDocument {
  return { ...doc, features: doc.features.map((f) => (f.id === id ? fn(f) : f)) };
}

export function removeFeature(doc: MapDocument, id: string): MapDocument {
  return {
    ...doc,
    // привязанные к удаляемой линии стрелки отвязываем
    features: doc.features
      .filter((f) => f.id !== id)
      .map((f) => (f.kind === 'arrow' && f.anchor?.featureId === id ? { ...f, anchor: null } : f)),
  };
}

export function useHistory(initial: MapDocument) {
  const [h, dispatch] = useReducer(reducer, { past: [], present: initial, future: [], lastKey: null });
  const set = useCallback((doc: MapDocument, key?: string) => dispatch({ type: 'set', doc, key }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback((doc: MapDocument) => dispatch({ type: 'reset', doc }), []);
  return { doc: h.present, set, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
