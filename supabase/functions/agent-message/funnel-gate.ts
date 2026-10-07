/**
 * Funnel gate — a IA só atende lead que está num funil em que ela foi ligada.
 *
 * `copilot_agents.active_pipes` é o "ligar a IA neste funil" da UI (aba Pipe).
 * Até aqui ele só limitava as FERRAMENTAS (mover card etc.): nada impedia o
 * agente de responder um lead que vive em OUTRO funil. Incidente Loofting
 * 2026-10-07: Loo (active_pipes=["whatsapp"]) respondeu um candidato a
 * representante que a equipe já atendia no funil `representantes`.
 *
 * Regra (fail-open — na dúvida a IA segue como antes):
 *  - qualquer agente ativo da org SEM funil configurado = sem restrição;
 *  - sem entrada ABERTA em funil nenhum (lead novo) = sem restrição;
 *  - tem entrada aberta e nenhuma cai num funil permitido por algum agente
 *    ativo = bloqueia.
 * Veto na org inteira, como o audience-gate: o roteamento por agente acontece
 * depois, e hoje as 6 orgs com `active_pipes` têm um único agente ativo.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Eixos que não são funil (`pipelines`): upsell e campanha têm tabela própria. */
const NON_FUNNEL_AXES = new Set(["campanha", "upsell_base", "upsell_gestao"]);

export type FunnelGateResult =
  | { blocked: false }
  | { blocked: true; allowed: string[]; currentFunnels: string[] };

export interface OpenFunnel {
  id: string;
  slug: string;
}

function funnelRefs(activePipes: unknown): string[] {
  if (!Array.isArray(activePipes)) return [];
  const refs: string[] = [];
  for (const raw of activePipes) {
    const ref = String(raw ?? "").trim().toLowerCase();
    if (ref && !NON_FUNNEL_AXES.has(ref) && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

/** Decisão pura: testável sem rede. */
export function decideFunnelGate(
  agents: Array<{ active_pipes: unknown }>,
  openFunnels: OpenFunnel[],
): FunnelGateResult {
  if (agents.length === 0 || openFunnels.length === 0) return { blocked: false };

  const allowed = new Set<string>();
  for (const agent of agents) {
    const refs = funnelRefs(agent.active_pipes);
    if (refs.length === 0) return { blocked: false };
    for (const ref of refs) allowed.add(ref);
  }

  const inAllowed = openFunnels.some(
    (f) => allowed.has(f.slug.toLowerCase()) || allowed.has(f.id.toLowerCase()),
  );
  if (inAllowed) return { blocked: false };

  return {
    blocked: true,
    allowed: [...allowed],
    currentFunnels: openFunnels.map((f) => f.slug),
  };
}

export async function checkFunnelGate(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<FunnelGateResult> {
  try {
    const { data: agents, error: agentsError } = await supabase
      .from("copilot_agents")
      .select("active_pipes")
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    if (agentsError || !agents) return { blocked: false };

    // Curto-circuito: sem restrição em nenhum agente não precisa ler entradas.
    if (agents.some((a: { active_pipes: unknown }) => funnelRefs(a.active_pipes).length === 0)) {
      return { blocked: false };
    }

    const { data: entries, error: entriesError } = await supabase
      .from("pipeline_entries")
      .select("pipeline_id")
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .is("closed_at", null);
    if (entriesError || !entries || entries.length === 0) return { blocked: false };

    const pipelineIds = [...new Set(entries.map((e: { pipeline_id: string }) => e.pipeline_id))];
    const { data: funnels, error: funnelsError } = await supabase
      .from("pipelines")
      .select("id, slug")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .in("id", pipelineIds);
    if (funnelsError || !funnels) return { blocked: false };

    return decideFunnelGate(agents, funnels as OpenFunnel[]);
  } catch (e) {
    console.warn("[funnel-gate] falhou (fail-open):", e);
    return { blocked: false };
  }
}
