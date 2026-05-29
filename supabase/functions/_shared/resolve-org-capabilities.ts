/**
 * resolve-org-capabilities.ts
 *
 * Reads the real state of an org so the Copilot Builder wires only what exists
 * — real pipeline stages (never invented), whether SZ.Chat is configured,
 * whether the agent has knowledge documents. The Builder uses this to resolve
 * cheap dependencies inline and to warn + skip the rest. (PRD #544 / Slice #549)
 */

export interface OrgPipeline {
  pipelineType: string;
  stages: string[];
}

export interface OrgCapabilities {
  pipelines: OrgPipeline[];
  szChatConfigured: boolean;
  hasKnowledgeDocs: boolean;
}

// Minimal shape of the supabase client we depend on (keeps this testable).
interface QueryClient {
  from: (table: string) => any;
}

export async function resolveOrgCapabilities(
  client: QueryClient,
  orgId: string,
  agentId?: string,
): Promise<OrgCapabilities> {
  const pipelines: OrgPipeline[] = [];
  let szChatConfigured = false;
  let hasKnowledgeDocs = false;

  // Real pipeline stages, grouped by pipeline_type, ordered by position.
  try {
    const { data } = await client
      .from("pipeline_stages")
      .select("pipeline_type, name, position, is_active")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("position", { ascending: true });
    const byPipe = new Map<string, string[]>();
    for (const row of (data ?? []) as Array<{ pipeline_type: string; name: string }>) {
      if (!byPipe.has(row.pipeline_type)) byPipe.set(row.pipeline_type, []);
      byPipe.get(row.pipeline_type)!.push(row.name);
    }
    for (const [pipelineType, stages] of byPipe) pipelines.push({ pipelineType, stages });
  } catch {
    // Non-fatal: Builder proceeds without funnel grounding.
  }

  // SZ.Chat configured for the org?
  try {
    const { data } = await client
      .from("sz_chat_config")
      .select("team_mappings")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .maybeSingle();
    const mappings = (data?.team_mappings ?? {}) as Record<string, unknown>;
    szChatConfigured = Object.keys(mappings).length > 0;
  } catch {
    szChatConfigured = false;
  }

  // Does this agent already have knowledge documents ready to send?
  if (agentId) {
    try {
      const { data } = await client
        .from("copilot_agent_documents")
        .select("id")
        .eq("agent_id", agentId)
        .eq("status", "ready")
        .limit(1);
      hasKnowledgeDocs = Array.isArray(data) && data.length > 0;
    } catch {
      hasKnowledgeDocs = false;
    }
  }

  return { pipelines, szChatConfigured, hasKnowledgeDocs };
}

/** Render the org capabilities as a system-prompt addendum for the Builder. */
export function describeOrgCapabilities(caps: OrgCapabilities): string {
  const lines: string[] = ["Estado real desta organização (use, não invente):"];

  if (caps.pipelines.length > 0) {
    lines.push("Funis e etapas REAIS:");
    for (const p of caps.pipelines) {
      lines.push(`- ${p.pipelineType}: ${p.stages.join(", ")}`);
    }
    lines.push("Ao configurar o funil, use SOMENTE estas etapas — nunca invente nomes.");
  } else {
    lines.push("Nenhum funil configurado ainda.");
  }

  lines.push(
    caps.szChatConfigured
      ? "SZ.Chat: configurado — a transferência para setor externo está disponível."
      : "SZ.Chat: NÃO configurado — não ligue transferência SZ.Chat; avise que precisa configurar antes.",
  );

  lines.push(
    caps.hasKnowledgeDocs
      ? "Base de conhecimento: há documentos prontos — enviar documento está disponível."
      : "Base de conhecimento: vazia — se o usuário quiser enviar catálogo/material, peça o upload antes de ligar essa capacidade.",
  );

  return lines.join("\n");
}
