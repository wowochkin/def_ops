/**
 * Экраны заставки, у каждого своё: как устроен штаб ИИ, переигровка на карте, полная версия приложения.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SOURCE_LABEL } from './ai';
import { QUESTIONS, type AiFrame } from './ai-runner';
import { BRIEFING } from './briefing';
import type { DirectorEvent } from './director';
import { EXCURSION, EXCURSION_SOURCE } from './excursion';
import { KB_STATS } from './kb-stats';
import type { ModelFrame } from './model';
import { pictureByFile, picturesOf } from './pictures';
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

/** Экран «Как работает штаб ИИ»: одна сцена, сюжет сменяется, схема на ней движется. */
const HOW = [
  {
    k: 'Модель',
    title: 'Армии идут по часам',
    text: 'Ядро считает сутки операции. Противник идёт по своему замыслу, ваш фронт — по приказам.',
  },
  {
    k: 'База знаний',
    title: 'Ответ называет источник',
    text: 'На вопрос штаб берёт запись из базы и говорит, откуда факт.',
  },
  {
    k: 'Переигровка',
    title: 'Три решения ведут фронт',
    text: 'Соседний фронт в это время идёт своим ходом, как в операции.',
  },
  {
    k: 'ИИ в ходе',
    title: 'Спросили — карта сдвинулась',
    text: 'Штаб отвечает, ядро считает, армии уходят на новый рубеж.',
  },
] as const;

export function HowStaff({ foot }: { foot?: ReactNode }) {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setBeat((n) => (n + 1) % HOW.length), 5600);
    return () => window.clearInterval(id);
  }, []);
  const cur = HOW[beat];
  return (
    <section className="expo-board expo-how">
      <header className="expo-how-head">
        <p className="expo-kicker">Четыре части одного штаба</p>
        <h1>Как работает штаб ИИ</h1>
      </header>
      <div className="expo-how-stage" data-beat={beat}>
        <div key={beat} className="expo-how-art" aria-hidden="true">
          {beat === 0 && (
            <div className="expo-how-clock">
              <span>16</span>
              <span>20</span>
              <span>24</span>
              <i />
              <em>апрель</em>
            </div>
          )}
          {beat === 1 && (
            <div className="expo-how-kb">
              <p>Откуда цифра?</p>
              <b>{KB_STATS.entries.toLocaleString('ru-RU')}</b>
              <small>записей · {KB_STATS.sources} источников</small>
              <em>Кривошеев, «Россия и СССР в войнах XX века»</em>
            </div>
          )}
          {beat === 2 && (
            <div className="expo-how-turns">
              <b>1</b>
              <b>2</b>
              <b>3</b>
            </div>
          )}
          {beat === 3 && (
            <div className="expo-how-flow">
              <div className="expo-how-q">
                <small>Вопрос</small>
                <p>Почему высоты держали так долго?</p>
              </div>
              <div className="expo-how-a">
                <small>Штаб</small>
                <p>Гребень видел всю пойму Одера.</p>
                <em>Кривошеев, «Россия и СССР в войнах XX века»</em>
              </div>
              <div className="expo-how-move">
                <span>Одер</span>
                <span>Берлин</span>
                <i />
                <b />
                <em>16 → 20 апреля</em>
              </div>
            </div>
          )}
        </div>
        <div key={`c${beat}`} className="expo-how-copy">
          <p className="expo-kicker">{cur.k}</p>
          <h2>{cur.title}</h2>
          <p>{cur.text}</p>
        </div>
      </div>
      <ol className="expo-how-rail" aria-hidden="true">
        {HOW.map((x, i) => (
          <li key={x.k} data-on={i === beat || undefined}>{x.k}</li>
        ))}
      </ol>
      {foot}
    </section>
  );
}

const demos = import.meta.glob('./demos/*.{webm,mp4}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const demoOf = (name: string) => demos[`./demos/${name}.webm`] ?? demos[`./demos/${name}.mp4`];

const APP_SHOTS = [
  {
    file: 'map',
    title: 'Карта операции',
    text: 'Армии и удары за сутки, рубежи обороны и разграничительные линии.',
    body: 'Та же карта, что на стенде, без сокращения. Армии, удары за сутки, рубежи и разграничительные линии. Уровень знаков — от фронта до дивизии, время хода двигает знаки и линию фронта. Подложка та, что выбрана в полном режиме.',
  },
  {
    file: 'staff',
    title: 'Штаб',
    text: 'Сводка, доклады фронтов, приказы и ветви переигровки.',
    body: 'Сводка хода, доклады фронтов и приказы соединениям. Ветвь переигровки хранит, что было отдано и чем ход закончился. На стенде из этого остаются три карточки и голос командующего.',
  },
  {
    file: 'modeling',
    title: 'Моделирование',
    text: 'Правила арбитра, сравнение прогона с историей и калибровка по нормативам.',
    body: 'Правила арбитра, сравнение прогона с историей и калибровка по нормативам. Здесь видно, из каких чисел собраны скорость, цена и замысел — на стенде они сжаты в три шкалы итога.',
  },
  {
    file: 'kb',
    title: 'База знаний',
    text: 'Факты операции с источником и вопросы, на которые модель отвечает по базе.',
    body: 'Факты операции, у каждого источник. Вопрос к модели идёт по этим записям: ответ называет, откуда взят факт. На стенде тот же приём — у цифры доклада и у ответа штаба виден источник.',
  },
];

/** Строка рекорда дня: лучшие скорость и потери среди сеансов за сутки. */
export function DayRecordLine() {
  const rec = recordLines(readRecord());
  const day = [rec.speed, rec.cost].filter(Boolean).join('; ');
  return <p className="expo-record">{day ? `Рекорд дня: ${day}.` : 'Рекорд дня появится после первого сеанса.'}</p>;
}

const MARSHAL_PLATE = {
  su_1bf: {
    name: 'Георгий Жуков',
    rank: 'Маршал Советского Союза',
    photo: 'zhukov-portrait.jpg',
    focus: '50% 18%',
    lines: [
      '1-й Белорусский фронт.',
      'С кюстринского плацдарма через Зееловские высоты на Берлин и к Эльбе.',
      'Ставка дала на это двенадцать–пятнадцать суток.',
    ],
  },
  su_1uf: {
    name: 'Иван Конев',
    rank: 'Маршал Советского Союза',
    photo: 'konev-portrait.jpg',
    focus: '50% 16%',
    lines: [
      '1-й Украинский фронт.',
      'С Нейсе на Котбус и Шпремберг, затем поворот на Берлин с юга.',
      'Выход к Эльбе у Торгау.',
    ],
  },
} as const;

/** Портретная карточка командующего на боковом экране выбора фронта. */
export function MarshalPortrait({ id, on }: { id: keyof typeof MARSHAL_PLATE; on: boolean }) {
  const m = MARSHAL_PLATE[id];
  const pic = m.photo ? pictureByFile(m.photo) : null;
  const mark = m.name.split(' ')[1]?.[0] ?? '';
  return (
    <section className={`expo-marshal${on ? ' on' : ''}`} aria-label={m.name}>
      <div className={`expo-marshal-frame${on ? ' on' : ''}`} aria-hidden="true">
        <i /><i /><i /><i />
        <div className="expo-marshal-photo">
          {pic ? <img src={pic.src} alt="" style={{ objectPosition: m.focus }} /> : <span className="expo-marshal-mark">{mark}</span>}
        </div>
      </div>
      <div className="expo-marshal-copy">
        <p className="expo-kicker">{m.rank}</p>
        <h1>{m.name}</h1>
        {m.lines.map((l) => <p key={l}>{l}</p>)}
      </div>
    </section>
  );
}

/** Экран «Полная версия»: ролики по очереди крупно, внизу — переключатель. */
export function FullVersion({ foot }: { foot?: ReactNode }) {
  const [i, setI] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const s = APP_SHOTS[i];
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = true;
    try { v.currentTime = 0; } catch { /* кадр ещё не готов */ }
    const p = v.play?.();
    void p?.catch(() => {});
    const next = () => setI((n) => (n + 1) % APP_SHOTS.length);
    v.addEventListener('ended', next);
    const cap = window.setTimeout(next, 40000);
    return () => { v.removeEventListener('ended', next); window.clearTimeout(cap); };
  }, [i]);
  return (
    <section className="expo-board expo-full">
      <p className="expo-kicker">Основное приложение</p>
      <h1>Полная версия</h1>
      <div className="expo-shot-stage" role="img" aria-label={s.title} onClick={(e) => e.stopPropagation()}>
        {demoOf(s.file)
          ? <video key={s.file} ref={video} src={demoOf(s.file)} poster={shot(s.file)} autoPlay muted playsInline />
          : <img src={shot(s.file)} alt="" />}
        <div className="expo-shot-cap">
          {s.title}
          <small>{s.body}</small>
        </div>
      </div>
      <div className="expo-shot-rail" role="tablist" aria-label="Экраны полной версии">
        {APP_SHOTS.map((x, n) => (
          <button key={x.file} type="button" role="tab" aria-selected={n === i} className={n === i ? 'on' : ''} onClick={(e) => { e.stopPropagation(); setI(n); }}>
            {x.title}
          </button>
        ))}
      </div>
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
      <p className="expo-source">Источник: {EXCURSION_SOURCE}.</p>
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

/** Ответ длиннее рамки медленно едет вверх и вниз, как барабан: читать можно не трогая экран. */
function AnswerDrum({ text, live }: { text: string; live: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [over, setOver] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOver(Math.max(0, el.scrollHeight - el.clientHeight));
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [text]);
  useEffect(() => {
    const el = ref.current;
    if (!el || over < 12 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let y = 0;
    let dir = 1;
    let pause = 30;
    const id = window.setInterval(() => {
      if (pause > 0) { pause -= 1; return; }
      y += dir;
      if (y >= over) { y = over; dir = -1; pause = 36; }
      else if (y <= 0) { y = 0; dir = 1; pause = 36; }
      el.scrollTop = y;
    }, 50);
    return () => window.clearInterval(id);
  }, [over, text]);
  return <p ref={ref} className={`expo-drum${live ? ' live' : ''}`}>{text}</p>;
}

/** Подпись состояния голоса на панели штаба. */
export function voiceLabel(ai: AiFrame): string {
  if (ai.ear === 'listen') return 'Слушаю';
  if (ai.answer && ai.answer.source == null) return ai.answer.text ? 'Отвечаю' : 'Думаю';
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
  const [q, setQ] = useState('');
  const live = !!ai.answer && ai.answer.source == null;
  const ask = (text: string) => {
    const next = text.trim();
    if (!next) return;
    setQ('');
    send({ t: 'ask', q: next });
  };
  return (
    <section className="expo-side expo-ai-screen expo-staff">
      <h2>Штаб ИИ</h2>
      <p className="expo-staff-chips">
        <span className="expo-chip" data-on={voice !== 'Молчит' || undefined}>Голос: {voice}</span>
        <span className="expo-chip">{coreLine(model)}</span>
      </p>
      <p className="expo-lead">{FOCUS[`${front}-${n}`]}</p>
      <form className="expo-ask" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input
          value={q}
          aria-label="Свой вопрос штабу"
          placeholder="Свой вопрос — ответ составит ИИ"
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="expo-primary">Спросить</button>
      </form>
      {(ai.thinking || ai.answer) && (
        <div className={`expo-answer${live || ai.thinking ? ' live' : ''}`}>
          <p className="expo-q">{ai.answer?.q}</p>
          <AnswerDrum text={ai.answer?.text || ai.thinking || ''} live={live || !!ai.thinking} />
        </div>
      )}
      <div className="expo-staff-q" role="group" aria-label="Вопросы штабу">
        {QUESTIONS.map((item) => (
          <button key={item} className="expo-secondary" onClick={() => ask(item)}>
            {item}
          </button>
        ))}
      </div>
      {model.view?.move && (
        <>
          <h3 className="expo-sum-h">Противник за ход</h3>
          <p className="expo-lead">{model.view.move.enemy}</p>
        </>
      )}
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
    </section>
  );
}
