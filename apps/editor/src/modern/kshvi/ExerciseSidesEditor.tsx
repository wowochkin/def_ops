import type { ScenarioSide } from '../../../../../packages/kshvi/src/scenario/sides';

export function ExerciseSidesEditor({ value, onChange }: {
  value: readonly ScenarioSide[];
  onChange(sides: readonly ScenarioSide[]): void;
}) {
  function patch(index: number, change: Partial<ScenarioSide>) {
    onChange(value.map((side, current) => current === index ? { ...side, ...change } : side));
  }
  return <fieldset className="kshvi-exercise-sides">
    <legend>Стороны учения</legend>
    <p className="kshvi-form-note">Название обязательно, страна необязательна, цвет — красный или синий.</p>
    {value.map((side, index) => <div className="kshvi-exercise-side" key={side.id}>
      <label>{`Название стороны ${index + 1}`}
        <input value={side.name} required onChange={event => patch(index, { name: event.target.value })} />
      </label>
      <label>{`Страна стороны ${index + 1} (необязательно)`}
        <input value={side.country ?? ''} onChange={event => patch(index, { country: event.target.value || null })} />
      </label>
      <label>{`Цвет стороны ${index + 1}`}
        <select value={side.color} onChange={event => patch(index, { color: event.target.value === 'red' ? 'red' : 'blue' })}>
          <option value="red">Красный</option><option value="blue">Синий</option>
        </select>
      </label>
      <button type="button" disabled={value.length === 1} onClick={() => onChange(value.filter((_, current) => current !== index))}>Удалить</button>
    </div>)}
    <button type="button" onClick={() => onChange([...value, {
      id: `side-${crypto.randomUUID()}`, name: 'Новая сторона', country: null, color: 'blue',
    }])}>Добавить сторону</button>
  </fieldset>;
}
