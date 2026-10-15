/**
 * Строка отметки сборки данных из базы знаний под итогом расчёта; now — нынешняя сборка операции: другая — пометка,
 * что сейчас данные другие (пересчёт даст другой итог при том же seed).
 */
import { KB_STAMP_HINT, kbStampShort, kbStampText, kbStampTime, sameKbStamp, type KbStamp } from './sim/kb-stamp';

export function KbStampNote({ s, now }: { s: KbStamp | null | undefined; now?: KbStamp | null }) {
  if (s === undefined) return null;
  const other = sameKbStamp(s, now) === false;
  return <p className={`kb-stamp small${other ? ' warn' : ' muted'}`} title={`${kbStampText(s)}${s ? ` (отпечаток ${s.id})` : ''}\n${KB_STAMP_HINT}`}>
    {kbStampShort(s)}{other && <> · сейчас другая: {now ? kbStampTime(now.at) : 'без сборки'}</>}
  </p>;
}
