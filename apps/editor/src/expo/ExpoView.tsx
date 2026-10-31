/**
 * Вид одного выставочного окна: области по раскладке (`layoutFor`) и сцена текущей фазы. Управление — только в окне
 * с картой; клавиши — только в профиле «мышь и клавиатура» и не на паузе. Перелом и итог — по виду модели сеанса
 * (карточки банка, раскрытие решения, три шкалы, ход операции, оценка по осям). Карта — `ExpoMap`: заставка по истории
 * (на нескольких экранах — части одной панорамы), ввод — камера к полосе фронта, перелом — стрелки карточек и движение
 * армий по ходу ядра, итог — путь посетителя поверх исторического.
 */
import { useEffect, useState } from 'react';
import { affordances, keyToEvent } from './input';
import type { DirectorEvent, DirectorState } from './director';
import type { ExpoSettings } from './settings';
import { layoutFor, panoramaPart, sceneOf } from './layout';
import { FRONT_MARSHALS, FRONT_NAMES, FRONT_TASKS, PhaseTitle, Timer } from './scenes';
import { ExpoMap, historyPaths, Replay, useProgress } from './ExpoMap';
import { historyAt, mainPaths, MAP, type Arrow } from './map';
import type { ModelFrame } from './model';
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
}
const NO_MODEL: ModelFrame = { view: null, error: null };
export function ExpoView({ window: index, state, settings, count, model = NO_MODEL, ai = NO_AI, send }: ExpoViewProps) {
  const mv = model.view;
  const p = state.phase,
    roles = layoutFor(count).find((s) => s.window === index)?.roles ?? [];
  const controls = roles.includes('map');
  const access = affordances(settings.input, settings.voiceInput, settings.aiMode);
  const [expanded, setExpanded] = useState<number | null>(null),
    [frontIndex, setFrontIndex] = useState(0),
    [asking, setAsking] = useState(false);
  useEffect(() => {
    setExpanded(null);
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
      const ev = keyToEvent(e.key, p, { expanded, front: settings.fronts[frontIndex] ?? settings.fronts[0] });
      if (ev) {
        e.preventDefault();
        send(ev);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [controls, access.keys, state.paused, p, expanded, frontIndex, settings.fronts, send]);
  return (
    <main className="expo" style={{ ['--expo-target' as string]: `${access.minTarget}px` }} data-scene={sceneOf(p)}>
      <header className="expo-header">
        <span>Штабные игры</span>
        <PhaseTitle state={state} />
        <span>
          Экран {index + 1} / {count}
        </span>
      </header>
      <div className="expo-content">
        {p.kind === 'startup' && (
          <section className="expo-wide">
            <h1>Стенд готовится</h1>
          </section>
        )}
        {p.kind === 'attract' && (
          <section className="expo-wide expo-over" onClick={controls ? () => send({ t: 'touch' }) : undefined}>
            <Replay part={count > 1 ? panoramaPart(index, count) : undefined}>
              {(iso) => <p className="expo-replay-date" aria-hidden="true">{modelTime(iso)}</p>}
            </Replay>
            {(controls || count === 1) && (
              <div className="expo-overlay">
                <p className="expo-kicker">16 апреля 1945. Через 17 дней пал Берлин. А как поступили бы вы?</p>
                <h1>Примите командование</h1>
                <p>Выберите фронт и пройдите три перелома операции.</p>
                {/* касание любого места панорамы — то же, что кнопка (событие всплывает к сцене) */}
                {controls && <button className="expo-primary">Коснитесь, чтобы принять командование</button>}
              </div>
            )}
          </section>
        )}
        {p.kind === 'welcome' && (
          <section className="expo-wide">
            <h1>Выберите фронт</h1>
            <div className="expo-cards">
              {settings.fronts.map((f) => (
                <button
                  key={f}
                  aria-pressed={settings.fronts[frontIndex] === f}
                  disabled={!controls}
                  onClick={() => send({ t: 'pickFront', front: f })}
                >
                  <ExpoMap armies={START} focus={f} labels={false} arrows={frontArrows(f)} aspect={2} className="expo-minimap" label={`Задача: ${FRONT_NAMES[f]}`} />
                  <strong>{FRONT_NAMES[f]}</strong>
                  <span>{FRONT_MARSHALS[f]}</span>
                  <span className="expo-task">{FRONT_TASKS[f]}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {p.kind === 'briefing' && (
          <section className="expo-wide expo-over">
            <ExpoMap armies={START} focus={state.front} cameraMs={4000} shift={0.3} stagger arrows={state.front ? frontArrows(state.front) : []} className="expo-backdrop" label="Обстановка к 16 апреля 1945" />
            <div className="expo-overlay expo-brief">
              <h1>Ввод в обстановку</h1>
              <h2>{state.front && FRONT_NAMES[state.front]}</h2>
              <p className="expo-task">{state.front && FRONT_TASKS[state.front]}</p>
              {controls && <button className="expo-primary" onClick={() => send({ t: 'next' })}>К решениям</button>}
            </div>
          </section>
        )}
        {p.kind === 'turn' && (
          <div className={`expo-roles ${count === 1 ? 'expo-single' : ''}`}>
            {roles.includes('map') && (
              <section className="expo-map">
                {mv && <TurnMap view={mv} step={p.step} choice={p.step === 'scroll' ? p.choice : null} expanded={expanded} />}
                <h2>Карта</h2>
                <h3>
                  Перелом {p.n} · {turnDef(state.front, p.n)?.title}
                </h3>
                <p>
                  {state.front && FRONT_NAMES[state.front]}
                  {mv && ` · ${modelTime(mv.time)}`}
                </p>
                <Timer state={state} />
                <ModelNote model={model} />
                {p.step === 'choose' ? (
                  <div className="expo-cards">
                    {[0, 1, 2].map((card) => (
                      <article
                        key={card}
                        className="expo-card"
                        onPointerEnter={() => {
                          if (access.hoverExpand) setExpanded(card);
                        }}
                      >
                        <button disabled={state.paused || !mv?.cards[card]} aria-label={`Карточка ${card + 1}`} onClick={() => send({ t: 'choose', card })}>
                          <span className="expo-card-n">{card + 1}</span>
                          <strong>{mv?.cards[card]?.title ?? 'Карточка готовится'}</strong>
                          {mv?.cards[card]?.source && <small className="expo-source">{SOURCE_LABEL[mv.cards[card].source === 'prepared' ? 'aiBank' : mv.cards[card].source!]}</small>}
                        </button>
                        <button className="expo-secondary" onClick={() => setExpanded(expanded === card ? null : card)}>
                          Подробнее о карточке {card + 1}
                        </button>
                        {expanded === card && mv?.cards[card] && (
                          <ul className="expo-card-lines">
                            {mv.cards[card].lines.map((l) => (
                              <li key={l}>{l}</li>
                            ))}
                          </ul>
                        )}
                        {/* историческая карточка до выбора не отличается от прочих: кнопка замены есть у каждой */}
                        {(
                          <button
                            className="expo-secondary"
                            disabled={state.paused || p.replacements >= settings.maxReplacements}
                            onClick={() => send({ t: 'replace', card })}
                          >
                            {settings.aiMode === 'ai' ? 'Сгенерировать альтернативу с помощью ИИ' : 'Другой вариант'}
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                ) : p.step === 'explain' ? (
                  <p className="expo-status">{turnDef(state.front, p.n)?.situation}</p>
                ) : (
                  <div className="expo-reveal">
                    {p.choice === 'delay' && <p className="expo-status">Промедление: новых распоряжений нет, армии закрепляются на достигнутом.</p>}
                    {mv?.reveal && !mv.busy ? (
                      <>
                        <h3>{mv.reveal.text}</h3>
                        <p>
                          <strong>{mv.reveal.historical.title}</strong> — исторический вариант
                        </p>
                      </>
                    ) : (
                      !model.error && <p className="expo-status">Решение принято. Модель считает ход операции…</p>
                    )}
                  </div>
                )}
              </section>
            )}
            {roles.includes('ai') && (
              <section className="expo-side">
                <h2>Штаб ИИ</h2>
                <p>{turnDef(state.front, p.n)?.situation}</p>
                <AiPanel ai={ai} />
                {p.step === 'scroll' && mv?.reveal && !mv.busy && (
                  <ul className="expo-card-lines">
                    {mv.reveal.historical.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {roles.includes('progress') && (
              <section className="expo-side">
                <h2>Ход операции</h2>
                {mv ? (
                  <>
                    <p className="expo-date">{modelTime(mv.time)}</p>
                    <Scales scales={mv.scales} />
                    <Feed lines={mv.feed} />
                  </>
                ) : (
                  <ModelNote model={model} />
                )}
              </section>
            )}
          </div>
        )}
        {p.kind === 'result' && (
          <section className="expo-wide">
            <h1>Сеанс завершён</h1>
            {mv?.final ? (
              <div className="expo-result expo-result-grid">
                <div>
                  <p className="expo-kicker">{state.front && FRONT_NAMES[state.front]}</p>
                  <h2 className="expo-rank">{mv.final.rank}</h2>
                  <p className="expo-forecast">{mv.final.forecast}</p>
                  <Scales scales={mv.final.scales} />
                  <p>Вы выбрали как маршал: {mv.final.matches} из 3</p>
                  <p>Попробуйте другие решения или другой фронт. В полной версии — вся операция и штабы на модели.</p>
                </div>
                <div className="expo-result-side">
                  <ResultMap view={mv} />
                  <p className="expo-legend"><span className="expo-legend-own">ваш путь</span> <span className="expo-legend-history">как было</span></p>
                  {controls && <button className="expo-primary" onClick={() => send({ t: 'touch' })}>Ещё раз</button>}
                </div>
              </div>
            ) : (
              <>
                <ModelNote model={model} />
                {controls && <button className="expo-primary" onClick={() => send({ t: 'touch' })}>Ещё раз</button>}
              </>
            )}
          </section>
        )}
      </div>
      <footer className="expo-footer">
        {controls && access.voiceButton && (
          <button disabled={state.paused} onClick={() => send({ t: 'speak' })}>
            Говорить
          </button>
        )}
        {controls && p.kind !== 'startup' && p.kind !== 'attract' && (
          <button className="expo-secondary" disabled={state.paused} aria-expanded={asking} onClick={() => setAsking(!asking)}>
            Спросить ИИ
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
        {!roles.includes('ai') && <AiPanel ai={ai} compact />}
        {controls && p.kind !== 'startup' && p.kind !== 'attract' && (
          <button className="expo-secondary" disabled={state.paused} onClick={() => send({ t: 'restart' })}>
            Начать заново
          </button>
        )}
      </footer>
    </main>
  );
}

/** Что говорит ИИ: ответ на вопрос (с источником), мысль, пока он думает, и субтитр звучащей фразы. */
function AiPanel({ ai, compact = false }: { ai: AiFrame; compact?: boolean }) {
  return (
    <div className={`expo-ai ${compact ? 'expo-ai-compact' : ''}`} aria-live="polite">
      {ai.answer && (
        <div className="expo-answer">
          <p className="expo-q">{ai.answer.q}</p>
          {ai.answer.text ? <p>{ai.answer.text}</p> : ai.thinking && <p className="expo-thinking">{ai.thinking}</p>}
          {ai.answer.source && <small className="expo-source">{SOURCE_LABEL[ai.answer.source]}</small>}
        </div>
      )}
      {ai.line && ai.line.text !== ai.answer?.text && (
        <p className="expo-subtitle">
          {ai.line.text}
        </p>
      )}
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

/** Карта перелома: стрелки раскрытой карточки; на прокрутке — движение армий от прошлого перелома, дата бежит, события вспыхивают. */
function TurnMap({ view, step, choice, expanded }: { view: NonNullable<ModelFrame['view']>; step: string; choice: number | 'delay' | null; expanded: number | null }) {
  const m = view.map;
  const t = useProgress(step === 'scroll' && !view.busy ? view.time : 'still', step === 'scroll' && m.prev ? 8000 : 0);
  const moving = step === 'scroll' && !view.busy && m.prev;
  const picked = typeof choice === 'number' ? view.cards[choice] : null;
  const arrows = step === 'choose' ? (expanded !== null ? view.cards[expanded]?.arrows : undefined) : step === 'scroll' ? picked?.arrows ?? view.reveal?.historical.arrows : undefined;
  const date = moving ? new Date(Date.parse(`${m.prev!.time}:00Z`) + (Date.parse(`${view.time}:00Z`) - Date.parse(`${m.prev!.time}:00Z`)) * t).toISOString().slice(0, 16) : view.time;
  return (
    <>
      <ExpoMap
        armies={moving ? m.armies : view.busy && m.prev ? m.prev.armies : m.armies}
        from={moving ? m.prev!.armies : null}
        progress={t}
        arrows={arrows ?? []}
        flashes={moving && t > 0.7 ? m.flashes : []}
        focus={view.front}
        shift={0.2}
        className="expo-backdrop"
        label="Карта перелома"
      />
      {moving && <p className="expo-replay-date expo-run-date" aria-hidden="true">{modelTime(date)}</p>}
    </>
  );
}

/** Итог: пути главных армий фронта — посетителя (сплошной) поверх исторического (пунктир). */
function ResultMap({ view }: { view: NonNullable<ModelFrame['view']> }) {
  const own = mainPaths(view.map.path);
  const hist = historyPaths(view.front, view.time);
  return (
    <ExpoMap
      armies={view.map.armies.filter((a) => a.side === 'de' || a.id in own)}
      focus={view.front}
      aspect={0.9}
      fontScale={2}
      paths={{ own, history: Object.fromEntries(Object.keys(own).filter((id) => hist[id]).map((id) => [id, hist[id]])) }}
      className="expo-result-map"
      label="Ваш путь армий (сплошной) поверх исторического (пунктир)"
    />
  );
}
