import { useState } from 'react';

export type ConceptStepProps = Readonly<{
  initialTitle?: string;
  onSave?: (title: string) => Promise<void> | void;
}>;

export function ConceptStep({ initialTitle = '', onSave }: ConceptStepProps) {
  const [title, setTitle] = useState(initialTitle);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!onSave) {
      setError('Серверная редакция не подключена');
      return;
    }
    setPending(true);
    setError('');
    try {
      await onSave(title.trim());
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Серверная редакция не сохранена');
    } finally {
      setPending(false);
    }
  }
  return <section aria-labelledby="concept-title">
    <h2 id="concept-title">Замысел учения</h2>
    <label>Тема учения<input value={title} onChange={event => { setTitle(event.target.value); setSaved(false); }} /></label>
    <p>Общий замысел не публикуется всем обучаемым</p>
    <button disabled={pending || !onSave} onClick={save}>Сохранить черновик</button>
    {!onSave && <p role="alert">Серверная редакция не подключена</p>}
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Серверная редакция сохранена; требуется проверка комплекта</p>}
  </section>;
}
