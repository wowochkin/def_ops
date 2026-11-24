import type { DualChainState } from '../../../../../../packages/kshvi/src/documents/browser';

export function ApprovalPanel(props: {
  dual: DualChainState;
  actorId: string;
  onResolve?: () => void;
}) {
  const { dual } = props;
  const finalApprover = dual.finalApprover ?? 'designatedAuthority';
  return <section aria-label="Двойная вертикаль согласования">
    <h2>Согласование по двум ветвям</h2>
    <p>Командная ветвь: {dual.command}</p>
    <p>Функциональная ветвь: {dual.service}</p>
    {dual.positions?.command && <blockquote>{dual.positions.command}</blockquote>}
    {dual.positions?.service && <blockquote>{dual.positions.service}</blockquote>}
    {dual.state === 'CONFLICT' && <div role="alert">
      <strong>Конфликт ветвей согласования</strong>
      <p>Согласие одной ветви не заменяет общее согласование.</p>
    </div>}
    <p>Разрешает: {finalApprover}</p>
    {dual.resolution && <p>Решение: {dual.resolution.comment}</p>}
    <button type="button" disabled={dual.state !== 'CONFLICT' || props.actorId !== finalApprover} onClick={props.onResolve}>
      Разрешить разногласие
    </button>
  </section>;
}
