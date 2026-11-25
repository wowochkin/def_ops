import { MORALE_COMPONENT_NAMES, type MoraleComponentName, type MoralePsychState } from '../../../../../../packages/kshvi/src/forces/morale-model';

const labels: Record<MoraleComponentName, string> = {
  morale: 'Моральный дух', cohesion: 'Сплочённость', stress: 'Напряжение', fatigue: 'Утомление',
  commandTrust: 'Доверие к управлению', recoveryCapacity: 'Способность к восстановлению',
};

export function MoralePsychEditor({ value, onChange }: { value: MoralePsychState; onChange(value: MoralePsychState): void }) {
  return <fieldset className="morale-editor"><legend>Морально-психологическое состояние моделируемой силы</legend>
    <p>Значения влияют на приказы, движение, исполнение задач и доклады через профиль МПС. Это не оценка реальных людей.</p>
    {MORALE_COMPONENT_NAMES.map(name => {
      const component = value.components[name];
      const known = component.status === 'KNOWN';
      return <div className="morale-row" key={name}>
        <label>{labels[name]}<input aria-label={labels[name]} type="range" min="0" max="1" step="0.05" value={known ? component.value : 0.5}
          onChange={event => onChange({ ...value, components: { ...value.components, [name]: {
            status: 'KNOWN', value: Number(event.target.value), uncertainty: 'ESTIMATED', observedAt: value.at,
            source: {
              kind: 'EDUCATIONAL_ASSUMPTION', reference: 'Ручной ввод автора сценария', assumptionId: `manual-mps-${value.subject.forceId}`,
              approvedBy: 'Автор сценария', applicability: 'Только исходное состояние моделируемой силы данного сценария',
            },
          } } })} /></label>
        <span>{known ? component.value.toFixed(2) : 'Нет доклада'}</span>
        <small>{known ? component.source.reference : component.reason}</small>
      </div>;
    })}
  </fieldset>;
}
