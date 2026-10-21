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

export function StartView({ llm }: { llm: Llm }) {
  const [intro] = useIntroSetting();
  const st = llm.check.state;
  return (
    <div className="page" data-tour="section-start">
      <div className="page-in start">
        <h2>Штабные игры с участием искусственного интеллекта</h2>
        <p className="lead">Переигровка операций Великой Отечественной войны: вы командуете советской стороной, немецким штабом командует языковая модель на этом компьютере, а бои и движение считает арбитр по нормативам и базе знаний. Всё работает на вашем компьютере, без интернета.</p>
        <section className="card start-tour" data-tour="start-tour">
          <ActButton className="primary start-go" action="tour.intro">Начать экскурсию</ActButton>
          <div>
            <b>Экскурсия «О приложении»</b>
            <p>Около двух минут: что это за программа, откуда данные, что в каждом разделе. Идёт по шагам с подсветкой; можно слушать голос штаба или читать подписи. В любой момент — «Хватит».</p>
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
