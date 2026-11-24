import { useState, type CSSProperties } from 'react';
import { fragmentUrl } from './symbols-api';

export function SourceImage({ fragmentId, alt, style }: {
  fragmentId: string;
  alt: string;
  style?: CSSProperties;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <>
    <img key={attempt} src={`${fragmentUrl(fragmentId)}?attempt=${attempt}`} alt={alt} style={style}
      onLoad={() => { setLoaded(true); setFailed(false); }}
      onError={() => { setLoaded(false); setFailed(true); }} />
    {!loaded && !failed && <p role="status">Загружаем исходную страницу…</p>}
    {failed && <p role="alert">Исходная страница не загрузилась. Проверьте локальный сервис и повторите. <button type="button" onClick={() => { setAttempt(value => value + 1); setFailed(false); setLoaded(false); }}>Повторить</button></p>}
  </>;
}
