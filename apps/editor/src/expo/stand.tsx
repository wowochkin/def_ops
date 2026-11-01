/**
 * Экраны заставки, у каждого своё: как устроен штаб ИИ, переигровка на карте, полная версия приложения.
 */
import type { ReactNode } from 'react';
import { SOURCE_LABEL } from './ai';
import { QUESTIONS, type AiFrame } from './ai-runner';
import { BRIEFING } from './briefing';
import type { DirectorEvent } from './director';
import { EXCURSION, EXCURSION_SOURCE } from './excursion';
import { KB_STATS } from './kb-stats';
import type { ModelFrame } from './model';
import { picturesOf } from './pictures';
import { readRecord, recordLines } from './records';
import { modelTime } from './session-scenes';
import type { FrontId, Role } from './settings';

const shots = import.meta.glob('./shots/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const shot = (name: string) => shots[`./shots/${name}.jpg`];

/** Какой вид рисовать по ролям окна: вместе, только карта, только ИИ, только ход, ИИ и ход рядом. */
export function roleLayout(roles: Role[]): 'all' | 'map' | 'ai' | 'app' | 'pair' {
  const map = roles.includes('map');
  const ai = roles.includes('ai');
  const progress = roles.includes('progress');
  if (map && ai && progress) return 'all';
  if (!map && ai && progress) return 'pair';
  if (map) return 'map';
  if (progress) return 'app';
  return 'ai';
}

/** Кнопка старта и переключатель голоса. Голос не начинает сеанс. */
export function AttractActions({ voice, send, start = true }: { voice: boolean; send: (ev: DirectorEvent) => void; start?: boolean }) {
  return (
    <div className="expo-attract-actions">
      {start && <button className="expo-primary">Коснитесь, чтобы принять командование</button>}
      <button
        type="button"
        className="expo-secondary expo-voice-toggle"
        aria-pressed={voice}
        onClick={(e) => {
          e.stopPropagation();
          send({ t: 'voice' });
        }}
      >
        {voice ? 'Голос: вкл' : 'Голос: выкл'}
      </button>
    </div>
  );
}

/** Экран «Как работает штаб ИИ». */
export function HowStaff({ foot }: { foot?: ReactNode }) {
  const n = KB_STATS.entries.toLocaleString('ru-RU');
  return (
    <section className="expo-board">
      <p className="expo-kicker">Четыре части одного штаба</p>
      <h1>Как работает штаб ИИ</h1>
      <ul className="expo-board-list">
        <li>
          <b>Модель.</b> Ядро ведёт армии по часам: движение, бой, потери и снабжение. Противник идёт по историческому замыслу.
        </li>
        <li>
          <b>База знаний.</b> {n} записей и {KB_STATS.sources} источников. У цифры на стенде подписан источник.
        </li>
        <li>
          <b>Переигровка.</b> Три решения меняют ход вашего фронта. Соседи остаются на истории.
        </li>
        <li>
          <b>Голос.</b> Фразы стенда записаны заранее. Ответ на вопрос штаб может сказать живым голосом.
        </li>
      </ul>
      {foot}
    </section>
  );
}

const APP_SHOTS = [
  { file: 'map', title: 'Карта операции', text: 'Армии, удары за сутки, рубежи обороны и разграничительные линии.' },
  { file: 'staff', title: 'Штаб', text: 'Сводка, доклады фронтов, приказы и ветви переигровки.' },
  { file: 'kb', title: 'База знаний', text: 'Запись операции: факты, источники и вопросы к модели.' },
];

/** Экран «Полная версия»: что умеет основное приложение, снимки и рекорд дня. */
export function FullVersion({ foot }: { foot?: ReactNode }) {
  const rec = recordLines(readRecord());
  const day = [rec.speed, rec.cost].filter(Boolean).join('; ');
  return (
    <section className="expo-board expo-full">
      <p className="expo-kicker">Основное приложение</p>
      <h1>Полная версия</h1>
      <p className="expo-lead">Та же операция целиком: карта, штаб, база знаний и сравнение с историей.</p>
      <div className="expo-shots">
        {APP_SHOTS.map((s) => (
          <figure key={s.file}>
            <img src={shot(s.file)} alt={s.title} />
            <figcaption>
              {s.title}
              <small>{s.text}</small>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="expo-record">{day ? `Рекорд дня: ${day}.` : 'Рекорда дня ещё нет: он появится после первого сеанса.'}</p>
      {foot}
    </section>
  );
}

/** Справка-экскурс: факты статьи, архивный кадр с его подписью. */
export function Excursion({ point }: { point: number }) {
  const beat = EXCURSION[point] ?? EXCURSION[0];
  const pic = picturesOf('archive').find((p) => p.file === beat.photo);
  return (
    <section className="expo-board expo-note">
      <p className="expo-kicker">Справка</p>
      <h1>{beat.title}</h1>
      <dl className="expo-brief-facts" data-n={beat.facts.length}>
        {beat.facts.map((f) => (
          <div key={f.value + f.label}>
            <dt>{f.value}</dt>
            <dd>{f.label}</dd>
          </div>
        ))}
      </dl>
      <p className="expo-lead">{beat.text}</p>
      {pic && (
        <figure className="expo-note-photo">
          <img src={pic.src} alt={pic.caption} style={pic.focus ? { objectPosition: pic.focus } : undefined} />
          <figcaption>
            {pic.caption}
            <small>{pic.author}</small>
          </figcaption>
        </figure>
      )}
      <p className="expo-record">Источник: {EXCURSION_SOURCE}.</p>
    </section>
  );
}

/** Что важно на переломе — без подсказки, какой вариант брать. */
const FOCUS: Record<string, string> = {
  'su_1bf-1': 'Перед фронтом главная полоса 9-й армии на высотах. Решает, когда вводить танковые армии.',
  'su_1bf-2': 'Танковые армии у города. Развилка: входить в Берлин, обходить его или сначала бить 9-ю армию.',
  'su_1bf-3': 'Бои в городе и котёл 9-й армии юго-восточнее. На оба дела сразу сил не хватит.',
  'su_1uf-1': 'Перед фронтом Нейсе и оборона 4-й танковой. Решает ширина прорыва и момент ввода танков.',
  'su_1uf-2': 'Шпрее позади. Дорога открыта на запад, к Эльбе, и на север, к Берлину.',
  'su_1uf-3': 'Танковые армии у южных окраин. Рядом котёл 9-й армии, впереди Эльба.',
};

/** Подпись состояния голоса на панели штаба. */
export function voiceLabel(ai: AiFrame): string {
  if (ai.ear === 'listen') return 'Слушаю';
  if (ai.thinking && !ai.answer?.text) return 'Думаю';
  if (ai.line || ai.ear === 'speak') return 'Отвечаю';
  return 'Молчит';
}

function coreLine(model: ModelFrame): string {
  if (model.error) return model.error;
  const mv = model.view;
  if (!mv) return 'Ядро готовит сеанс';
  if (mv.busy) return 'Ядро считает ход';
  const bits = [`Ядро: ${modelTime(mv.time)}`];
  if (mv.berlinKm) bits.push(`до Берлина ${mv.berlinKm.now} км, в этот день истории — ${mv.berlinKm.history} км`);
  if (mv.decisions.length && mv.loss.own > 0) bits.push(`потери ${mv.loss.own.toLocaleString('ru-RU')}`);
  return bits.join(' · ');
}

/** Рабочая панель «Штаб ИИ»: вопросы, разбор без подсказки исхода, источники, ядро и голос. */
export function StaffBoard({
  front,
  n,
  model,
  ai,
  send,
}: {
  front: FrontId;
  n: 1 | 2 | 3;
  model: ModelFrame;
  ai: AiFrame;
  send: (ev: DirectorEvent) => void;
}) {
  const facts = (BRIEFING[front][5]?.facts ?? []).slice(0, 2);
  const sources = [...new Set(facts.map((f) => f.source))];
  const voice = voiceLabel(ai);
  return (
    <section className="expo-side expo-ai-screen expo-staff">
      <h2>Штаб ИИ</h2>
      <p className="expo-staff-chips">
        <span className="expo-chip" data-on={voice !== 'Молчит' || undefined}>Голос: {voice}</span>
        <span className="expo-chip">{coreLine(model)}</span>
      </p>
      <p className="expo-lead">{FOCUS[`${front}-${n}`]}</p>
      {!!facts.length && (
        <>
          <h3 className="expo-sum-h">Соотношение на 16 апреля</h3>
          <dl className="expo-brief-facts" data-n={facts.length}>
            {facts.map((f) => (
              <div key={f.value}>
                <dt>{f.value}</dt>
                <dd>{f.label}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <p className="expo-record">
        Источники: {sources.join('; ')}. Ядро переигровки — положения армий, потери и события хода.
        {ai.answer?.source ? ` Ответ: ${SOURCE_LABEL[ai.answer.source]}.` : ''}
      </p>
      <div className="expo-staff-q" role="group" aria-label="Вопросы штабу">
        {QUESTIONS.map((q) => (
          <button key={q} className="expo-secondary" onClick={() => send({ t: 'ask', q })}>
            {q}
          </button>
        ))}
      </div>
      {ai.answer && (
        <div className="expo-answer">
          <p className="expo-q">{ai.answer.q}</p>
          <p>{ai.answer.text || ai.thinking}</p>
        </div>
      )}
    </section>
  );
}
