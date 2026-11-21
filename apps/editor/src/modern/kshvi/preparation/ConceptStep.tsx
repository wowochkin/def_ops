import { useState } from 'react';

export function ConceptStep() {
  const [title, setTitle] = useState('');
  const [saved, setSaved] = useState(false);
  return <section aria-labelledby="concept-title">
    <h2 id="concept-title">Замысел учения</h2>
    <label>Тема учения<input value={title} onChange={event => { setTitle(event.target.value); setSaved(false); }} /></label>
    <p>Общий замысел не публикуется всем обучаемым</p>
    <button onClick={() => setSaved(true)}>Сохранить черновик</button>
    {saved && <p role="status">Черновик сохранён; требуется проверка комплекта</p>}
  </section>;
}
