/** Справочник библиотеки условных знаков: категории, описания, варианты по стилям, свои/противник. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../demo/fonts';
import './library.css';
import { CATEGORIES, LIBRARY, STYLES, variantFor, searchLibrary, type StyleId } from '@def-ops/core';
import { presetPreview } from './previews';
import { paperFor } from './Palette';

function LibraryPage() {
  const [style, setStyle] = useState<StyleId>('ustav');
  const [q, setQ] = useState('');
  const found = new Set(searchLibrary(q).map((e) => e.id));
  const verifyCount = LIBRARY.filter((e) => e.verify).length;
  return (
    <div className="lib">
      <header>
        <h1>Библиотека условных знаков</h1>
        <p className="lead">
          {LIBRARY.length} элементов в {CATEGORIES.length} категориях. Цвета по уставу: свои — красным, противник — синим,
          сооружения и заграждения — чёрным. Знаки с пометкой <span className="vf">сверить</span> ({verifyCount}) имели варианты
          начертания в разные годы — их нужно сверить с таблицей условных знаков, принятой для проекта.
        </p>
        <div className="ctl">
          {STYLES.map((s) => (
            <button key={s.id} className={s.id === style ? 'on' : ''} title={s.description} onClick={() => setStyle(s.id)}>{s.name}</button>
          ))}
          <input placeholder="Поиск: танк, мост, котёл, катюша…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </header>
      <nav>{CATEGORIES.map((c) => <a key={c.id} href={`#${c.id}`}>{c.name}</a>)}</nav>
      {CATEGORIES.map((c) => {
        const items = LIBRARY.filter((e) => e.category === c.id && found.has(e.id));
        if (!items.length) return null;
        return (
          <section key={c.id} id={c.id}>
            <h2>{c.name} <span className="muted">· {items.length}</span></h2>
            <p className="cdesc">{c.description}</p>
            <div className="grid">
              {items.map((e) => {
                const v = variantFor(e, style);
                const paper = paperFor(v.style);
                return (
                  <div key={e.id} className={`card${v.style !== style ? ' other' : ''}`}>
                    <div className="pv">
                      <span dangerouslySetInnerHTML={{ __html: presetPreview(e.kind, v.preset, paper, e.sideAware ? 'own' : undefined, true) }} />
                      {e.sideAware && <span dangerouslySetInnerHTML={{ __html: presetPreview(e.kind, v.preset, paper, 'enemy', true) }} />}
                    </div>
                    <div className="nm">{e.name}{e.verify && <span className="vf" title="Начертание требует сверки с первоисточником">сверить</span>}</div>
                    <div className="ds">{e.description}</div>
                    <div className="vr">
                      {STYLES.filter((s) => e.variants[s.id]).map((s) => <span key={s.id} className={s.id === v.style ? 'cur' : ''}>{s.name}</span>)}
                      {e.sideAware && <span className="side">свои / противник</span>}
                      {v.style !== style && <span className="muted">нет в стиле «{STYLES.find((s) => s.id === style)!.name}» — показан ближайший</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<LibraryPage />);
document.fonts.ready.then(() => document.body.setAttribute('data-ready', '1'));
