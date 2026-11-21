import { useState } from 'react';

const audiences = [
  ['GENERAL_SERVICE', 'общий служебный'], ['SIDE', 'сторонний'], ['TRAINEE', 'обучаемый'], ['PUBLIC_FINAL', 'публичный итоговый'],
] as const;
type Audience = typeof audiences[number][0];

export function ProjectorWorkspace() {
  const [audience, setAudience] = useState<Audience | ''>('');
  const [shown, setShown] = useState(false);
  const label = audiences.find(([id]) => id === audience)?.[1];
  return <main className="kshvi-conduct-workspace kshvi-projector">
    <header className="kshvi-conduct-header"><div><p className="kshvi-kicker">КШВИ · изолированная аудиторная проекция</p><h1>Проектор</h1></div></header>
    <section className="kshvi-conduct-panel">
      <label>Профиль аудитории<select value={audience} onChange={event => { setAudience(event.target.value as Audience | ''); setShown(false); }}><option value="">Не выбрана</option>{audiences.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
      {!audience && <p>Аудитория не выбрана</p>}
      {audience && <p>Проверка видимости: {label}</p>}
      <p>Профиль предыдущего пользователя не восстанавливается. Серверная проекция загружается заново для каждой аудитории.</p>
      <button type="button" disabled={!audience} onClick={() => setShown(true)}>Вывести на проектор</button>
      <span>Соединение: подключено · Синхронизировано: 2030-01-01T02:00:00Z</span>
    </section>
    {shown && audience && <section key={audience} className="kshvi-projector-output" aria-label={`Проекция: ${label}`}>
      {audience === 'PUBLIC_FINAL' ? <><h2>Публичный итог этапа</h2><p>Разрешённые итоговые события и условные знаки без служебных решений.</p></>
        : <><h2>Аудиторная проекция: {label}</h2><p>Отображаются только поля, разрешённые выбранной серверной политикой.</p></>}
      <div className="kshvi-map-marker">Карта · лента · оперативное время 2030-01-01T01:40:00Z</div>
    </section>}
  </main>;
}
