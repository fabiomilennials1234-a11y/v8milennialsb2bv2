// deno-lint-ignore-file no-explicit-any
/**
 * greeting-orchestrator — garante UMA fonte por janela ganha disparo de
 * greeting (fora-de-horário, primeira-msg, etc.).
 *
 * Origem: investigação Bertin 2026-05-08/09. Phone 5515935004596 recebeu
 * 3× mesma greeting "fora de horário" em paralelo (copilot + 2 disparos
 * manuais). Causa: cada caminho dispara independentemente sem coordenar.
 *
 * Solução: reserva atômica em `greeting_dispatches(org_id, lead_id,
 * window_id)` com unique constraint. Quem vence dispara, outros recebem
 * skip silencioso.
 */

export type GreetingSource = "copilot" | "workflow";

export type GreetingDecision =
  | { kind: "dispatch"; source: GreetingSource; greetingType: string; token: string }
  | { kind: "skip"; reason: "already_dispatched_in_window" };

export interface ResolveGreetingArgs {
  supabase: any;
  orgId: string;
  agentId: string | null;
  leadId: string;
  phone: string;
  windowId: string;
  preferredSource: GreetingSource;
  greetingType: string;
}

export async function resolveGreetingDispatch(
  args: ResolveGreetingArgs,
): Promise<GreetingDecision> {
  const row = {
    org_id: args.orgId,
    lead_id: args.leadId,
    phone: args.phone,
    window_id: args.windowId,
    source: args.preferredSource,
    greeting_type: args.greetingType,
    dispatched_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await args.supabase
    .from("greeting_dispatches")
    .insert(row)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`greeting-orchestrator insert failed: ${error.message ?? error}`);
  }

  if (inserted) {
    return {
      kind: "dispatch",
      source: args.preferredSource,
      greetingType: args.greetingType,
      token: inserted.id,
    };
  }

  return { kind: "skip", reason: "already_dispatched_in_window" };
}
