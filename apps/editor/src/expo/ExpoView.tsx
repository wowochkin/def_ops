/**
 * Вид одного выставочного окна: области по раскладке (`layoutFor`) и сцена текущей фазы. Управление — только в окне
 * с картой; клавиши — только в профиле «мышь и клавиатура» и не на паузе. Сцены этапа «Каркас» — подписи и учебные
 * карточки без расчёта операции.
 */
import { useEffect, useState } from 'react';
import { affordances, keyToEvent } from './input';
import type { DirectorEvent, DirectorState } from './director';
import type { ExpoSettings } from './settings';
import { layoutFor, sceneOf } from './layout';
import { FRONT_NAMES, PhaseTitle, Timer } from './scenes';
import './expo.css';
export interface ExpoViewProps {
  window: number;
  state: DirectorState;
  settings: ExpoSettings;
  count: 1 | 2 | 3;
  send: (ev: DirectorEvent) => void;
}
export function ExpoView({ window: index, state, settings, count, send }: ExpoViewProps) {
  const p = state.phase,
    roles = layoutFor(count).find((s) => s.window === index)?.roles ?? [];
  const controls = roles.includes('map');
  const access = affordances(settings.input, settings.voiceInput, settings.aiMode);
  const [expanded, setExpanded] = useState<number | null>(null),
    [frontIndex, setFrontIndex] = useState(0),
    [notice, setNotice] = useState('');
  useEffect(() => {
    setExpanded(null);
    setNotice('');
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
            {controls && <button onClick={() => send({ t: 'touch' })}>Коснитесь, чтобы принять командование</button>}
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
            {controls && <button onClick={() => send({ t: 'next' })}>К решениям</button>}
          </section>
        )}
        {p.kind === 'turn' && (
          <div className={`expo-roles ${count === 1 ? 'expo-single' : ''}`}>
            {roles.includes('map') && (
              <section className="expo-map">
                <h2>Карта</h2>
                <p>{state.front && FRONT_NAMES[state.front]}</p>
                <Timer state={state} />
                {p.step === 'choose' ? (
                  <div className="expo-cards">
                    {[0, 1, 2].map((card) => (
                      <article
                        key={card}
                        onPointerEnter={() => {
                          if (access.hoverExpand) setExpanded(card);
                        }}
                      >
                        <button disabled={state.paused} onClick={() => send({ t: 'choose', card })}>
                          Карточка {card + 1}
                        </button>
                        <button className="expo-secondary" onClick={() => setExpanded(expanded === card ? null : card)}>
                          Подробнее о карточке {card + 1}
                        </button>
                        {expanded === card && <p>Учебная карточка. Приказы и последствия появятся после подключения модели.</p>}
                        {card > 0 && (
                          <button
                            className="expo-secondary"
                            disabled={state.paused || p.replacements >= settings.maxReplacements}
                            onClick={() => send({ t: 'replace', card })}
                          >
                            Сгенерировать альтернативу с помощью ИИ
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="expo-status">
                    {p.step === 'explain'
                      ? 'Изучите обстановку. Скоро откроется выбор решения.'
                      : p.choice === 'delay'
                        ? 'Промедление: армии продолжают прежние задачи.'
                        : 'Решение принято. Операция продолжается.'}
                  </p>
                )}
              </section>
            )}
            {roles.includes('ai') && (
              <section className="expo-side">
                <h2>Штаб ИИ</h2>
                <p>Пояснения к обстановке и решениям появятся на следующем этапе.</p>
              </section>
            )}
            {roles.includes('progress') && (
              <section className="expo-side">
                <h2>Ход операции</h2>
                <p>Скорость · Цена · Замысел</p>
                <p>Оценка будет доступна после подключения модели.</p>
              </section>
            )}
          </div>
        )}
        {p.kind === 'result' && (
          <section className="expo-wide">
            <h1>Сеанс завершён</h1>
            <p>Три перелома пройдены. Расчёт итогов появится после подключения модели.</p>
            {controls && <button onClick={() => send({ t: 'touch' })}>Ещё раз</button>}
          </section>
        )}
      </div>
      <footer className="expo-footer">
        {controls && access.voiceButton && (
          <button onClick={() => setNotice('Голосовой ввод появится на этапе «ИИ и голос».')}>Говорить</button>
        )}
        {notice && <span role="status">{notice}</span>}
        <span>Каркас выставочного режима · сцены без расчёта операции</span>
        {controls && p.kind !== 'startup' && (
          <button className="expo-secondary" disabled={state.paused} onClick={() => send({ t: 'restart' })}>
            Начать заново
          </button>
        )}
      </footer>
    </main>
  );
}
