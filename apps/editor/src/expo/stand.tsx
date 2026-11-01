/**
 * Экраны заставки, у каждого своё: как устроен штаб ИИ, переигровка на карте, полная версия приложения.
 */
import type { ReactNode } from 'react';
import type { DirectorEvent } from './director';
import { KB_STATS } from './kb-stats';
import { readRecord, recordLines } from './records';
import type { Role } from './settings';

const shots = import.meta.glob('./shots/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const shot = (name: string) => shots[`./shots/${name}.jpg`];

/** Какой экран заставки рисовать по ролям окна. */
export function attractLayout(roles: Role[]): 'all' | 'map' | 'ai' | 'app' | 'pair' {
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
