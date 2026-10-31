/**
 * Вид одного выставочного окна: области по раскладке (`layoutFor`) и сцена текущей фазы. Управление — только в окне
 * с картой; клавиши — только в профиле «мышь и клавиатура» и не на паузе. Перелом и итог — по виду модели сеанса
 * (карточки банка, раскрытие решения, три шкалы, ход операции, оценка по осям); карта и анимация — этап «Подача».
 */
import { useEffect, useState } from 'react';
import { affordances, keyToEvent } from './input';
import type { DirectorEvent, DirectorState } from './director';
import type { ExpoSettings } from './settings';
import { layoutFor, sceneOf } from './layout';
import { FRONT_NAMES, PhaseTitle, Timer } from './scenes';
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
          <section className="expo-wide">
            <p className="expo-kicker">Берлинская операция · 1945</p>
            <h1>Примите командование</h1>
            <p>Выберите фронт и пройдите три перелома операции.</p>
            {controls && <button className="expo-primary" onClick={() => send({ t: 'touch' })}>Коснитесь, чтобы принять командование</button>}
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
                  <strong>{FRONT_NAMES[f]}</strong>
                  <span>{f === 'su_1bf' ? 'Георгий Жуков' : 'Иван Конев'}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {p.kind === 'briefing' && (
          <section className="expo-wide">
            <h1>Ввод в обстановку</h1>
            <h2>{state.front && FRONT_NAMES[state.front]}</h2>
            <p>Здесь появится карта операции и задача фронта.</p>
            {controls && <button className="expo-primary" onClick={() => send({ t: 'next' })}>К решениям</button>}
          </section>
        )}
        {p.kind === 'turn' && (
          <div className={`expo-roles ${count === 1 ? 'expo-single' : ''}`}>
            {roles.includes('map') && (
              <section className="expo-map">
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
                          {mv?.cards[card]?.source && <small className="expo-source">{SOURCE_LABEL[mv.cards[card].source!]}</small>}
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
              <div className="expo-result">
                <p className="expo-kicker">{state.front && FRONT_NAMES[state.front]}</p>
                <h2 className="expo-rank">{mv.final.rank}</h2>
                <p className="expo-forecast">{mv.final.forecast}</p>
                <Scales scales={mv.final.scales} />
                <p>
                  Вы выбрали как маршал: {mv.final.matches} из 3
                </p>
                <p>Попробуйте другие решения или другой фронт. В полной версии — вся операция и штабы на модели.</p>
              </div>
            ) : (
              <ModelNote model={model} />
            )}
            {controls && <button className="expo-primary" onClick={() => send({ t: 'touch' })}>Ещё раз</button>}
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
