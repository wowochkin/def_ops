/** Справочник библиотеки условных знаков: категории, описания, варианты по стилям, свои/противник. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../demo/fonts';
import './library.css';
import { CATEGORIES, LIBRARY, STYLES, SOURCES, variantFor, searchLibrary, sourceText, type StyleId } from '@def-ops/core';
import { presetPreview } from './previews';
import { paperFor } from './Palette';

const PRINT = new URLSearchParams(location.search).has('print');
if (PRINT) document.documentElement.classList.add('print');

function LibraryPage() {
  const [style, setStyle] = useState<StyleId>('rkka');
  const [q, setQ] = useState('');
  const found = new Set(searchLibrary(q).map((e) => e.id));
  const verifyCount = LIBRARY.filter((e) => e.verify).length;
  return (
    <div className="lib">
      {PRINT && (
        <div className="title-page">
          <div className="tp-kicker">Платформа тактических карт</div>
          <h1 className="tp-title">Библиотека условных знаков</h1>
          <div className="tp-sub">Справочник: {LIBRARY.length} элементов, {CATEGORIES.length} категорий, {STYLES.length} стилей оформления, {LIBRARY.filter((e) => e.sources).length} знаков со ссылкой на первоисточник</div>
          <ol className="tp-toc">{CATEGORIES.map((c) => <li key={c.id}>{c.name} <span className="muted">— {LIBRARY.filter((e) => e.category === c.id).length}</span></li>)}</ol>
          <div className="tp-legend">
            <p><b>Цвета.</b> РККА: свои — красным, противник — синим, сооружения и заграждения — чёрным. СА: мотострелковые, танковые войска, ВДВ, авиация — красным; артиллерия, инженерные, химические войска и связь — чёрным; противник — синим; маршруты — коричневым. Для знаков с отметкой «свои / противник» приведены оба варианта.</p>
            <p><b>Стили.</b> {STYLES.map((s) => `${s.name} — ${s.description}`).join(' ')}</p>
            <p><b>Первоисточники.</b></p>
            <ol className="tp-src">{SOURCES.map((s) => <li key={s.id}><b>{s.short}</b> — {s.title}</li>)}</ol>
            <p><b>Пометка «сверить».</b> {verifyCount} знаков не подтверждены этими источниками (знаки исторических карт, флот, партизаны, разграничительные линии армий и фронтов) — их нужно сверить с таблицей, принятой для проекта.</p>
            <p className="muted">Сформировано {new Date().toLocaleDateString('ru-RU')} из описания библиотеки (packages/core/src/library.ts).</p>
          </div>
        </div>
      )}
      <header>
        <h1>Библиотека условных знаков</h1>
        <p className="lead">
          {LIBRARY.length} элементов в {CATEGORIES.length} категориях. Уставные знаки — в двух системах: РККА 1942–45
          (по TM 30-430, гл. XII) и Советской Армии 1967–83 (по «Основным условным обозначениям» и таблице А. Веремеева);
          у каждого знака указаны источник и страница. Знаки с пометкой <span className="vf">сверить</span> ({verifyCount})
          источниками не подтверждены.
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
                    {PRINT && STYLES.filter((s) => e.variants[s.id] && s.id !== v.style).length > 0 && (
                      <div className="pv-alt">
                        {STYLES.filter((s) => e.variants[s.id] && s.id !== v.style).map((s) => (
                          <figure key={s.id}>
                            <span dangerouslySetInnerHTML={{ __html: presetPreview(e.kind, e.variants[s.id]!, paperFor(s.id), e.sideAware ? 'own' : undefined) }} />
                            <figcaption>{s.name}</figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                    <div className="nm">{e.name}{e.verify && <span className="vf" title="Начертание не подтверждено первоисточниками">сверить</span>}</div>
                    <div className="ds">{e.description}</div>
                    {e.sources && <div className="src">Источник: {sourceText(e.sources)}</div>}
                    <div className="vr">
                      {STYLES.filter((s) => e.variants[s.id]).map((s) => <span key={s.id} className={s.id === v.style ? 'cur' : ''}>{s.name}</span>)}
                      {e.sideAware && <span className="side">свои / противник</span>}
                      {v.style !== style && !PRINT && <span className="muted">нет в стиле «{STYLES.find((s) => s.id === style)!.name}» — показан ближайший</span>}
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
