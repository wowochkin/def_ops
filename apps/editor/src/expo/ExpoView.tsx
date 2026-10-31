/**
 * Вид одного выставочного окна: области по раскладке (`layoutFor`) и сцена текущей фазы. Сцена верстается на холсте
 * 1920×1080 и целиком масштабируется под окно с сохранением пропорций (поля — фон темы), поэтому вёрстка одна
 * при любом размере окна. Управление — только в окне с картой; клавиши — только в профиле «мышь и клавиатура»
 * и не на паузе. Карта и текст занимают разные области холста: на переломе карта слева, решения — колонкой справа.
 * Перелом и итог — по виду модели сеанса (карточки банка, раскрытие решения, три шкалы, ход операции, оценка по осям).
 * Карта — `ExpoMap`: заставка по истории (на нескольких экранах — части одной панорамы), ввод — камера к полосе фронта,
 * перелом — стрелки подсвеченной карточки и движение армий по ходу ядра, итог — путь посетителя поверх исторического.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { affordances, keyToEvent } from './input';
import type { DirectorEvent, DirectorState } from './director';
import type { ExpoSettings } from './settings';
import { layoutFor, panoramaPart, sceneOf } from './layout';
import { FRONT_MARSHALS, FRONT_NAMES, FRONT_TASKS, PhaseTitle, Timer } from './scenes';
import { ExpoMap, historyPaths, Replay, useProgress } from './ExpoMap';
import { historyAt, mainPaths, MAP, type Arrow, type LL } from './map';
import type { ModelFrame } from './model';
import type { CardView } from './session';
import { Feed, ModelNote, modelTime, Scales, turnDef } from './session-scenes';
import { NO_AI, QUESTIONS, type AiFrame } from './ai-runner';
import { SOURCE_LABEL } from './ai';
import './expo.css';
export interface ExpoViewProps {
  window: number;
  state: DirectorState;
  settings: ExpoSettings;
  count: 1 | 2 | 3;
  model?: ModelFrame;
  ai?: AiFrame;
  send: (ev: DirectorEvent) => void;
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

export function ExpoView({ window: index, state, settings, count, model = NO_MODEL, ai = NO_AI, send, children }: ExpoViewProps) {
  const mv = model.view;
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
    if (!controls || !access.keys || state.paused) return;
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
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
  }, [controls, access.keys, state.paused, p, expanded, hover, frontIndex, settings.fronts, send]);
  const panel = controls || count === 1;
  const buttons = controls && p.kind !== 'startup' && p.kind !== 'attract';
  const subtitles = buttons && !(p.kind === 'turn' && roles.includes('ai'));
  const def = p.kind === 'turn' ? turnDef(state.front, p.n) : null;
  const motion = useTurnMotion(mv, p.kind === 'turn' ? p.step : null);
  return (
    <div className="expo-stage">
      <main
        className="expo"
        style={{ ['--expo-target' as string]: `${access.minTarget}px`, ['--expo-scale' as string]: scale }}
        data-scene={sceneOf(p)}
        data-count={count}
      >
        <header className="expo-header">
          <span>Штабные игры</span>
          <PhaseTitle state={state} />
          <span>{count > 1 && `Экран ${index + 1} из ${count}`}</span>
        </header>
        <div className="expo-content">
          {p.kind === 'startup' && <section className="expo-wide" />}
          {p.kind === 'attract' && (
            <section className={`expo-split ${panel ? '' : 'expo-bleed'}`} onClick={controls ? () => send({ t: 'touch' }) : undefined}>
              {panel && (
                <div className="expo-panel expo-intro">
                  <p className="expo-kicker">16 апреля 1945. Через 17 дней пал Берлин. А как поступили бы вы?</p>
                  <h1>Примите командование</h1>
                  <p>Выберите фронт и пройдите три перелома операции.</p>
                  {/* касание любого места панорамы — то же, что кнопка (событие всплывает к сцене) */}
                  {controls && <button className="expo-primary">Коснитесь, чтобы принять командование</button>}
                </div>
              )}
              <Replay part={count > 1 ? panoramaPart(index, count) : undefined}>
                {(iso) => <p className="expo-map-date" aria-hidden="true">{modelTime(iso)}</p>}
              </Replay>
            </section>
          )}
          {p.kind === 'welcome' && (
            <section className="expo-welcome">
              <h1>Выберите фронт</h1>
              <div className="expo-fronts">
                {settings.fronts.map((f) => (
                  <button key={f} aria-pressed={settings.fronts[frontIndex] === f} disabled={!controls} onClick={() => send({ t: 'pickFront', front: f })}>
                    <ExpoMap armies={START} focus={f} labels="places" arrows={frontArrows(f)} include={frontArrows(f).map((a) => a.to)} className="expo-minimap" label={`Задача: ${FRONT_NAMES[f]}`} />
                    <strong>{FRONT_NAMES[f]}</strong>
                    <span className="expo-marshal">{FRONT_MARSHALS[f]}</span>
                    <span className="expo-task">{FRONT_TASKS[f]}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {p.kind === 'briefing' && (
            <section className="expo-split">
              <div className="expo-panel expo-brief">
                <h1>{state.front && FRONT_NAMES[state.front]}</h1>
                <p className="expo-marshal">{state.front && FRONT_MARSHALS[state.front]}</p>
                <p className="expo-task">{state.front && FRONT_TASKS[state.front]}</p>
                {controls && (
                  <button className="expo-primary" onClick={() => send({ t: 'next' })}>
                    К решениям
                  </button>
                )}
              </div>
              <div className="expo-mapframe">
                <ExpoMap
                  armies={START}
                  focus={state.front}
                  include={state.front ? frontArrows(state.front).map((a) => a.to) : []}
                  cameraMs={4000}
                  stagger
                  arrows={state.front ? frontArrows(state.front) : []}
                  className="expo-backdrop"
                  label="Обстановка к 16 апреля 1945"
                />
              </div>
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
                          {mv && <span className={motion.moving ? 'expo-run-date' : undefined}>{modelTime(motion.moving ? motion.date : mv.time)}</span>}
                        </p>
                      </div>
                      <Timer state={state} total={settings.timer.seconds} />
                    </div>
                    <div className="expo-mapframe">
                      {mv && <TurnMap view={mv} step={p.step} choice={p.step === 'scroll' ? p.choice : null} lit={expanded ?? hover} motion={motion} />}
                      {!mv && <ModelNote model={model} />}
                    </div>
                    {roles.includes('ai') && <AiBand ai={ai} rest={p.step === 'explain' ? state.front && FRONT_TASKS[state.front] : def?.situation} />}
                  </section>
                  <aside className="expo-decision">
                    {p.step === 'choose' ? (
                      <Cards
                        cards={mv?.cards ?? []}
                        disabled={state.paused}
                        canReplace={!state.paused && p.replacements < settings.maxReplacements}
                        replaceLabel={settings.aiMode === 'ai' ? 'Вариант от ИИ' : 'Другой вариант'}
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
                        {roles.includes('progress') && <Progress model={model} feed={3} />}
                      </>
                    ) : (
                      <>
                        <Reveal model={model} delay={p.choice === 'delay'} full={!roles.includes('progress')} />
                        {roles.includes('progress') && <Progress model={model} feed={2} date={false} />}
                      </>
                    )}
                  </aside>
                </>
              )}
              {!controls && roles.includes('ai') && (
                <section className="expo-side expo-ai-screen">
                  <h2>Штаб ИИ</h2>
                  <p className="expo-situation">{def?.situation}</p>
                  <AiPanel ai={ai} />
                  {p.step === 'scroll' && mv?.reveal && !mv.busy && (
                    <div className="expo-hist">
                      <p className="expo-meta">Исторический вариант: {mv.reveal.historical.title}</p>
                      <ul className="expo-card-lines">
                        {mv.reveal.historical.lines.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}
              {!controls && roles.includes('progress') && (
                <section className="expo-side">
                  <Progress model={model} feed={4} />
                </section>
              )}
            </div>
          )}
          {p.kind === 'result' && (
            <section className="expo-result">
              {mv?.final ? (
                <>
                  <div className="expo-result-text">
                    <p className="expo-kicker">Сеанс завершён: {state.front && FRONT_NAMES[state.front]}</p>
                    <h1 className="expo-rank">{mv.final.rank}</h1>
                    <p className="expo-forecast">{mv.final.forecast}</p>
                    <Scales scales={mv.final.scales} />
                    <p>Вы выбрали как маршал: {mv.final.matches} из 3</p>
                    <p className="expo-muted">Попробуйте другие решения или другой фронт. В полной версии — вся операция и штабы на модели.</p>
                  </div>
                  <div className="expo-result-side">
                    <div className="expo-mapframe">
                      <ResultMap view={mv} />
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
            {subtitles ? <AiPanel ai={ai} compact /> : <span className="expo-fill" />}
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
        {children}
      </main>
    </div>
  );
}

/** Суть карточки на виду: первая строка и вторая, если обе короткие (карточка не выше соседних). */
const gist = (lines: string[]) => (lines.length > 1 && lines[0].length <= 34 && lines[1].length <= 34 ? lines.slice(0, 2) : lines.slice(0, 1));
const cardSource = (c: CardView) => (c.source ? SOURCE_LABEL[c.source === 'prepared' ? 'aiBank' : c.source] : null);

/** Три карточки решения одной высоты: выбор — нажатием на карточку; подробнее и замена — в полосе справа. */
function Cards(props: {
  cards: CardView[];
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
        <ul className="expo-card-lines">
          {open.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
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
            <button className="expo-card-main" disabled={disabled || !c} aria-label={`Карточка ${card + 1}`} onClick={() => send({ t: 'choose', card })}>
              <span className="expo-card-n">{card + 1}</span>
              <span className="expo-card-body">
                <strong>{c?.title ?? 'Карточка готовится'}</strong>
                {c && gist(c.lines).map((l) => <span key={l}>{l}</span>)}
                {c && cardSource(c) && <small className="expo-source">{cardSource(c)}</small>}
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

/** После выбора: как поступил маршал и исторический вариант (целиком или сутью, когда рядом ход операции). */
function Reveal({ model, delay, full }: { model: ModelFrame; delay: boolean; full: boolean }) {
  const mv = model.view;
  return (
    <div className="expo-reveal">
      {delay && <p className="expo-status">Промедление: новых распоряжений нет, армии закрепляются на достигнутом.</p>}
      {mv?.reveal && !mv.busy ? (
        <>
          <h3>{mv.reveal.text}</h3>
          <p className="expo-meta">Исторический вариант</p>
          <p className="expo-hist-title">{mv.reveal.historical.title}</p>
          <ul className="expo-card-lines">
            {(full ? mv.reveal.historical.lines : mv.reveal.historical.lines.slice(0, 2)).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : (
        !model.error && <p className="expo-status">Решение принято. Модель считает ход операции…</p>
      )}
    </div>
  );
}

/** Ход операции: дата хода (если её нет над картой), три шкалы против истории, последние события. */
function Progress({ model, feed, date = true }: { model: ModelFrame; feed: number; date?: boolean }) {
  const mv = model.view;
  return (
    <div className="expo-progress">
      <h2>Ход операции</h2>
      {mv ? (
        <>
          {date && <p className="expo-date">{modelTime(mv.time)}</p>}
          <Scales scales={mv.scales} />
          {feed > 0 && <Feed lines={mv.feed.slice(-feed)} />}
        </>
      ) : (
        <ModelNote model={model} />
      )}
    </div>
  );
}

/** Полоса «Штаб ИИ» под картой (один экран): ответ, мысль или звучащая фраза; в тишине — `rest` (обстановка, задача). */
function AiBand({ ai, rest }: { ai: AiFrame; rest?: string | null }) {
  const text = ai.answer ? (ai.answer.text || ai.thinking) : ai.line?.text ?? rest;
  const ref = useFit<HTMLDivElement>(`${ai.answer?.q}|${text}`, 36);
  return (
    <section className="expo-band" aria-live="polite">
      <div>
        <h2>Штаб ИИ</h2>
        {ai.answer?.source && <small className="expo-source">{SOURCE_LABEL[ai.answer.source]}</small>}
      </div>
      <div ref={ref} className="expo-band-text">
        {ai.answer && <p className="expo-q">{ai.answer.q}</p>}
        <p className={ai.answer && !ai.answer.text ? 'expo-thinking' : ''}>{text}</p>
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
type Motion = { t: number; moving: boolean; date: string };

/** Прокрутка: доля пути армий от прошлого перелома (8 с) и бегущая дата хода. */
function useTurnMotion(view: View | null, step: string | null): Motion {
  const prev = view?.map.prev;
  const run = step === 'scroll' && !!view && !view.busy;
  const t = useProgress(run ? view.time : 'still', run && prev ? 8000 : 0);
  if (!view || !run || !prev) return { t, moving: false, date: view?.time ?? '' };
  const a = Date.parse(`${prev.time}:00Z`), b = Date.parse(`${view.time}:00Z`);
  return { t, moving: true, date: new Date(a + (b - a) * t).toISOString().slice(0, 16) };
}

/**
 * Карта перелома: стрелки подсвеченной или раскрытой карточки; на прокрутке — движение армий от прошлого перелома,
 * события вспыхивают. Кадр держит концы стрелок всех карточек — подсветка не двигает камеру.
 */
function TurnMap({ view, step, choice, lit, motion }: { view: View; step: string; choice: number | 'delay' | null; lit: number | null; motion: Motion }) {
  const m = view.map;
  const { t, moving } = motion;
  const picked = typeof choice === 'number' ? view.cards[choice] : null;
  const arrows = step === 'choose' ? (lit !== null ? view.cards[lit]?.arrows : undefined) : step === 'scroll' ? picked?.arrows ?? view.reveal?.historical.arrows : undefined;
  const include: LL[] = [...view.cards, ...(view.reveal ? [view.reveal.historical] : [])].flatMap((c) => (c.arrows ?? []).flatMap((a) => [a.from, a.to]));
  return (
    <ExpoMap
      armies={moving ? m.armies : view.busy && m.prev ? m.prev.armies : m.armies}
      from={moving ? m.prev!.armies : null}
      progress={t}
      arrows={arrows ?? []}
      flashes={moving && t > 0.7 ? m.flashes : []}
      focus={view.front}
      include={include}
      className="expo-backdrop"
      label="Карта перелома"
    />
  );
}

/** Итог: пути главных армий фронта — посетителя (сплошной) поверх исторического (пунктир). */
function ResultMap({ view }: { view: View }) {
  const own = mainPaths(view.map.path);
  const hist = historyPaths(view.front, view.time);
  const history = Object.fromEntries(Object.keys(own).filter((id) => hist[id]).map((id) => [id, hist[id]]));
  return (
    <ExpoMap
      armies={view.map.armies.filter((a) => a.side === 'de' || a.id in own)}
      focus={view.front}
      include={[...Object.values(own), ...Object.values(history)].flat()}
      paths={{ own, history }}
      className="expo-backdrop"
      label="Ваш путь армий (сплошной) поверх исторического (пунктир)"
    />
  );
}
