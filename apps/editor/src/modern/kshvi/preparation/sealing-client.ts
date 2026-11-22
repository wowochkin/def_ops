import type { ExerciseInstance, SealScenarioInput, SealedScenario, StartInstanceCommand } from '../../../../../../packages/kshvi/src/scenario/sealing';

export interface SealingClient {
  seal(input: SealScenarioInput): Promise<SealedScenario>;
  start(sealedId: string, command: StartInstanceCommand): Promise<ExerciseInstance>;
}

async function decode<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { message?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? `Сервер КШВИ ответил ${response.status}`);
  return body as T;
}

export function createFetchSealingClient(options: {
  baseUrl?: string;
  csrfToken?: string;
  fetchImpl?: typeof fetch;
} = {}): SealingClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.csrfToken) headers['x-csrf-token'] = options.csrfToken;
  return {
    async seal(input) {
      const response = await fetchImpl(`${baseUrl}/kshvi/sealing`, {
        method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(input),
      });
      return decode<SealedScenario>(response);
    },
    async start(sealedId, command) {
      const response = await fetchImpl(`${baseUrl}/kshvi/sealing/${encodeURIComponent(sealedId)}/instances`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ instanceId: command.instanceId, idempotencyKey: command.idempotencyKey, seed: command.seed }),
      });
      return decode<ExerciseInstance>(response);
    },
  };
}
