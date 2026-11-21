import { useState } from 'react';

export function ResearchCardEditor({ onSave }: {
  onSave: (value: { question: string; limitations: string; causalStatus: 'NOT_ESTABLISHED' }) => void;
}) {
  const [question, setQuestion] = useState('');
  const [limitations, setLimitations] = useState('');
  return <form onSubmit={event => {
    event.preventDefault();
    if (question.trim() && limitations.trim()) onSave({ question, limitations, causalStatus: 'NOT_ESTABLISHED' });
  }}>
    <h2>Исследовательская карточка</h2>
    <p>Наблюдение не доказывает причинность; вывод ограничивается дизайном исследования.</p>
    <label>Вопрос исследования<input value={question} onChange={event => setQuestion(event.currentTarget.value)} required /></label>
    <label>Ограничения<textarea value={limitations} onChange={event => setLimitations(event.currentTarget.value)} required /></label>
    <button type="submit">Сохранить исследование</button>
  </form>;
}
