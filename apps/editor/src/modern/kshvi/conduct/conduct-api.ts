import { readSessionCsrf } from '../session-csrf';
import type { Audience, ConductClient, ConductProjection, DecisionEditorDraft, MassOperationResult } from './shared/types';
import type { OrderPanelModel as DomainOrderPanelModel } from './OrdersPanel';

type Context = { instanceId: string; sideId: string; role: string; operationalAt?: string };
export class HttpConductClient implements ConductClient {
  constructor(private readonly context: Context, private readonly csrfToken: () => string = () => readSessionCsrf()) {}
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(this.csrfToken ? { 'x-csrf-token': this.csrfToken() } : {}), ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      const error = new Error(`Сервер отклонил команду: ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return response.json() as Promise<T>;
  }
  private get(path: string): Promise<ConductProjection> {
    return this.request<ConductProjection | { projection: ConductProjection }>(path).then(result => 'projection' in result ? result.projection : result);
  }
  private post<T>(type: string, payload: unknown): Promise<T> {
    return this.request<T>(`/api/kshvi/instances/${encodeURIComponent(this.context.instanceId)}/commands`, { method: 'POST', body: JSON.stringify({ type, payload }) });
  }
  loadProjection(context: Context): Promise<ConductProjection> {
    const query = new URLSearchParams({ side: context.sideId, role: context.role });
    if (context.operationalAt) query.set('operationalAt', context.operationalAt);
    return this.get(`/api/kshvi/instances/${encodeURIComponent(context.instanceId)}/projection?${query}`);
  }
  saveDecision(draft: DecisionEditorDraft): Promise<DecisionEditorDraft> { return this.post('decision.save', draft); }
  transitionDecision(input: { decisionId: string; from: string; to: string; draft: DecisionEditorDraft }): Promise<DecisionEditorDraft> { return this.post('decision.transition', input); }
  cancelOrder(input: { orderId: string; reason: string }): Promise<DomainOrderPanelModel> { return this.post('order.cancel', input); }
  previewInputs(input: { objectIds: readonly string[]; reason: string }): Promise<readonly MassOperationResult[]> { return this.post('inputs.preview', input); }
  applyInputs(input: { objectIds: readonly string[]; reason: string }): Promise<readonly MassOperationResult[]> { return this.post('inputs.apply', input); }
  executeCritical(command: 'PAUSE' | 'JUMP' | 'PRIVATE_STOP' | 'GENERAL_STOP' | 'COMPLETE'): Promise<string> { return this.post(`critical.${command}`, {}); }
  saveConclusion(input: { text: string; evidenceIds: readonly string[] }): Promise<readonly string[]> { return this.post('analysis.conclusion', input); }
  loadPerspective(perspective: 'PARTICIPANT' | 'TRUTH'): Promise<ConductProjection> {
    const query = new URLSearchParams({ side: this.context.sideId, role: this.context.role, scope: perspective === 'TRUTH' ? 'truth' : 'own' });
    return this.get(`/api/kshvi/instances/${encodeURIComponent(this.context.instanceId)}/projection?${query}`);
  }
  checkAudience(audience: Audience): Promise<{ allowed: boolean; reason: string }> {
    return this.request(`/api/kshvi/instances/${encodeURIComponent(this.context.instanceId)}/audience-check`, { method: 'POST', body: JSON.stringify({ audience }) });
  }
  loadAudienceProjection(audience: Audience): Promise<ConductProjection> {
    const query = new URLSearchParams({ side: this.context.sideId, role: 'PROJECTOR', audience });
    return this.get(`/api/kshvi/instances/${encodeURIComponent(this.context.instanceId)}/projection?${query}`);
  }
}
