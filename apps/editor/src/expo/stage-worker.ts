/** Воркер карты стенда: документ полного режима по ходу ядра строится здесь — несколько секунд счёта не трогают окно. */
import { contextFrom, type AgentHistory, type AgentTrace } from '@def-ops/sim';
import { getData } from '../sim/userdata';
import { BANK } from './bank';
import { stageDoc } from './stage-doc';

let base: ReturnType<typeof contextFrom> | null = null;
self.onmessage = async (e: MessageEvent<{ id: number; trace: AgentTrace; history: AgentHistory }>) => {
  const { id, trace, history } = e.data;
  try {
    base ??= contextFrom((kind, file) => getData(kind, file), BANK.context);
    const { ctx, history: baseHistory } = await base;
    postMessage({ id, doc: stageDoc(ctx, trace, history, baseHistory) });
  } catch (err) {
    postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
