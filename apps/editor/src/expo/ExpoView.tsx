/**
 * Вид одного выставочного окна: области по раскладке (`layoutFor`) и сцена текущей фазы. Сцена верстается на холсте
 * 1920×1080 и целиком масштабируется под окно с сохранением пропорций (поля — фон темы), поэтому вёрстка одна
 * при любом размере окна. Управление — только в окне с картой; клавиши — только в профиле «мышь и клавиатура»
 * и не на паузе. Карта и текст занимают разные области холста: на переломе карта слева, решения — колонкой справа.
 * Перелом и итог — по виду модели сеанса (карточки банка, раскрытие решения, три шкалы, ход операции, оценка по осям).
 * Карта — `StageMap` (карта полного режима), один экземпляр на окно: сцена задаёт ей «окно» (`.expo-mapslot`),
 * документ, момент, приказ поверх и кадр камеры. Заставка — переигровка лучшего сеанса дня (или «как было»), ввод —
 * пролёт к полосе фронта, перелом — стрелки подсвеченной карточки и движение армий по ходу ядра, итог — пути армий.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { affordances, keyToEvent } from './input';
import type { DirectorEvent, DirectorState } from './director';
import type { ExpoSettings } from './settings';
import { layoutFor, sceneOf } from './layout';
import { AttractActions, Excursion, FullVersion, HowStaff, StaffBoard, roleLayout } from './stand';
import { FRONT_MARSHALS, FRONT_NAMES, FRONT_TASKS, PhaseTitle, Timer } from './scenes';
import { StageMini } from './StageMini';
import { BRIEFING, briefFeatures } from './briefing';
import { StageMap, type Bbox, type StageMapProps } from './StageMap';
import { Cut, Film, flip } from './film';
import { LENS_EVENT, lensesFor, sameLens, stepLens, type Lens } from './lens';
import { bboxOf, dailyPaths, orderFeatures, pathFeatures } from './stage-doc';
import type { StageDoc, StageDocs } from './stage-maps';
import { historyAt, historyPaths, mainPaths, MAP, type Arrow, type LL } from './map';
import type { ModelFrame } from './model';
import type { CardView } from './session';
import { ModelNote, modelTime, MoveAdvance, OpSummary, Scales, turnDef } from './session-scenes';
import { NO_AI, QUESTIONS, type AiFrame } from './ai-runner';
import { SOURCE_LABEL } from './ai';
import type { FrontId } from './settings';
import { cardCaption, pictureByFile, picturesOf } from './pictures';
import { readRecord, recordLines } from './records';
import './expo.css';
export interface ExpoViewProps {
  window: number;
  state: DirectorState;
  settings: ExpoSettings;
  count: 1 | 2 | 3;
  model?: ModelFrame;
  ai?: AiFrame;
  send: (ev: DirectorEvent) => void;
  /** Документы карты стенда (у главного окна — свои, у прочих — по шине). */
  maps?: StageDocs;
  /** Слои поверх сцены на том же холсте: подготовка стенда, номера экранов. */
  children?: ReactNode;
}
const NO_MODEL: ModelFrame = { view: null, error: null };
export const STAGE = { width: 1920, height: 1080 };

/** Масштаб холста под окно: целиком в окне, пропорции сохранены. */
function useStageScale(): number {
  const fit = () => (typeof innerWidth === 'number' && innerWidth > 0 ? Math.min(innerWidth / STAGE.width, innerHeight / STAGE.height) : 1);
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const on = () => setScale(fit());
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  return scale;
}

/** Кегль текста по месту: с `max` вниз, пока текст не уместится в рамку, но не мельче `min`. */
function useFit<T extends HTMLElement>(key: unknown, max: number, min = 32) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let f = max;
    el.style.fontSize = `${f}px`;
    while (f > min && el.scrollHeight > el.clientHeight + 1) el.style.fontSize = `${(f -= 2)}px`;
  }, [key, max, min]);
  return ref;
}

export function ExpoView({ window: realIndex, state, settings, count: realCount, model = NO_MODEL, ai = NO_AI, maps = {}, send, children }: ExpoViewProps) {
  const mv = model.view;
  const [lens, setLensState] = useState<Lens>(null);
  useEffect(() => {
    const on = (e: Event) => setLensState((e as CustomEvent<Lens>).detail);
    addEventListener(LENS_EVENT, on);
    return () => removeEventListener(LENS_EVENT, on);
  }, []);
  // один монитор: экран многомониторной раскладки во весь монитор
  const single = realCount === 1;
  const count = single && lens ? lens.count : realCount;
  const index = single && lens ? lens.window : realIndex;
  const p = state.phase,
    roles = layoutFor(count).find((s) => s.window === index)?.roles ?? [];
  const controls = roles.includes('map');
  const access = affordances(settings.input, settings.voiceInput, settings.aiMode);
  const scale = useStageScale();
  const [expanded, setExpanded] = useState<number | null>(null),
    [hover, setHover] = useState<number | null>(null),
    [frontIndex, setFrontIndex] = useState(0),
    [asking, setAsking] = useState(false);
  useEffect(() => {
    setExpanded(null);
    setHover(null);
    setAsking(false);
  }, [state.session, p.kind, p.kind === 'turn' ? p.n : 0]);
  useEffect(() => {
    if (!access.keys || state.paused || !(controls || single)) return;
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (single && p.kind !== 'welcome' && p.kind !== 'briefing' && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        setLensState((l) => stepLens(l, e.key === 'ArrowLeft' ? -1 : 1));
        return;
      }
      if (!controls) return;
      if (p.kind === 'welcome' && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        setFrontIndex((i) => (i + (e.key === 'ArrowLeft' ? -1 : 1) + settings.fronts.length) % settings.fronts.length);
        return;
      }
      const ev = keyToEvent(e.key, p, { expanded: expanded ?? hover, front: settings.fronts[frontIndex] ?? settings.fronts[0] });
      if (ev) {
        e.preventDefault();
        send(ev);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [controls, access.keys, state.paused, p, expanded, hover, frontIndex, settings.fronts, send, single]);
  const buttons = controls && p.kind !== 'startup' && p.kind !== 'attract';
  const subtitles = buttons && !(p.kind === 'turn' && roles.includes('ai'));
  const def = p.kind === 'turn' ? turnDef(state.front, p.n) : null;
  const lit = expanded ?? hover;
  const plan = useMemo(() => mapPlan({ state, mv, maps, lit, count, index }), [state.phase, state.front, mv, maps, lit, count, index]); // eslint-disable-line react-hooks/exhaustive-deps
  // сцена без карты: карта скрыта, но не размонтирована — один экземпляр на окно, без пересоздания
  const lastPlan = useRef<StageMapProps>(NO_PLAN);
  if (plan) lastPlan.current = plan;
  const shownPlan = plan ?? { ...lastPlan.current, run: null, fx: null };
  const clock = useRef<HTMLSpanElement | null>(null);
  const onTime = useCallback((t: string) => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-clock]')) flip(el, modelTime(t));
  }, []);
  const mainRef = useRef<HTMLElement>(null);
  const gisRef = useRef<HTMLDivElement>(null);
  /** Размер окна карты: сменился — кадр камеры ставится заново. */
  const [gisSize, setGisSize] = useState('');
  // карта — под «окно» сцены: одна и та же, сцена задаёт только рамку
  useLayoutEffect(() => {
    const main = mainRef.current, gis = gisRef.current;
    if (!main || !gis) return;
    const slot = main.querySelector<HTMLElement>('.expo-mapslot');
    if (!slot || !plan) {
      gis.style.visibility = 'hidden';
      return;
    }
    const m = main.getBoundingClientRect(), r = slot.getBoundingClientRect(), k = m.width / STAGE.width || 1;
    const box = [(r.left - m.left) / k, (r.top - m.top) / k, r.width / k, r.height / k].map((v) => `${Math.round(v)}px`);
    const resized = gis.style.width !== box[2] || gis.style.height !== box[3];
    Object.assign(gis.style, { visibility: 'visible', left: box[0], top: box[1], width: box[2], height: box[3] });
    if (resized) {
      dispatchEvent(new Event('resize'));
      setGisSize(`${box[2]}x${box[3]}`);
    }
  });
  return (
    <div className="expo-stage">
      <main
        ref={mainRef}
        className="expo"
        style={{ ['--expo-target' as string]: `${access.minTarget}px`, ['--expo-scale' as string]: scale, ...(TABLE ? { ['--table' as string]: `url(${TABLE})` } : {}) }}
        data-scene={sceneOf(p)}
        data-phase={p.kind}
        data-count={count}
      >
        <div ref={gisRef} className="expo-gis" aria-hidden="true">
          <div className="expo-gis-in">
            <StageMap {...shownPlan} camera={shownPlan.camera && { ...shownPlan.camera, key: `${shownPlan.camera.key}@${gisSize}` }} onTime={onTime} />
          </div>
        </div>
        <header className="expo-header">
          <span>Штабные игры</span>
          <PhaseTitle state={state} />
          {single ? (
            <span className="expo-lenses" role="group" aria-label="Экраны стенда">
              {lensesFor(lens).map((x) => (
                <button key={x.label} aria-pressed={sameLens(x.lens, lens)} onClick={() => setLensState(x.lens)}>
                  {x.label}
                </button>
              ))}
            </span>
          ) : (
            <span>{`Экран ${index + 1} из ${count}`}</span>
          )}
        </header>
        <div className="expo-content">
          {p.kind === 'startup' && <section className="expo-wide" />}
          {p.kind === 'attract' && (
            <section className="expo-attract-root" onClick={() => send({ t: 'touch' })}>
              {roleLayout(roles) === 'all' && (
                <div className="expo-split expo-attract">
                  <div className="expo-panel expo-intro">
                    <p className="expo-kicker">Апрель 1945. Берлинская операция</p>
                    <h1>
                      Ваш штаб — искусственный интеллект. <span>Приказ — за вами</span>
                    </h1>
                    <p>Выберите фронт и пройдите три перелома операции.</p>
                    <AttractActions voice={state.voice} send={send} />
                    <Newsreel />
                  </div>
                  <div className="expo-replay">
                    <p className="expo-map-date" aria-hidden="true" data-clock />
                    <div className="expo-mapframe">
                      <div className="expo-mapslot" role="img" aria-label="Переигровка Берлинской операции" />
                    </div>
                  </div>
                </div>
              )}
              {roleLayout(roles) === 'map' && (
                <div className="expo-attract-map">
                  <AttractActions voice={state.voice} send={send} />
                  <div className="expo-replay">
                    <p className="expo-map-date" aria-hidden="true" data-clock />
                    <div className="expo-mapframe">
                      <div className="expo-mapslot" role="img" aria-label="Переигровка Берлинской операции" />
                    </div>
                  </div>
                </div>
              )}
              {roleLayout(roles) === 'ai' && <HowStaff foot={<AttractActions voice={state.voice} send={send} />} />}
              {roleLayout(roles) === 'app' && <FullVersion foot={<AttractActions voice={state.voice} send={send} />} />}
              {roleLayout(roles) === 'pair' && (
                <div className="expo-attract-side">
                  <HowStaff />
                  <FullVersion />
                  <AttractActions voice={state.voice} send={send} />
                </div>
              )}
            </section>
          )}
          {p.kind === 'welcome' && (
            <section className="expo-welcome">
              <h1>Выберите фронт</h1>
              <div className="expo-fronts">
                {settings.fronts.map((f) => (
                  <button key={f} aria-pressed={settings.fronts[frontIndex] === f} disabled={!controls} onClick={() => send({ t: 'pickFront', front: f })}>
                    <FrontMini front={f} d={maps.history} />
                    <strong>{FRONT_NAMES[f]}</strong>
                    <span className="expo-marshal">{FRONT_MARSHALS[f]}</span>
                    <span className="expo-task">{FRONT_TASKS[f]}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {p.kind === 'briefing' && state.front && roleLayout(roles) === 'all' && (
            <section className="expo-split expo-briefing">
              <Briefing front={state.front} point={p.point} steer={controls} send={send} />
              <div className="expo-mapframe">
                <div className="expo-mapslot" role="img" aria-label={`Обстановка к 16 апреля 1945: ${BRIEFING[state.front][p.point]?.title ?? ''}`} />
              </div>
            </section>
          )}
          {p.kind === 'briefing' && state.front && roleLayout(roles) === 'map' && (
            <section className="expo-brief-map">
              <BriefBar front={state.front} point={p.point} send={send} />
              <div className="expo-mapframe">
                <div className="expo-mapslot" role="img" aria-label={`Обстановка к 16 апреля 1945: ${BRIEFING[state.front][p.point]?.title ?? ''}`} />
              </div>
            </section>
          )}
          {p.kind === 'briefing' && state.front && roleLayout(roles) === 'ai' && (
            <section className="expo-brief-solo">
              <Briefing front={state.front} point={p.point} steer send={send} />
            </section>
          )}
          {p.kind === 'briefing' && state.front && roleLayout(roles) === 'app' && (
            <section className="expo-brief-solo">
              <Excursion point={p.point} />
            </section>
          )}
          {p.kind === 'briefing' && state.front && roleLayout(roles) === 'pair' && (
            <section className="expo-brief-pair">
              <Briefing front={state.front} point={p.point} steer send={send} />
              <Excursion point={p.point} />
            </section>
          )}
          {p.kind === 'turn' && (
            <div className={`expo-roles expo-roles-${roles.join('-')}`}>
              {controls && (
                <>
                  <section className="expo-map">
                    <h2 className="expo-sr">Карта</h2>
                    <div className="expo-turn-title">
                      <div>
                        <h2>{def?.title}</h2>
                        <p className="expo-meta">
                          {state.front && FRONT_NAMES[state.front]}
                          {mv && ', '}
                          {mv && (
                            <span className={p.step === 'scroll' ? 'expo-run-date' : undefined} ref={clock} data-clock>
                              {modelTime(mv.time)}
                            </span>
                          )}
                        </p>
                      </div>
                      <Timer state={state} total={settings.timer.seconds} />
                    </div>
                    <div className="expo-mapframe">
                      <div className="expo-mapslot" role="img" aria-label="Карта перелома" />
                      {!mv && <ModelNote model={model} />}
                    </div>
                  </section>
                  <aside className="expo-decision">
                    {p.step === 'choose' ? (
                      <Cards
                        cards={mv?.cards ?? []}
                        doc={(mv && sessionDoc(maps.session, mv)) ?? maps.history ?? null}
                        time={mv?.time ?? MAP.days[0]}
                        disabled={state.paused}
                        canReplace={!state.paused && p.replacements < settings.maxReplacements && (settings.aiMode === 'ai' || (mv?.spare ?? 0) > 0)}
                        replaceLabel={p.replacements >= settings.maxReplacements ? 'Замен больше нет' : settings.aiMode !== 'ai' && mv && mv.spare === 0 ? 'Вариантов больше нет' : settings.aiMode === 'ai' ? 'Вариант от ИИ' : 'Другой вариант'}
                        hoverLights={access.hoverExpand}
                        expanded={expanded}
                        lit={expanded ?? hover}
                        setExpanded={setExpanded}
                        setHover={setHover}
                        send={send}
                      />
                    ) : p.step === 'explain' ? (
                      <>
                        <p className="expo-situation">{def?.situation}</p>
                        {mv?.move && !roles.includes('progress') && <MoveAdvance mv={mv} />}
                        {roles.includes('progress') && <Progress model={model} size="compact" />}
                      </>
                    ) : (
                      <>
                        <OrderSlip c={typeof p.choice === 'number' ? mv?.cards[p.choice] ?? null : null} n={p.choice} />
                        <Reveal model={model} delay={p.choice === 'delay'} full={!roles.includes('progress')} />
                        {mv?.move && !roles.includes('progress') && <MoveAdvance mv={mv} />}
                        {roles.includes('progress') && <Progress model={model} size="compact" date={false} />}
                      </>
                    )}
                  </aside>
                </>
              )}
              {!controls && roles.includes('ai') && state.front && p.kind === 'turn' && (
                <StaffBoard front={state.front} n={p.n} model={model} ai={ai} send={send} />
              )}
              {!controls && roles.includes('progress') && (
                <section className="expo-side expo-progress-screen" style={CITY ? { ['--side-bg' as string]: `url(${CITY})` } : undefined}>
                  <Progress model={model} size="full" />
                </section>
              )}
            </div>
          )}
          {p.kind === 'result' && (
            <section className="expo-result">
              {mv?.final ? (
                <>
                  <Newspaper final={mv.final} front={state.front} fronts={settings.fronts} />
                  <div className="expo-result-side">
                    <div className="expo-mapframe">
                      <div className="expo-mapslot" role="img" aria-label="Ваш путь армий (сплошная стрелка) поверх исторического (полая)" />
                    </div>
                    <p className="expo-legend">
                      <span className="expo-legend-own">ваш путь</span> <span className="expo-legend-history">как было</span>
                    </p>
                    {controls && (
                      <button className="expo-primary" onClick={() => send({ t: 'touch' })}>
                        Ещё раз
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="expo-result-text">
                  <h1>Сеанс завершён</h1>
                  <ModelNote model={model} />
                  {controls && (
                    <button className="expo-primary" onClick={() => send({ t: 'touch' })}>
                      Ещё раз
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
        {(buttons || subtitles) && (
          <footer className="expo-footer">
            {buttons && access.voiceButton && (
              <button disabled={state.paused} onClick={() => send({ t: 'speak' })}>
                Говорить
              </button>
            )}
            {buttons && (
              <button className="expo-secondary" disabled={state.paused} aria-expanded={asking} onClick={() => setAsking(!asking)}>
                Спросить ИИ
              </button>
            )}
            {p.kind === 'turn' && roles.includes('ai') ? (
              <AiBand ai={ai} rest={p.step === 'explain' ? state.front && FRONT_TASKS[state.front] : def?.situation} />
            ) : subtitles ? (
              <AiPanel ai={ai} compact />
            ) : (
              <span className="expo-fill" />
            )}
            {buttons && (
              <button className="expo-secondary" disabled={state.paused} onClick={() => send({ t: 'restart' })}>
                Начать заново
              </button>
            )}
            {asking && (
              <div className="expo-questions" role="menu">
                {QUESTIONS.map((q) => (
                  <button
                    key={q}
                    role="menuitem"
                    onClick={() => {
                      send({ t: 'ask', q });
                      setAsking(false);
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </footer>
        )}
        <Film />
        <Cut scene={p.kind === 'turn' ? `turn-${p.n}` : p.kind} />
        {children}
      </main>
    </div>
  );
}

/** Краткие названия пунктов доклада — для строки пунктов. */
const BRIEF_STEPS = ['Задача', 'Силы', 'Противник', 'Местность', 'Соседи', 'Соотношение'];

/** Строка пункта на экране карты: название, пункты доклада, переход дальше. Цифры — на соседнем экране. */
function BriefBar({ front, point, send }: { front: FrontId; point: number; send: (ev: DirectorEvent) => void }) {
  const points = BRIEFING[front];
  const cur = points[point];
  if (!cur) return null;
  const last = point + 1 >= points.length;
  return (
    <div className="expo-brief-bar">
      <h2>{cur.title}</h2>
      <ol className="expo-brief-steps" aria-label="Пункты доклада">
        {points.map((x, i) => (
          <li key={x.title}>
            <button aria-current={i === point ? 'step' : undefined} onClick={() => send({ t: 'brief', point: i })}>
              <span>{i + 1}</span> {BRIEF_STEPS[i] ?? x.title}
            </button>
          </li>
        ))}
      </ol>
      <div className="expo-brief-go">
        {!last && (
          <button className="expo-secondary" onClick={() => send({ t: 'brief', point: point + 1 })}>
            Дальше
          </button>
        )}
        <button className="expo-primary" onClick={() => send({ t: 'next' })}>
          К решениям
        </button>
      </div>
    </div>
  );
}

/** Ввод в обстановку: доклад начальника штаба по пунктам — заголовок, крупные цифры с источником, доводы. */
function Briefing({ front, point, steer, send }: { front: FrontId; point: number; steer: boolean; send: (ev: DirectorEvent) => void }) {
  const points = BRIEFING[front];
  const cur = points[point];
  if (!cur) return null;
  const last = point + 1 >= points.length;
  return (
    <div className="expo-panel expo-brief">
      <p className="expo-brief-who">
        {FRONT_NAMES[front]}, доклад начальника штаба
      </p>
      <ol className="expo-brief-steps" aria-label="Пункты доклада">
        {points.map((x, i) => (
          <li key={x.title}>
            <button aria-current={i === point ? 'step' : undefined} disabled={!steer} onClick={() => send({ t: 'brief', point: i })}>
              <span>{i + 1}</span> {BRIEF_STEPS[i] ?? x.title}
            </button>
          </li>
        ))}
      </ol>
      <h1>{cur.title}</h1>
      <dl className="expo-brief-facts" data-n={cur.facts.length}>
        {cur.facts.map((f) => (
          <div key={f.value + f.label}>
            <dt>{f.value}</dt>
            <dd>
              {f.label}
              <small>{f.source}</small>
            </dd>
          </div>
        ))}
      </dl>
      <ul className="expo-brief-lines">
        {cur.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {steer && (
        <div className="expo-brief-go">
          {!last && (
            <button className="expo-secondary" onClick={() => send({ t: 'brief', point: point + 1 })}>
              Дальше
            </button>
          )}
          <button className="expo-primary" onClick={() => send({ t: 'next' })}>
            К решениям
          </button>
        </div>
      )}
    </div>
  );
}

/** Суть карточки на виду: две первые строки (у карточки ИИ без факта и риска — три; при длинном заголовке — на одну меньше). */
const gist = (c: CardView) => c.lines.filter((l) => !/^(Риск|Расчёт):/.test(l)).slice(0, (c.fact ? 2 : 3) - (c.title.length > 30 ? 1 : 0));
const cardSource = (c: CardView) => (c.source ? SOURCE_LABEL[c.source === 'prepared' ? 'aiBank' : c.source] : null);

/** Снимок карточки, если он назначен в банке. Подпись — что на кадре, без автора и даты. */
function CardPhoto({ file, big = false }: { file: string; big?: boolean }) {
  const pic = pictureByFile(file);
  if (!pic) return null;
  const caption = cardCaption(pic.caption);
  return (
    <figure className={big ? 'expo-card-photo expo-card-photo-big' : 'expo-card-photo'}>
      <img src={pic.src} alt={caption} style={{ objectPosition: pic.focus ?? '50% 40%' }} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** Мини-карта выбора фронта: полоса фронта на 16 апреля и стрелки задачи танковых армий. */
function FrontMini({ front, d }: { front: FrontId; d: StageDoc | undefined }) {
  const arrows = useMemo(() => frontArrows(front), [front]);
  const extra = useMemo(() => (d ? orderFeatures(d.doc, arrows, ZOOM, tank) : undefined), [d, arrows]);
  const bbox = useMemo(() => pad(sectorBox(front, arrows.map((a) => a.to)), 0.05), [front, arrows]);
  return <StageMini doc={d?.doc ?? null} time={MAP.days[0]} bbox={bbox} extra={extra} width={860} height={400} symbols={1.5} className="expo-minimap" label={`Задача: ${FRONT_NAMES[front]}`} />;
}

/** Рамка с запасом `k` от размера по каждой оси. */
const pad = (b: Bbox, k: number): Bbox => {
  const dx = (b[2] - b[0]) * k + 0.05, dy = (b[3] - b[1]) * k + 0.03;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
};

/** Цифра-факт с источником. */
function Fact({ c, source = false }: { c: CardView; source?: boolean }) {
  if (!c.fact) return null;
  return (
    <p className="expo-fact">
      <b>{c.fact.value}</b> {c.fact.text}
      {source && <small className="expo-fact-src"> Источник: {c.fact.source}</small>}
    </p>
  );
}

/** Три карточки-приказа одной высоты: выбор — нажатием на карточку; подробнее и замена — в полосе справа. */
function Cards(props: {
  cards: CardView[];
  doc: StageDoc | null;
  time: string;
  disabled: boolean;
  canReplace: boolean;
  replaceLabel: string;
  hoverLights: boolean;
  expanded: number | null;
  lit: number | null;
  setExpanded: (n: number | null) => void;
  setHover: (n: number | null) => void;
  send: (ev: DirectorEvent) => void;
}) {
  const { cards, disabled, canReplace, replaceLabel, expanded, lit, setExpanded, setHover, send } = props;
  const open = expanded !== null ? cards[expanded] : undefined;
  if (expanded !== null && open)
    return (
      <article className="expo-sheet" aria-label={`Карточка ${expanded + 1}, подробно`}>
        <header>
          <span className="expo-card-n">{expanded + 1}</span>
          <h3>{open.title}</h3>
        </header>
        {open.photo && <CardPhoto file={open.photo} big />}
        <ul className="expo-card-lines">
          {open.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <Fact c={open} source />
        {cardSource(open) && <small className="expo-source">{cardSource(open)}</small>}
        <div className="expo-sheet-actions">
          <button className="expo-primary" disabled={disabled} onClick={() => send({ t: 'choose', card: expanded })}>
            Выбрать вариант {expanded + 1}
          </button>
          <button className="expo-secondary" disabled={!canReplace} onClick={() => send({ t: 'replace', card: expanded })}>
            {replaceLabel}
          </button>
          <button className="expo-secondary" onClick={() => setExpanded(null)}>
            Свернуть
          </button>
        </div>
      </article>
    );
  return (
    <div className="expo-cards">
      {[0, 1, 2].map((card) => {
        const c = cards[card];
        return (
          <article
            key={card}
            className="expo-card"
            data-lit={lit === card || undefined}
            onPointerEnter={props.hoverLights ? () => setHover(card) : undefined}
            onPointerLeave={props.hoverLights ? () => setHover(null) : undefined}
          >
            <button className={`expo-card-main${c?.photo ? '' : ' expo-card-nophoto'}`} disabled={disabled || !c} aria-label={`Карточка ${card + 1}`} onClick={() => send({ t: 'choose', card })}>
              {c?.photo && (
                <span className="expo-card-media">
                  <CardPhoto file={c.photo} />
                </span>
              )}
              <span className="expo-card-body">
                <strong>
                  <span className="expo-card-n">{card + 1}</span> {c?.title ?? 'Карточка готовится'}
                </strong>
                {c && gist(c).map((l) => <span key={l}>{l}</span>)}
                {c && <Fact c={c} />}
                {c?.risk && <span className="expo-risk">Риск: {c.risk.toLowerCase()}</span>}
                {c && !c.fact && cardSource(c) && <small className="expo-source">{cardSource(c)}</small>}
              </span>
            </button>
            {/* историческая карточка до выбора не отличается от прочих: кнопка замены есть у каждой */}
            <div className="expo-card-actions">
              <button className="expo-secondary" disabled={!c} aria-label={`Подробнее о карточке ${card + 1}`} onClick={() => setExpanded(card)}>
                Подробнее
              </button>
              <button className="expo-secondary" disabled={!canReplace} onClick={() => send({ t: 'replace', card })}>
                {replaceLabel}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Отданный приказ: бланк выбранной карточки со штампом «ПРИКАЗ», текст — телетайпом. */
function OrderSlip({ c, n }: { c: CardView | null; n: number | 'delay' | null }) {
  if (n === 'delay' || !c) return null;
  return (
    <article className="expo-slip" aria-label="Отданный приказ">
      <p className="expo-slip-head">
        <span className="expo-card-n">{(n as number) + 1}</span> <span className="expo-tty">{c.title}</span>
      </p>
      <span className="expo-stamp" aria-hidden="true">
        Приказ
      </span>
    </article>
  );
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** Кадры хроники на заставке: архивные снимки сменяют друг друга (CSS), подпись — у каждого. */
function Newsreel() {
  const frames = picturesOf('archive');
  if (!frames.length) return null;
  return (
    <figure className="expo-reel" style={{ ['--n' as string]: frames.length }}>
      {frames.map((f, i) => (
        <div key={f.file} className="expo-reel-frame" style={{ ['--i' as string]: i }}>
          <img src={f.src} alt={f.caption} style={f.focus ? { objectPosition: f.focus } : undefined} />
          <figcaption>{f.caption}</figcaption>
        </div>
      ))}
    </figure>
  );
}

/** Итог — газетная полоса: заголовок о Берлине в этой переигровке, звание, три шкалы, совпадения с историей, рекорд дня. */
function Newspaper({ final, front, fronts }: { final: NonNullable<View['final']>; front: FrontId | null; fronts: FrontId[] }) {
  const [head, deck] = final.forecast.split(' — ');
  const rec = recordLines(readRecord());
  const other = fronts.find((f) => f !== front);
  const city = picturesOf('generated').find((x) => x.file === 'city-dawn.jpg');
  return (
    <article className="expo-paper">
      <header className="expo-paper-mast">
        <span>Фронтовая сводка</span>
        <span>{front && FRONT_NAMES[front]} · ваша переигровка</span>
      </header>
      <h1 className="expo-paper-head">{head}</h1>
      {deck && <p className="expo-paper-deck">{deck}</p>}
      {city && <img className="expo-paper-pic" src={city.src} alt="" />}
      <div className="expo-paper-cols">
        <div>
          <p className="expo-paper-rank">
            Звание по итогам: <b className="expo-rank">{final.rank}</b>
          </p>
          <Scales scales={final.scales} />
        </div>
        <div className="expo-paper-side">
          <p>Совпало с историческим решением: {final.matches} из 3</p>
          {(rec.speed || rec.cost) && (
            <p>
              Рекорд дня среди посетителей: {[rec.speed, rec.cost].filter(Boolean).join('; ')}
            </p>
          )}
          {other && <p className="expo-paper-invite">Сыграйте за {FRONT_NAMES[other]} — {FRONT_MARSHALS[other].replace('Маршал', 'маршал')}, {lowerFirst(FRONT_TASKS[other].split(' — ')[0])}.</p>}
        </div>
      </div>
    </article>
  );
}

/** После выбора: как поступил маршал и исторический вариант (целиком или сутью, когда рядом ход операции). */
function Reveal({ model, delay, full }: { model: ModelFrame; delay: boolean; full: boolean }) {
  const mv = model.view;
  return (
    <div className="expo-reveal">
      {delay && <p className="expo-status">Промедление: новых распоряжений нет, армии закрепляются на достигнутом.</p>}
      {mv?.reveal && !mv.busy ? (
        <>
          <h3>{mv.reveal.text}</h3>
          {full ? (
            <>
              <p className="expo-meta">Исторический вариант</p>
              <p className="expo-hist-title">{mv.reveal.historical.title}</p>
              <ul className="expo-card-lines">
                {mv.reveal.historical.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="expo-hist-title">
              <span className="expo-meta">Исторический вариант:</span> {mv.reveal.historical.title}
            </p>
          )}
        </>
      ) : (
        !model.error && <p className="expo-status">Решение принято. Модель считает ход операции…</p>
      )}
    </div>
  );
}

/** Ход операции: дата хода (если её нет над картой) и оперативная сводка (`OpSummary`). */
function Progress({ model, size, date = true }: { model: ModelFrame; size: 'full' | 'compact'; date?: boolean }) {
  const mv = model.view;
  return (
    <div className={`expo-progress expo-progress-${size}`}>
      <h2>Ход операции</h2>
      {mv ? (
        <>
          {date && <p className="expo-date">{modelTime(mv.time)}</p>}
          <OpSummary mv={mv} size={size} />
        </>
      ) : (
        <ModelNote model={model} />
      )}
    </div>
  );
}

/** «Штаб ИИ» на одном экране — субтитром в подвале: ответ, мысль или звучащая фраза; в тишине — `rest` (обстановка, задача). */
function AiBand({ ai, rest }: { ai: AiFrame; rest?: string | null }) {
  const text = ai.answer ? (ai.answer.text || ai.thinking) : ai.line?.text ?? rest;
  const ref = useFit<HTMLDivElement>(`${ai.answer?.q}|${text}`, 34);
  return (
    <section className="expo-subs" aria-live="polite">
      <h2 className="expo-sr">Штаб ИИ</h2>
      <div ref={ref} className="expo-subs-text">
        {ai.answer && <span className="expo-q">{ai.answer.q} </span>}
        <span className={ai.answer && !ai.answer.text ? 'expo-thinking' : ''}>{text}</span>
        {ai.answer?.source && <small className="expo-source"> {SOURCE_LABEL[ai.answer.source]}</small>}
      </div>
    </section>
  );
}

/** Что говорит ИИ: ответ на вопрос (с источником), мысль, пока он думает, и субтитр звучащей фразы. */
function AiPanel({ ai, compact = false }: { ai: AiFrame; compact?: boolean }) {
  const line = ai.line && ai.line.text !== ai.answer?.text ? ai.line.text : null;
  const ref = useFit<HTMLDivElement>(`${ai.answer?.text}|${ai.thinking}|${line}`, compact ? 32 : 40);
  if (compact)
    return (
      <div ref={ref} className="expo-ai expo-ai-compact" aria-live="polite">
        {ai.answer ? <p>{ai.answer.text || ai.thinking}</p> : line && <p className="expo-subtitle">{line}</p>}
      </div>
    );
  return (
    <div ref={ref} className="expo-ai" aria-live="polite">
      {ai.answer && (
        <div className="expo-answer">
          <p className="expo-q">{ai.answer.q}</p>
          {ai.answer.text ? <p>{ai.answer.text}</p> : ai.thinking && <p className="expo-thinking">{ai.thinking}</p>}
          {ai.answer.source && <small className="expo-source">{SOURCE_LABEL[ai.answer.source]}</small>}
        </div>
      )}
      {line && <p className="expo-subtitle">{line}</p>}
    </div>
  );
}

const START = historyAt(MAP.days[0]);

/** Стрелка задачи фронта: армии фронта к своим положениям на конец операции по истории. */
function frontArrows(front: string): Arrow[] {
  const end = historyAt(MAP.days[MAP.days.length - 1]);
  return START.filter((a) => a.front === front && /ТА/.test(a.label)).flatMap((a) => {
    const b = end.find((x) => x.id === a.id);
    return b ? [{ army: a.id, from: a.at, to: b.at, kind: 'attack' }] : [];
  });
}

type View = NonNullable<ModelFrame['view']>;
const TABLE = picturesOf('generated').find((x) => x.file === 'staff-table.jpg')?.src;
const CITY = picturesOf('generated').find((x) => x.file === 'city-dawn.jpg')?.src;
const NO_PLAN: StageMapProps = { doc: null, time: null, camera: null };
/** Театр операции целиком (заставка). */
const THEATRE: Bbox = [12.2, 51.35, 15.2, 53.05];
const BERLIN = MAP.cities.find((c) => c.capital)!.at;
const tank = (army: string) => /ТА/.test(MAP.armies.find((a) => a.id === army)?.label ?? '');
const ZOOM = 8;
/** Участок фронта: армии фронта на 16 апреля, Берлин и точки `extra`. */
const sectorBox = (front: string, extra: LL[]): Bbox => bboxOf([...START.filter((a) => a.front === front).map((a) => a.at), BERLIN, ...extra]);

/** Что показывает карта стенда в сцене: документ, момент или бег времени, кадр камеры и знаки поверх; null — карты нет. */
export function mapPlan({ state, mv, maps, lit, count, index }: { state: DirectorState; mv: View | null; maps: StageDocs; lit: number | null; count: number; index: number }): StageMapProps | null {
  const p = state.phase;
  const hist = maps.history;
  const start = hist?.doc.timeline?.start ?? MAP.days[0];
  const sector = sectorBox;
  const roles = layoutFor(count === 2 || count === 3 ? count : 1).find((s) => s.window === index)?.roles ?? [];
  if (p.kind === 'attract') {
    const d = maps.best ?? hist;
    if (!d || !roles.includes('map')) return null;
    return { doc: d.doc, time: null, run: { from: start, to: d.time, ms: 36000, loop: true, hold: 4000, step: 100, key: `${d.front}-${d.time}` }, camera: { bbox: THEATRE, key: `attract-${index}`, ms: 0 }, level: 'front', zones: d.zones, fx: { front: START.filter((a) => a.side === 'su').map((a) => a.at), smoke: [BERLIN], bursts: [] } };
  }
  // выбор фронта: карта скрыта, но уже встаёт на 16 апреля — на вводе в обстановку останется только пролёт камеры
  if (p.kind === 'welcome' && hist) return { doc: hist.doc, time: start, camera: null, level: 'corps', zones: hist.zones };
  if (p.kind === 'briefing' && hist && state.front) {
    if (!roles.includes('map')) return null;
    const pt = BRIEFING[state.front][p.point];
    if (!pt) return null;
    // кадр пункта доклада; на первом — артиллерийская подготовка 16 апреля, 5:00, на переднем крае фронта
    const fx = p.point === 0 ? { front: START.filter((a) => a.front === state.front).map((a) => a.at), smoke: [], bursts: [] } : null;
    return { doc: hist.doc, time: start, camera: { bbox: pt.map.bbox, key: `brief-${state.front}-${p.point}`, ms: 2600 }, extra: briefFeatures(hist.doc, pt.map, ZOOM), level: pt.map.level, zones: hist.zones, fx };
  }
  if (p.kind === 'turn' && mv) {
    const own = sessionDoc(maps.session, mv);
    const d = own ?? hist;
    if (!d) return null;
    const arrowsAll = [...mv.cards, ...(mv.reveal ? [mv.reveal.historical] : [])].flatMap((c) => (c.arrows ?? []).flatMap((a) => [a.from, a.to]));
    // со второго перелома — армии у Берлина (дальние фланги, как у Штеттина, кадр не растягивают)
    const near = mv.map.armies.filter((a) => a.front === mv.front && (p.n === 1 || Math.hypot(a.at[0] - BERLIN[0], (a.at[1] - BERLIN[1]) * 1.6) < 1.5));
    const camera = { bbox: p.n === 1 ? sector(mv.front, [...near.map((a) => a.at), ...arrowsAll]) : bboxOf([BERLIN, ...near.map((a) => a.at), ...arrowsAll]), key: `turn-${mv.front}-${p.n}` };
    const picked = p.step === 'scroll' && typeof p.choice === 'number' ? mv.cards[p.choice] : null;
    const arrows = p.step === 'choose' ? (lit !== null ? mv.cards[lit]?.arrows : undefined) : p.step === 'scroll' ? picked?.arrows ?? mv.reveal?.historical.arrows : undefined;
    const extra = arrows?.length ? orderFeatures(d.doc, arrows, ZOOM, tank) : undefined;
    // прокрутка: армии идут от прошлого перелома, когда документ хода готов; до того — стоят
    const moving = p.step === 'scroll' && own && own.time === mv.time && mv.map.prev && !mv.busy;
    const time = own ? (p.step === 'scroll' && !moving && mv.map.prev ? mv.map.prev.time : mv.time) : start;
    const fx = { front: p.step === 'scroll' ? mv.map.armies.filter((a) => a.front === mv.front).map((a) => a.at) : [], smoke: mv.time >= '1945-04-20' ? [BERLIN] : [], bursts: moving ? mv.map.flashes.map((f) => f.at) : [] };
    return { doc: d.doc, time, level: 'corps', zones: d.zones, run: moving ? { from: mv.map.prev!.time, to: mv.time, ms: 8000, delay: 500, key: `run-${mv.time}` } : null, camera, extra, fx };
  }
  if (p.kind === 'result' && mv?.final) {
    const own = sessionDoc(maps.session, mv);
    if (!own) return null;
    const ids = Object.keys(mainPaths(mv.map.path));
    const paths = dailyPaths(own.doc, ids, own.time);
    const hp = historyPaths(mv.front, own.time);
    const history = Object.fromEntries(ids.filter((id) => hp[id]).map((id) => [id, hp[id]]));
    const pts = [...Object.values(paths), ...Object.values(history)].flat();
    return { doc: own.doc, time: own.time, camera: { bbox: pts.length ? bboxOf(pts) : sector(mv.front, []), key: `result-${own.time}` }, level: 'front', zones: own.zones, extra: pathFeatures(own.doc, paths, history, ZOOM), fx: { front: [], smoke: [BERLIN], bursts: [] } };
  }
  return null;
}

/** Документ сеанса, если он этого сеанса (фронт) и не новее его хода. */
function sessionDoc(d: StageDoc | undefined, mv: View): StageDoc | null {
  return d && d.front === mv.front && d.time <= mv.time ? d : null;
}
