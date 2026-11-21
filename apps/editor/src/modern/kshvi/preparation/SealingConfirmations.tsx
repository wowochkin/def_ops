import type { ReadinessConfirmation } from '../../../../../../packages/kshvi/src/scenario/sealing';

export function SealingConfirmations({ required, confirmations }: Readonly<{
  required: readonly string[];
  confirmations: readonly ReadinessConfirmation[];
}>) {
  return <section aria-labelledby="sealing-confirmations-title">
    <h3 id="sealing-confirmations-title">Персональные подтверждения</h3>
    <table>
      <thead><tr><th>Контур</th><th>Ответственный</th><th>Состояние</th></tr></thead>
      <tbody>{required.map(area => {
        const confirmation = confirmations.find(item => item.area === area);
        return <tr key={area}>
          <td>{area}</td>
          <td>{confirmation?.userId ?? '—'}</td>
          <td>{confirmation ? `Подтверждено: ${confirmation.confirmedAt}` : `Требуется подтверждение: ${area}`}</td>
        </tr>;
      })}</tbody>
    </table>
  </section>;
}
