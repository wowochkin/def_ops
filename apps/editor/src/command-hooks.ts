/**
 * Связки React окна командования, вынесенные, чтобы их можно было проверить отдельно: смена пункта управления снимает
 * начатый выбор точек; новая линия игры (возврат к ходу, переход на ветвь) снимает варианты советника.
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { pickOnPost } from './voice/actions/staff';

/** Смена пункта управления или уровня: начатый выбор точек (ходатайство, тыл, переправы, резервы) — уже не для этого пункта. */
export function usePickOnPost<P>(issuer: string | null, level: string, setPick: Dispatch<SetStateAction<P | null>>): void {
  const was = useRef({ issuer, level });
  useEffect(() => {
    const now = { issuer, level };
    setPick((p) => pickOnPost(p, was.current, now));
    was.current = now;
  }, [issuer, level]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Новая линия игры (epoch сменился после первой отрисовки) — reset: варианты прежней линии снимаются. */
export function useLineReset(epoch: number, reset: () => void): void {
  const was = useRef(epoch);
  const fn = useRef(reset); fn.current = reset;
  useEffect(() => { if (was.current !== epoch) { was.current = epoch; fn.current(); } }, [epoch]);
}
