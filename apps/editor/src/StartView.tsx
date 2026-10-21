/**
 * Начальная страница («Начало»): первый раздел при запуске. Что это за приложение, кнопка экскурсии «О приложении»
 * (то же действие, что «Штаб, расскажи о приложении»), переходы по разделам с короткими пояснениями, состояние
 * языковой модели и флажок «Вступление при запуске». Всё — через действия реестра: кнопки и голос делают одно и то же.
 */
import { ActButton } from './voice/registry';
import { useIntroSetting } from './voice/tour';
import { act } from './voice/registry';
import type { Llm } from './shared';
import type { Section } from './sections';

const WHAT: { id: Exclude<Section, 'start'>; text: string }[] = [
  { id: 'replay', text: 'Рассчитать операцию, сравнить с историей, принять командование и играть против модели' },
  { id: 'editor', text: 'Наносить обстановку на карту условными знаками, по слоям и по времени' },
  { id: 'modeling', text: 'Правила арбитра, сравнение с историей, настройка и калибровка модели' },
  { id: 'maps', text: 'Карты-подложки и карты местности для переигровки' },
  { id: 'library', text: 'Справочник условных знаков' },
  { id: 'knowledge', text: 'База знаний по операциям: материалы, документы, очередь на проверку' },
  { id: 'staff', text: 'Связь с языковой моделью на этом компьютере (немецкий штаб, советник)' },
];
const TITLE: Record<string, string> = { replay: 'Переигровка', editor: 'Редактор', modeling: 'Моделирование', maps: 'Карты', library: 'Знаки', knowledge: 'Знания', staff: 'ИИ' };

/** Анимированная карта в шапке: рубеж, реки, стрелки наступления к Берлину, пульсирующая отметка. Только рисунок. */
function StartMap() {
  return (
    <svg className="start-map" viewBox="0 0 1200 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="sm-grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="#fff" strokeOpacity=".05" /></pattern>
        <marker id="sm-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#e0574a" /></marker>
      </defs>
      <rect width="1200" height="380" fill="url(#sm-grid)" />
      <path className="sm-river" d="M-20 110C180 150 260 80 430 130S690 210 860 160 1100 120 1230 170" />
      <path className="sm-river" d="M-20 300C150 270 330 330 520 290S820 250 1000 300 1160 320 1230 290" />
      <path className="sm-front" d="M520 20C500 90 560 130 540 200S500 290 530 370" />
      <g className="sm-arrows">
        <path pathLength="100" style={{ ['--d' as string]: '0s' }} d="M40 250C220 240 340 200 500 170" markerEnd="url(#sm-head)" />
        <path pathLength="100" style={{ ['--d' as string]: '.5s' }} d="M60 150C230 150 360 140 500 120" markerEnd="url(#sm-head)" />
        <path pathLength="100" style={{ ['--d' as string]: '1s' }} d="M80 330C260 320 400 270 510 240" markerEnd="url(#sm-head)" />
        <path pathLength="100" className="sm-main" style={{ ['--d' as string]: '1.6s' }} d="M520 170C640 150 760 170 900 190S1010 200 1040 190" markerEnd="url(#sm-head)" />
      </g>
      <g className="sm-enemy">
        <path d="M1180 90C1100 110 1040 140 990 160" /><path d="M1190 260C1110 240 1050 220 1000 205" />
      </g>
      <g className="sm-city" transform="translate(1040 190)">
        <circle className="sm-pulse" r="8" /><circle className="sm-pulse sm-p2" r="8" /><circle r="5" fill="#f2c14e" />
      </g>
    </svg>
  );
}

export function StartView({ llm }: { llm: Llm }) {
  const [intro] = useIntroSetting();
  const st = llm.check.state;
  return (
    <div className="page" data-tour="section-start">
      <header className="start-hero">
        <StartMap />
        <div className="start-hero-in">
          <p className="start-kicker rv" style={{ ['--i' as string]: 0 }}>Штабные игры с участием искусственного интеллекта</p>
          <h2 className="rv" style={{ ['--i' as string]: 1 }}>Что было бы, если бы приказ ушёл на сутки раньше?</h2>
          <p className="lead rv" style={{ ['--i' as string]: 2 }}>Вы командуете советской стороной в операциях 1945 года. Противником командует искусственный интеллект — языковая модель, работающая на вашем компьютере: она видит только то, что видел бы настоящий немецкий штаб. Исход каждых суток считает арбитр по нормативам, у каждого из которых — источник. И всё это можно сразу сверить с тем, как было на самом деле.</p>
          <div className="start-ops rv" style={{ ['--i' as string]: 3 }} aria-label="Операции">
            <span>Берлинская операция</span><span>Бой в Берлине</span><span>Висло-Одерская операция</span>
          </div>
        </div>
      </header>
      <div className="page-in start">
        <div className="start-pillars" data-tour="start-pillars">
          <div className="card rv" style={{ ['--i' as string]: 4 }}><b>Противником командует искусственный интеллект</b><span>Не сценарий и не набор триггеров: немецкий штаб — языковая модель. Она оценивает обстановку, строит замысел и отдаёт приказы. О ваших войсках знает лишь то, что дала ей разведка.</span></div>
          <div className="card rv" style={{ ['--i' as string]: 5 }}><b>Исход считает арбитр</b><span>Бои, движение, подвоз, окружения — по правилам, а не по вдохновению. У норматива есть источник; нет опоры — так и написано: «допущение». Спорную цифру можно открыть, проверить и поправить.</span></div>
          <div className="card rv" style={{ ['--i' as string]: 6 }}><b>История рядом</b><span>Расчётный фронт идёт вровень с историческим: видно, где игра разошлась с реальностью и в какие сутки. Приказы доходят до войск с той же задержкой, что и тогда.</span></div>
          <div className="card rv" style={{ ['--i' as string]: 7 }}><b>Всё у вас на компьютере</b><span>Без интернета и без облака: карты, база знаний, модель. Ничего не уходит наружу, а база знаний — ваша: свои документы, свои проверки, свои выводы.</span></div>
        </div>
        <p className="start-cta">Две минуты — и вы увидите, как это устроено.</p>
        <section className="card start-tour" data-tour="start-tour">
          <ActButton className="primary start-go" action="tour.intro">Начать экскурсию</ActButton>
          <div>
            <b>Экскурсия «О приложении»</b>
            <p>Около двух минут: что это за программа, откуда данные, что в каждом разделе. Шаг за шагом, с подсветкой; голос штаба рассказывает, подписи можно читать. В любой момент — «Хватит».</p>
            <label className="start-intro">
              <input type="checkbox" checked={intro} onChange={(e) => { void act(e.target.checked ? 'tour.introOn' : 'tour.introOff'); }} /> Показывать вступление при запуске
            </label>
          </div>
        </section>
        <h3>Разделы</h3>
        <div className="start-grid" data-tour="start-sections">
          {WHAT.map((w) => (
            <ActButton key={w.id} className="card start-card" action="shell.open" params={{ section: w.id }} data-tour={`start-${w.id}`}>
              <b>{TITLE[w.id]}</b>
              <span>{w.text}</span>
            </ActButton>
          ))}
        </div>
        <section className="card start-llm" data-tour="start-llm">
          <b>Языковая модель</b>
          <span className={`llm-st ${st}`}>{st === 'ok' ? `✓ на связи · моделей: ${llm.check.models.length}` : st === 'fail' ? `✗ ${llm.check.error}` : 'проверка…'}</span>
          {st === 'fail' && <ActButton action="shell.open" params={{ section: 'staff' }}>Открыть «ИИ»</ActButton>}
          <small>Без неё немецкий штаб, советник и свободные фразы голосом не работают; расчёты и справочники — работают.</small>
        </section>
        <p className="note">Голос (только Mac с Apple Silicon, настольное приложение): панель голоса — вверху по центру. Скажите «Штаб, расскажи о приложении» или «Штаб, что я могу?».</p>
      </div>
    </div>
  );
}
