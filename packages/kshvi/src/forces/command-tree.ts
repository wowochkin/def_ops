export type ControlSource = { kind: 'HUMAN' | 'GROUP' | 'AGENT' | 'MODEL'; assignmentId: string };
export type CommandTreeNode = { id: string; parentId: string | null; trained: boolean; planningHorizonHours?: number; detailProfile?: string };
export type CommandEdge = { from: string; to: string; active: boolean; playRole: ControlSource | null; activation?: 'AFTER_SUPERIOR_TASK'; deadlineHours?: number };
export type CommandTree = { nodes: readonly CommandTreeNode[]; edges: readonly CommandEdge[] };
export type CommandIssue = { code: string; message: string; nodeIds: string[] };

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
