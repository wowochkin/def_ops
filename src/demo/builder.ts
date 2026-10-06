/** Построитель сцен в экранных координатах (для демо-карт и каталога знаков). */
import { makeProjection, type LngLat, type Projection } from '../core/geo';
import type { Feature, MapDocument, ArrowFeature } from '../core/model';
import { emptyDocument } from '../core/model';
import { createFeature } from '../core/factory';
import type { PresetKind } from '../core/presets';
import { createContext } from '../core/render/index';

type XY = [number, number];

export class SceneBuilder {
  doc: MapDocument;
  proj: Projection;
  ll: (p: XY) => LngLat;
  /** toLL — пересчёт координат сцены в географию (по умолчанию — мировые пиксели документа). */
  constructor(center: LngLat = [13.4, 52.5], zoom = 7.4, paper?: string, toLL?: (p: XY) => LngLat) {
    this.doc = emptyDocument(center, zoom);
    if (paper) this.doc.paper = paper;
    this.proj = makeProjection(center, zoom);
    this.ll = toLL ?? ((p: XY): LngLat => this.proj.toLngLat(p));
  }
  private add<T extends Feature>(f: T, patch?: (f: T) => void): T {
    patch?.(f);
    this.doc.features.push(f);
    return f;
  }
  arrow(preset: string, pts: XY[], patch?: (f: ArrowFeature) => void) {
    return this.add(createFeature('arrow', preset, { points: pts.map(this.ll) }) as ArrowFeature, patch);
  }
  /** Стрелка, хвост которой привязан к линии/контуру (ближайшая точка к первой точке). */
  anchored(preset: string, target: Feature, pts: XY[], patch?: (f: ArrowFeature) => void) {
    const f = this.arrow(preset, pts, patch);
    const ctx = createContext(this.doc);
    const path = ctx.featurePath(target.id)!;
    const n = path.nearest(this.proj.toWorld(this.ll(pts[0])));
    f.anchor = { featureId: target.id, t: n.s / path.length };
    return f;
  }
  feature(kind: PresetKind, preset: string, pts: XY[], patch?: (f: any) => void) {
    return this.add(createFeature(kind, preset, { points: pts.map(this.ll) }), patch);
  }
  line(preset: string, pts: XY[], patch?: (f: any) => void) { return this.feature('line', preset, pts, patch); }
  area(preset: string, pts: XY[], patch?: (f: any) => void) { return this.feature('area', preset, pts, patch); }
  symbol(preset: string, at: XY, patch?: (f: any) => void) {
    return this.add(createFeature('symbol', preset, { at: this.ll(at) }), patch);
  }
  label(preset: string, at: XY, text: string, patch?: (f: any) => void) {
    return this.add(createFeature('label', preset, { at: this.ll(at), text }), patch);
  }
}
