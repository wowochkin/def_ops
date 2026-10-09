import { describe, expect, it } from 'vitest';
import { loadTheatre } from '../src/data';
import { roadNet, visualPath } from '../src/roadnet';
import { Theatre } from '../src/theatre';

describe('показ движения по улицам', () => {
  const T = new Theatre(loadTheatre('berlin-city-1945'));
  const net = roadNet(T);

  it('граф улиц связный: перекрёстки достроены из пересечений линий', () => {
    const comp = new Int32Array(net.nodes.length).fill(-1);
    let biggest = 0;
    for (let s = 0, c = 0; s < net.nodes.length; s++, c++) {
      if (comp[s] >= 0) continue;
      let k = 0; const st = [s]; comp[s] = c;
      while (st.length) { const i = st.pop()!; k++; for (const e of net.adj[i]) if (comp[e.to] < 0) { comp[e.to] = c; st.push(e.to); } }
      biggest = Math.max(biggest, k);
    }
    expect(biggest / net.nodes.length).toBeGreaterThan(0.9);
  });

  it('ход напрямик через кварталы показывается улицами: точки на улицах, концы — как в расчёте', () => {
    const a = T.area('B_Alexanderplatz')!.center, b = T.area('B_Friedrichshain')!.center;
    const v = visualPath(T, [a, b]);
    expect(v[0]).toEqual(a);
    expect(v[v.length - 1]).toEqual(b);
    const inner = v.slice(2, -2);
    expect(inner.length).toBeGreaterThan(2);
    const on = inner.filter((p) => net.snap(T.proj.toXY(p), 0.03)).length;
    expect(on / inner.length).toBeGreaterThan(0.9);
  });
});
