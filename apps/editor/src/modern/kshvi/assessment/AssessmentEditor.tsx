import { useState } from 'react';

export function AssessmentEditor({ systemProposal, onApprove }: {
  systemProposal: string;
  onApprove: (value: { finalAssessment: string; comment: string }) => void;
}) {
  const [finalAssessment, setFinalAssessment] = useState('');
  const [comment, setComment] = useState('');
  return <form onSubmit={event => {
    event.preventDefault();
    if (finalAssessment.trim() && comment.trim()) onApprove({ finalAssessment, comment });
  }}>
    <h2>Лист оценки</h2>
    <p>{systemProposal}</p>
    <p>Проект системы не является итоговой оценкой и не заменяет качественный разбор.</p>
    <label>Итоговая оценка руководителя<input value={finalAssessment} onChange={event => setFinalAssessment(event.currentTarget.value)} required /></label>
    <label>Комментарий руководителя<textarea value={comment} onChange={event => setComment(event.currentTarget.value)} required /></label>
    <button type="submit">Утвердить человеческую оценку</button>
  </form>;
}
