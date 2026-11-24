import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { AgentEnginePort, AgentEvaluation, AgentEvaluationRequest } from '../../../../packages/kshvi-agents/src/ports/agent-engine';

export interface RustWorkerTransport {
  call(frame: string): Promise<string>;
  close?(): Promise<void>;
}

interface WorkerReply {
  id?: number;
  ok: boolean;
  evaluation?: AgentEvaluation;
  error?: string;
}

export class RustWorker implements AgentEnginePort {
  private sequence = 0;
  private closed = false;

  constructor(private readonly transport: RustWorkerTransport = persistentRustTransport()) {}

  async evaluateChoices(request: AgentEvaluationRequest): Promise<AgentEvaluation> {
    if (this.closed) throw new Error('Rust worker уже остановлен');
    const id = ++this.sequence;
    const frame = JSON.stringify({ id, request }, (_key, value: unknown) => typeof value === 'bigint' ? `${value}n` : value);
    const reply = JSON.parse(await this.transport.call(frame)) as WorkerReply;
    if (!reply.ok || !reply.evaluation) throw new Error(reply.error ?? 'Rust worker не вернул решение');
    return reply.evaluation;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport.close?.();
  }
}

export function persistentRustTransport(manifestPath?: string): RustWorkerTransport {
  const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const child: ChildProcessWithoutNullStreams = spawn('cargo', [
    'run', '--quiet', '--manifest-path', manifestPath ?? 'crates/agents-kshvi/Cargo.toml', '--bin', 'agents-kshvi-worker',
  ], { cwd: repositoryRoot, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, { resolve: (line: string) => void; reject: (error: Error) => void }>();
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  lines.on('line', line => {
    try {
      const reply = JSON.parse(line) as { id?: number };
      const waiter = reply.id === undefined ? pending.values().next().value : pending.get(reply.id);
      if (!waiter) return;
      if (reply.id !== undefined) pending.delete(reply.id);
      else pending.delete(pending.keys().next().value ?? -1);
      waiter.resolve(line);
    } catch { /* stderr содержит диагностику протокола */ }
  });
  child.on('error', error => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  child.on('exit', code => {
    if (code !== 0) {
      const error = new Error(`Rust worker завершился с кодом ${code}: ${stderr.trim()}`);
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    }
  });
  return {
    call(frame: string) {
      const id = (JSON.parse(frame) as { id: number }).id;
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${frame}\n`, error => {
          if (error) {
            pending.delete(id);
            reject(error);
          }
        });
      });
    },
    async close() {
      for (const waiter of pending.values()) waiter.reject(new Error('Rust worker остановлен'));
      pending.clear();
      lines.close();
      child.stdin.end();
      if (child.exitCode === null && !child.killed) child.kill();
    },
  };
}
