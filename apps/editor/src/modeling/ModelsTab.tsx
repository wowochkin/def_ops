/**
 * «Модели»: наборы правил арбитра (встроенные и свои), профили сторон, языковые модели по ролям. У набора —
 * откуда он (базовый, калибровка: по какой операции, мерило до и после, множители), параметры по группам
 * словами, где используется; свои — скачать, удалить, взять в настройку.
 */
import { useMemo, useState } from 'react';
import { CALIB_INFO, describeProfile, describeRules, rulesOrigin, type CalibKey, type ParamRow } from '@def-ops/sim';
import { deleteRules } from '../sim/userdata';
import { ModelPicker } from '../ModelPicker';
import { ModelSelect } from '../ui';
import type { Llm } from '../shared';
import { download, pct, type SimData } from './data';

function Params({ rows }: { rows: ParamRow[] }) {
  const groups = [...new Set(rows.map((r) => r.group))];
  return <div className="mdl-params">{groups.map((g) => (
    <div key={g}><h4>{g}</h4><table><tbody>{rows.filter((r) => r.group === g).map((r) => (
      <tr key={r.key}><th>{r.title}</th><td><b>{r.value}</b><small>{r.hint}</small></td></tr>
    ))}</tbody></table></div>
  ))}</div>;
}

export function ModelsTab({ d, llm, onTune, onCompare }: { d: SimData; llm: Llm; onTune: (rulesId: string) => void; onCompare: (scenario: string, rules: string[]) => void }) {
  const [sel, setSel] = useState<string>('rules:ww2-berlin-cal');
  const [kind, id] = sel.split(':') as ['rules' | 'profile' | 'llm', string];
  const item = kind === 'rules' ? d.rules.find((r) => r.id === id) : undefined;
  const profile = kind === 'profile' ? d.profiles.find((p) => p.id === id) : undefined;
  const usedIn = useMemo(() => d.catalog.filter((c) => c.rules.some((r) => r.id === id)), [d.catalog, id]);
  const origin = item ? rulesOrigin(item.rules) : null;
  return (
    <div className="mdl-split">
      <aside className="mdl-list">
        <h4>Правила арбитра</h4>
        {d.rules.map((r) => <button key={r.id} className={sel === `rules:${r.id}` ? 'on' : ''} onClick={() => setSel(`rules:${r.id}`)}>
          <b>{r.title}</b><small>{r.id}{r.user ? ' · свой' : ''}{r.rules.calibration ? ' · откалиброван' : ''}</small></button>)}
        <h4>Профили сторон</h4>
        {d.profiles.map((p) => <button key={p.id} className={sel === `profile:${p.id}` ? 'on' : ''} onClick={() => setSel(`profile:${p.id}`)}><b>{p.name}</b><small>{p.id}</small></button>)}
        <h4>Языковые модели</h4>
        <button className={kind === 'llm' ? 'on' : ''} onClick={() => setSel('llm:roles')}><b>Модели по ролям</b><small>штаб противника, советник, разбор, знания</small></button>
      </aside>
      <main className="mdl-main">
        {item && origin && <>
          <div className="mdl-h"><div><h3>{item.title}</h3><span className="muted">{item.id}{item.user ? ` · свой набор от ${item.saved?.created.slice(0, 10)}` : ' · встроенный'}</span></div>
            <div className="mdl-acts">
              <button onClick={() => onTune(item.id)}>{item.user ? 'Править' : 'Сделать свой вариант'}</button>
              {usedIn[0] && <button onClick={() => onCompare(usedIn[0].id, [...new Set([item.id, ...usedIn[0].rules.map((r) => r.id)])].slice(0, 4))}>Сравнить на «{usedIn[0].title.split(',')[0]}»</button>}
              <button onClick={() => download(`${item.id}.json`, JSON.stringify(item.rules, null, 2))}>JSON</button>
              {item.user && <button className="danger" onClick={() => { if (confirm(`Удалить набор «${item.title}»?`)) void deleteRules(item.id).then(() => setSel('rules:ww2-berlin-cal')); }}>Удалить</button>}
            </div></div>
          {(item.saved?.note || origin.status) && <p className="mdl-note">{item.saved?.note || origin.status}</p>}
          {origin.extends && <p className="muted">Поверх набора «{origin.extends}»: поля этого файла переписывают базовые.</p>}
          {origin.calibration && <section className="mdl-card">
            <h4>Калибровка по истории</h4>
            <p>Операция <b>{origin.calibration.scenario}</b>, {origin.calibration.date}; от набора «{origin.calibration.from}», вариантов перебрано: {origin.calibration.evals}.</p>
            <table className="mdl-tbl"><thead><tr><th>Мерило</th><th>до</th><th>после</th></tr></thead><tbody>
              <tr><td>Отклонение положений, обучение, км</td><td>{origin.calibration.before.trainKm}</td><td><b>{origin.calibration.after.trainKm}</b></td></tr>
              <tr><td>Отклонение положений, проверка, км</td><td>{origin.calibration.before.testKm}</td><td><b>{origin.calibration.after.testKm}</b></td></tr>
              <tr><td>Ошибка дат событий, сут</td><td>{origin.calibration.before.eventsDays}</td><td><b>{origin.calibration.after.eventsDays}</b></td></tr>
              <tr><td>Положений в допуске</td><td>{pct(origin.calibration.before.within)}</td><td><b>{pct(origin.calibration.after.within)}</b></td></tr>
            </tbody></table>
            <div className="mdl-mult">{Object.entries(origin.calibration.multipliers).map(([k, v]) => <span key={k} title={CALIB_INFO[k as CalibKey]?.hint}>{CALIB_INFO[k as CalibKey]?.title ?? k}: <b>{v}</b></span>)}</div>
          </section>}
          <p className="muted">Используется в переигровке: {usedIn.length ? usedIn.map((c) => c.title).join('; ') : 'нигде (только в сравнении и настройке)'}.</p>
          <Params rows={describeRules(item.rules)} />
        </>}
        {profile && <>
          <div className="mdl-h"><div><h3>{profile.name}</h3><span className="muted">{profile.id} · профиль стороны: эпоха, оргштатная структура, управление, тыл</span></div>
            <div className="mdl-acts"><button onClick={() => download(`${profile.id}.json`, JSON.stringify(profile, null, 2))}>JSON</button></div></div>
          <p className="mdl-note">Профиль задаёт то, что зависит от армии и эпохи и не подбирается калибровкой: вес людей, танков и орудий в боевом потенциале, качество войск по типам, темпы марша, сроки доведения приказов, подвоз и наводку переправ. Правила арбитра общие для обеих сторон.</p>
          <Params rows={describeProfile(profile)} />
        </>}
        {kind === 'llm' && <>
          <div className="mdl-h"><div><h3>Языковые модели по ролям</h3><span className="muted">LM Studio на этом компьютере</span></div></div>
          <p className="mdl-note">Модели участвуют в переигровке в четырёх ролях. Арбитр (правила выше) считает последствия; языковые модели только принимают решения и пишут тексты, числа боя они не меняют. Исключение — посредник: он даёт ограниченные поправки ×0,8–1,25 к ожидаемым боям, со ссылкой на базу знаний.</p>
          <section className="mdl-card mdl-roles">
            <label><b>Штаб противника и посредник</b><small>решения стороны модели на каждый ход; поправки к боям</small>
              <ModelSelect value={llm.settings.model} onChange={(model) => llm.set({ model })} check={llm.check} empty="первая загруженная" /></label>
            <label className="row"><input type="checkbox" checked={!!llm.settings.umpire} onChange={(e) => llm.set({ umpire: e.target.checked })} /> посредник на модели (поправки к боям по базе знаний)</label>
            <div><b>Советник командующего</b><small>ответы и варианты решения на ход</small><ModelPicker llm={llm} who="adv" purpose="советника" /></div>
            <div><b>Разбор операции</b><small>отчётный документ после игры</small><ModelPicker llm={llm} who="rev" purpose="разбора" /></div>
            <div><b>База знаний</b><small>ответы, лекции, разбор документов</small><ModelPicker llm={llm} who="kb" purpose="базы знаний" /></div>
          </section>
          <p className="muted">Связь с сервером и модель эмбеддингов — в разделах «ИИ» и «Знания».</p>
        </>}
      </main>
    </div>
  );
}
