/** Справочник библиотеки условных знаков: категории, описания, варианты оформления, свои/противник. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../demo/fonts';
import './library.css';
import { CATEGORIES, LIBRARY, STYLES, SOURCES, variantFor, searchLibrary, sourceText, type StyleId } from '@def-ops/core';
import { presetPreview } from './previews';
import { paperFor } from './Palette';
import atlasSample from '../demo/reference/thumbs/berlin-atlas.jpg';
import infSample from '../demo/reference/thumbs/berlin-infographic.jpg';
import tacSample from '../demo/reference/thumbs/reichstag-tactical.jpg';

const SAMPLE_IMG: Partial<Record<StyleId, string>> = { atlas: atlasSample, inf: infSample, tac: tacSample };
/** Знаки-примеры для варианта, у которого нет образца-картинки (уставной). */
const STANDARD_EXAMPLES = ['hq.army', 'hq.division', 'tank.medium', 'dot', 'wire', 'mines.AT'];
/** Строки сравнения: один и тот же элемент во всех вариантах оформления. */
const COMPARE = ['attack.main', 'attack.planned', 'area.encircled', 'label.unit', 'city'];
const byId = new Map(LIBRARY.map((e) => [e.id, e]));

function DesignSection() {
  return (
    <section className="design" id="design">
      <h2>Оформление знаков</h2>
      <p className="cdesc">
        Система знаков в библиотеке одна: каждый элемент — это смысл (что обозначается), привязка к местности,
        принадлежность (свои / противник) и слой карты. Вариант оформления меняет только начертание — форму стрелок,
        толщину и рисунок линий, заливки, значки и шрифты. Поэтому оформление карты можно сменить, не перерисовывая
        обстановку, а знак, которого нет в выбранном оформлении, показывается в ближайшем доступном.
      </p>
      <p className="cdesc">
        Нормативный вариант один — <b>уставные знаки РККА</b>: начертание взято из таблицы знаков и подтверждено
        первоисточником со страницей. Остальные три — <b>не системы условных знаков</b>, а манера оформления,
        воспроизведённая по образцам карт; их начертание определяется образцом, а не уставом.
      </p>
      <div className="dgrid">
        {STYLES.map((st) => (
          <div key={st.id} className="dcard">
            <div className="dhead">
              <b>{st.name}</b>
              <span className={`basis ${st.basis}`}>{st.basis === 'standard' ? 'норматив' : 'по образцу'}</span>
            </div>
            <div className="dbody">
              <div className="dthumb">
                {SAMPLE_IMG[st.id]
                  ? <img src={SAMPLE_IMG[st.id]} alt={`Образец: ${st.name}`} />
                  : <div className="dsigns">{STANDARD_EXAMPLES.map((id) => {
                      const e = byId.get(id)!;
                      return <span key={id} title={e.name} dangerouslySetInnerHTML={{ __html: presetPreview(e.kind, e.variants.rkka!, paperFor('rkka'), 'own', true) }} />;
                    })}</div>}
              </div>
              <div className="dtext">
                <div className="dorig"><b>Откуда:</b> {st.origin}</div>
                <ul>{st.traits.map((t) => <li key={t}>{t}</li>)}</ul>
                <div className="duse"><b>Для чего:</b> {st.use}</div>
                <div className="muted">Элементов в этом оформлении: {LIBRARY.filter((e) => e.variants[st.id]).length}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <h3>Один элемент — разные варианты оформления</h3>
      <table className="dcmp">
        <thead><tr><th>Элемент</th>{STYLES.map((st) => <th key={st.id}>{st.name}</th>)}</tr></thead>
        <tbody>
          {COMPARE.map((id) => {
            const e = byId.get(id)!;
            return (
              <tr key={id}>
                <td>{e.name}</td>
                {STYLES.map((st) => (
                  <td key={st.id}>
                    {e.variants[st.id]
                      ? <span dangerouslySetInnerHTML={{ __html: presetPreview(e.kind, e.variants[st.id]!, paperFor(st.id), e.sideAware ? 'own' : undefined) }} />
                      : <span className="muted">—</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

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
          <div className="tp-sub">Справочник: {LIBRARY.length} элементов, {CATEGORIES.length} категорий, {STYLES.length} варианта оформления, {LIBRARY.filter((e) => e.sources).length} знаков со ссылкой на первоисточник</div>
          <ol className="tp-toc"><li>Оформление знаков</li>{CATEGORIES.map((c) => <li key={c.id}>{c.name} <span className="muted">— {LIBRARY.filter((e) => e.category === c.id).length}</span></li>)}</ol>
          <div className="tp-legend">
            <p><b>Цвета.</b> Свои войска — красным, противник — синим, сооружения, заграждения и топография — чёрным. Для знаков с отметкой «свои / противник» приведены оба варианта.</p>
            <p><b>Оформление.</b> Система знаков одна; варианты оформления меняют только начертание. Нормативный — {STYLES.filter((s) => s.basis === 'standard').map((s) => s.name).join(', ')}; {STYLES.filter((s) => s.basis === 'sample').map((s) => `«${s.name}»`).join(', ')} — манера, воспроизведённая по образцам карт. Подробно — в разделе «Оформление знаков».</p>
            <p><b>Первоисточник.</b></p>
            <ol className="tp-src">{SOURCES.map((s) => <li key={s.id}><b>{s.short}</b> — {s.title}</li>)}</ol>
            <p><b>Пометка «сверить».</b> {verifyCount} знаков не подтверждены первоисточником (знаки исторических карт, флот, партизаны, разграничительные линии армий и фронтов) — их нужно сверить с таблицей, принятой для проекта.</p>
            <p className="muted">Сформировано {new Date().toLocaleDateString('ru-RU')} из описания библиотеки (packages/core/src/library.ts).</p>
          </div>
        </div>
      )}
      <header>
        <h1>Библиотека условных знаков</h1>
        <p className="lead">
          {LIBRARY.length} элементов в {CATEGORIES.length} категориях. Уставные знаки — система РККА 1942–45
          по TM 30-430, гл. XII; у каждого знака указаны источник и страница. Знаки с пометкой <span className="vf">сверить</span> ({verifyCount})
          источниками не подтверждены.
        </p>
        <div className="ctl">
          {STYLES.map((s) => (
            <button key={s.id} className={s.id === style ? 'on' : ''} title={s.description} onClick={() => setStyle(s.id)}>{s.name}</button>
          ))}
          <input placeholder="Поиск: танк, мост, котёл, катюша…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </header>
      <nav><a href="#design">Оформление знаков</a>{CATEGORIES.map((c) => <a key={c.id} href={`#${c.id}`}>{c.name}</a>)}</nav>
      {!q && <DesignSection />}
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
                      {v.style !== style && !PRINT && <span className="muted">нет в оформлении «{STYLES.find((s) => s.id === style)!.name}» — показан ближайший</span>}
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
