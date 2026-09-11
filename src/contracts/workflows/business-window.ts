/** Validation for authoring; existing definitions are never rewritten here. */
const DAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
type Node = { id: string; type?: string; data?: Record<string, unknown> };
type Edge = { source: string; target: string; sourceHandle?: string | null };
export type WindowIssue = { nodeId: string; nodeLabel: string; actionType: string; missing: string };

export function businessWindowConfigErrors(data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: String(data.timezone || "America/Sao_Paulo") }); }
  catch { errors.push("um fuso horário válido"); }
  if (!Array.isArray(data.windows) || data.windows.length === 0) return errors; // legacy
  if (data.windows.length > 6) errors.push("no máximo 6 janelas");
  for (const [index, entry] of data.windows.entries()) {
    const w = (entry ?? {}) as Record<string, unknown>;
    const name = String(w.name || `Janela ${index + 1}`);
    if (!Array.isArray(w.days) || !w.days.length || w.days.some(d => !DAYS.has(d))) errors.push(`dias válidos em “${name}”`);
    if (!TIME.test(String(w.start)) || !TIME.test(String(w.end))) errors.push(`horários válidos em “${name}”`);
    if (typeof w.action === "string" && w.action.trim() === "route:") errors.push(`uma saída definida em “${name}”`);
  }
  return errors;
}

export function businessWindowConnectionIssues(nodes: Node[], edges: Edge[]): WindowIssue[] {
  const issues: WindowIssue[] = [];
  const windowNodes = nodes.filter(n => n.type === "wait_business_window" || n.data?.type === "wait_business_window");
  const windowIds = new Set(windowNodes.map(n => n.id));
  const issue = (node: Node, missing: string) => issues.push({ nodeId: node.id, nodeLabel: String(node.data?.label || "Janela Comercial"), actionType: "wait_business_window", missing });
  for (const node of windowNodes) {
    const windows = Array.isArray(node.data?.windows) ? node.data.windows.filter(w => w && typeof w === "object") as Record<string, unknown>[] : [];
    const keys = windows.map(w => typeof w.action === "string" ? w.action.trim() : "")
      .filter(a => a.startsWith("route:") && a.slice(6).trim()).map(a => a.slice(6));
    for (const key of new Set(keys)) {
      if (!edges.some(e => e.source === node.id && e.sourceHandle === key && nodes.some(n => n.id === e.target))) {
        issue(node, `conectar a saída da janela “${String(windows.find(w => String(w.action).trim() === `route:${key}`)?.name || key)}” ao próximo nó`);
      }
    }
    for (const edge of edges.filter(e => e.source === node.id && e.sourceHandle && e.sourceHandle !== "default")) {
      if (!keys.includes(edge.sourceHandle!)) issue(node, "remover ou reconectar uma saída que não pertence mais às janelas deste nó");
    }
  }
  // A single execution stores one resume cursor; direct parallel waiting
  // windows lose the sibling branch. Author alternatives in one routing node.
  for (const node of nodes) {
    const outgoing = edges.filter(e => e.source === node.id && windowIds.has(e.target));
    const handles = new Set(outgoing.map(e => e.sourceHandle || "default"));
    for (const handle of handles) {
      if (new Set(outgoing.filter(e => (e.sourceHandle || "default") === handle).map(e => e.target)).size > 1) {
        issue(node, "reunir os horários em uma única Janela Comercial; duas janelas na mesma saída interrompem os caminhos entre si");
      }
    }
  }
  return issues;
}
