import { issueCascade, type CascadeIssue } from '../documents/cascade';
import type { DocumentRevision } from '../documents/document';

export type ControlSource = { kind: 'HUMAN' | 'GROUP' | 'AGENT' | 'MODEL' | 'SCRIPT' | 'PLAYBOOK' | 'HYBRID'; assignmentId: string };
export type CommandTreeNode = { id: string; parentId: string | null; trained: boolean; planningHorizonHours?: number; detailProfile?: string };
export type CommandLinkKind = 'OPERATIONAL_COMMAND' | 'ADMINISTRATIVE_COMMAND' | 'COORDINATION' | 'INFORMATION' | 'LOGISTICS';
export type CommandEdge = {
  from: string;
  to: string;
  active: boolean;
  playRole: ControlSource | null;
  kind?: CommandLinkKind;
  validFrom?: string;
  validTo?: string | null;
  authorities?: readonly string[];
  allowedDocumentTypes?: readonly string[];
  channelId?: string;
  delayMinutes?: number;
  processingDeadlineAt?: string;
  activation?: 'AFTER_SUPERIOR_TASK';
  deadlineHours?: number;
};
export type CommandTree = { nodes: readonly CommandTreeNode[]; edges: readonly CommandEdge[] };
export type CommandIssue = { code: string; message: string; nodeIds: string[] };

const controlKinds = new Set(['HUMAN', 'GROUP', 'AGENT', 'MODEL', 'SCRIPT', 'PLAYBOOK', 'HYBRID']);
function commandIssue(code: string, edge: CommandEdge, message: string): CommandIssue {
  return { code, message, nodeIds: [edge.from, edge.to] };
}
function validateActiveLink(edge: CommandEdge): CommandIssue[] {
  if (!edge.active) return [];
  const issues: CommandIssue[] = [];
  if (!edge.kind) issues.push(commandIssue('LINK_TYPE_REQUIRED', edge, `Для стыка ${edge.from} → ${edge.to} не указан тип связи`));
  if (!edge.validFrom || edge.validTo === undefined) issues.push(commandIssue('LINK_PERIOD_REQUIRED', edge, `Для стыка ${edge.from} → ${edge.to} нужен период действия`));
  else if (!Number.isFinite(Date.parse(edge.validFrom)) || (edge.validTo !== null && (!Number.isFinite(Date.parse(edge.validTo)) || Date.parse(edge.validTo) <= Date.parse(edge.validFrom)))) {
    issues.push(commandIssue('LINK_PERIOD_INVALID', edge, `Период стыка ${edge.from} → ${edge.to} некорректен`));
  }
  if (!edge.authorities?.length || edge.authorities.some(value => !value.trim())) issues.push(commandIssue('LINK_AUTHORITIES_REQUIRED', edge, `Для стыка ${edge.from} → ${edge.to} нужны полномочия`));
  if (!edge.allowedDocumentTypes?.length || edge.allowedDocumentTypes.some(value => !value.trim())) issues.push(commandIssue('LINK_DOCUMENTS_REQUIRED', edge, `Для стыка ${edge.from} → ${edge.to} нужны разрешённые документы`));
  if (!edge.channelId?.trim()) issues.push(commandIssue('LINK_CHANNEL_REQUIRED', edge, `Для стыка ${edge.from} → ${edge.to} нужен канал связи`));
  if (edge.playRole && (!controlKinds.has(edge.playRole.kind) || !edge.playRole.assignmentId.trim())) issues.push(commandIssue('CONTROL_SOURCE_INVALID', edge, `Источник управления стыка ${edge.from} → ${edge.to} некорректен`));
  return issues;
}

export function validateCommandTree(tree: CommandTree): CommandIssue[] {
  const issues: CommandIssue[] = [];
  const nodes = new Map<string, CommandTreeNode>();
  for (const node of tree.nodes) {
    if (nodes.has(node.id)) issues.push({ code: 'NODE_DUPLICATE', message: `Инстанция ${node.id} повторяется`, nodeIds: [node.id] });
    nodes.set(node.id, node);
    if (node.parentId && !tree.nodes.some(parent => parent.id === node.parentId)) issues.push({ code: 'PARENT_MISSING', message: `Родитель ${node.parentId} инстанции ${node.id} отсутствует`, nodeIds: [node.id] });
  }
  for (const node of tree.nodes) {
    const seen = new Set<string>([node.id]);
    let parent = node.parentId;
    while (parent) {
      if (seen.has(parent)) {
        issues.push({ code: 'COMMAND_CYCLE', message: `Цикл подчинения через ${parent}`, nodeIds: [...seen] });
        break;
      }
      seen.add(parent);
      const next = nodes.get(parent);
      if (!next) break;
      parent = next.parentId;
    }
  }
  for (const edge of tree.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) issues.push({ code: 'EDGE_NODE_MISSING', message: `Стык ${edge.from} → ${edge.to} ссылается на отсутствующую инстанцию`, nodeIds: [edge.from, edge.to] });
    if (edge.active && !edge.playRole && nodes.get(edge.from)?.trained && nodes.get(edge.to)?.trained) issues.push({ code: 'PLAY_ROLE_REQUIRED', message: `На активном стыке ${edge.from} → ${edge.to} нужна роль розыгрыша`, nodeIds: [edge.from, edge.to] });
    if (!edge.active && !edge.playRole && edge.activation !== 'AFTER_SUPERIOR_TASK') issues.push({ code: 'ACTIVATION_RULE_REQUIRED', message: `Для отложенного стыка ${edge.from} → ${edge.to} нужно условие подключения`, nodeIds: [edge.from, edge.to] });
    issues.push(...validateActiveLink(edge));
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (edge.deadlineHours && from?.planningHorizonHours && edge.deadlineHours > from.planningHorizonHours) issues.push({ code: 'DEADLINE_EXCEEDS_HORIZON', message: `Срок ${edge.deadlineHours} ч превышает горизонт инстанции ${edge.from}`, nodeIds: [edge.from] });
    if (from?.planningHorizonHours && to?.planningHorizonHours && to.planningHorizonHours > from.planningHorizonHours) issues.push({ code: 'PLANNING_GAP', message: `Горизонты ${edge.from} и ${edge.to} не согласованы`, nodeIds: [edge.from, edge.to] });
  }
  return issues;
}

export function requiredIntermediaries(tree: CommandTree): CommandEdge[] {
  const trained = new Set(tree.nodes.filter(node => node.trained).map(node => node.id));
  return tree.edges.filter(edge => edge.active && !edge.playRole && trained.has(edge.from) && trained.has(edge.to));
}

function edgeAllowsDocument(edge: CommandEdge, type: string, at: string): boolean {
  if (!edge.active || !edge.allowedDocumentTypes?.includes(type) || !edge.validFrom) return false;
  const issued = Date.parse(at);
  return Date.parse(edge.validFrom) <= issued && (edge.validTo === null || edge.validTo === undefined || issued <= Date.parse(edge.validTo));
}

/** Связывает дерево управления с существующим каскадом документов; каждое плечо сохраняет собственный статус. */
export function cascadeCommandDocument(tree: CommandTree, input: {
  revision: DocumentRevision;
  originInstanceId: string;
  issuedAt: string;
  availableChannelIds: readonly string[];
}): CascadeIssue {
  const validation = validateCommandTree(tree);
  if (validation.length) throw new Error(validation.map(issue => issue.code).join(', '));
  const type = input.revision.requisites.type;
  const legs: CommandEdge[] = [];
  const visited = new Set<string>([input.originInstanceId]);
  for (let current = [input.originInstanceId]; current.length;) {
    const next: string[] = [];
    for (const edge of tree.edges.filter(edge => current.includes(edge.from) && !visited.has(edge.to) && edgeAllowsDocument(edge, type, input.issuedAt))) {
      legs.push(edge);
      visited.add(edge.to);
      next.push(edge.to);
    }
    current = next;
  }
  return issueCascade({
    revision: input.revision,
    originInstanceId: input.originInstanceId,
    issuedAt: input.issuedAt.replace(/Z$/, '+00:00'),
    availableChannelIds: input.availableChannelIds,
    treeEdges: tree.edges,
    legs: legs.map((edge, index) => ({
      id: `command-leg-${index + 1}`,
      from: edge.from,
      to: edge.to,
      channelId: edge.channelId!,
      delayMinutes: edge.delayMinutes ?? 0,
      relayId: edge.playRole?.assignmentId ?? edge.from,
      processingDeadlineAt: edge.processingDeadlineAt ?? input.issuedAt,
    })),
  });
}
