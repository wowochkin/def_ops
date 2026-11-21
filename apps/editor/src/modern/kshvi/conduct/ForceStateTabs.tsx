import { useState, type KeyboardEvent } from 'react';

const tabs = ['Оснащённость', 'МПС', 'Готовность', 'Построение', 'МТО'] as const;
type ForceTab = typeof tabs[number];

function DataValue({ value, reported = false }: { value: number | null; reported?: boolean }) {
  if (value === null) return <span className="kshvi-data-unknown">Неизвестно</span>;
  return <span>{value} {reported && <mark className="kshvi-data-reported">Донесено</mark>}</span>;
}

export function ForceStateTabs({ initialTab = 'Оснащённость' }: { initialTab?: ForceTab }) {
  const [active, setActive] = useState<ForceTab>(initialTab);
  function navigate(event: KeyboardEvent<HTMLDivElement>): void {
    const index = tabs.indexOf(active);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActive(tabs[next]);
    document.getElementById(`force-tab-${tabs[next]}`)?.focus();
  }
  return <section className="kshvi-conduct-panel kshvi-force-state" aria-labelledby="force-state-title">
    <h2 id="force-state-title">Состояние силы</h2>
    <div role="tablist" aria-label="Состояние силы" onKeyDown={navigate}>
      {tabs.map(tab => <button key={tab} id={`force-tab-${tab}`} type="button" role="tab" aria-selected={active === tab} aria-controls="force-state-panel" tabIndex={active === tab ? 0 : -1} onClick={() => setActive(tab)}>{tab}</button>)}
    </div>
    <div id="force-state-panel" role="tabpanel" aria-labelledby={`force-tab-${active}`}>
      {active === 'Оснащённость' && <><h3>Оснащённость и исправность</h3><p>Факт/штат: 8/10</p><p>Исправно: <DataValue value={7} reported />; резерв: <DataValue value={1} /></p></>}
      {active === 'МПС' && <><h3>Компоненты МПС и история</h3><p>Моральное состояние: <DataValue value={0.7} reported /></p><p>Психологическая устойчивость: <DataValue value={null} /></p><p>История: воздействие event-1 учтено один раз.</p></>}
      {active === 'Готовность' && <><h3>Готовность</h3><p>Незавершённые мероприятия: пополнение ГСМ, проверка связи.</p></>}
      {active === 'Построение' && <><h3>Построение</h3><p>Первый эшелон: рубеж А; вторая колонна: маршрут Б; остаток пути 4000 м.</p></>}
      {active === 'МТО' && <><h3>Заявки, поставки, ремонт, маршруты и дефицит</h3><p>Заявка request-1 · поставка supply-1 · ремонт repair-2</p><p>Маршрут route-1: открыт; дефицит fuel: 2 Л.</p><p>Фактор расчёта: resourceDeficit</p></>}
    </div>
  </section>;
}
