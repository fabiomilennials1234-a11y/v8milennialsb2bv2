import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import { toast } from "sonner";

export type CallDirection = "inbound" | "outbound";

/**
 * Espelho EXATO do CHECK de `call_logs.outcome` em produção. São nove valores,
 * não seis: `rejected`, `failed` e `canceled` sempre existiram no banco, e
 * desde a projeção de `voip_calls` (migration 20270801000000) chegam à tela de
 * verdade — toda ligação do TorqueCalls que não conectou cai num dos três.
 *
 * `canceled` tem UM L. A VPS emite `cancelled` com dois; a tradução acontece no
 * banco, em `fn_voip_project_call_log`. Aqui só existe a grafia do CHECK.
 */
export type CallOutcome =
  | "connected"
  | "no_answer"
  | "busy"
  | "voicemail"
  | "wrong_number"
  | "callback_scheduled"
  | "rejected"
  | "failed"
  | "canceled";

/** O subconjunto que um humano escolhe ao registrar uma ligação à mão. */
export type ManualCallOutcome = Exclude<CallOutcome, "rejected" | "failed" | "canceled">;

export interface CallLog {
  id: string;
  lead_id: string | null;
  /**
   * Nulo em chamada de ENTRADA que ninguém atendeu: a linha nasce sem operador
   * (`voip_calls.operator_user_id`), e a ligação tem que aparecer no histórico
   * mesmo assim. A coluna é nullable no banco — o tipo agora diz a verdade.
   */
  user_id: string | null;
  direction: CallDirection;
  outcome: CallOutcome;
  duration_seconds: number | null;
  notes: string | null;
  phone_number: string | null;
  recording_url: string | null;
  /** `'torquecalls'` quando a linha veio da telefonia; nulo no registro manual. */
  voip_provider: string | null;
  voip_call_id: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

/**
 * Dicionário de EXIBIÇÃO — cobre os nove valores. Sem os três últimos, uma
 * ligação recusada chegava à tela sem rótulo nenhum.
 */
export const OUTCOME_LABELS: Record<CallOutcome, string> = {
  connected: "Atendeu",
  no_answer: "Não atendeu",
  busy: "Ocupado",
  voicemail: "Caixa postal",
  wrong_number: "Número errado",
  callback_scheduled: "Retorno agendado",
  rejected: "Recusada",
  failed: "Falhou",
  canceled: "Cancelada",
};

/**
 * O que o vendedor pode escolher no registro manual — deliberadamente os SEIS
 * de sempre.
 *
 * Isto existe porque `LogCallModal` montava as opções do dropdown a partir de
 * `Object.entries(OUTCOME_LABELS)`: enquanto exibir e escolher coincidiam, um
 * mapa servia aos dois. Não coincidem mais. Acrescentar `failed` ao dicionário
 * de exibição não pode oferecer "Falhou" ao vendedor — é desfecho técnico da
 * telefonia, que só o sistema sabe determinar.
 *
 * Promover algum dos três a opção manual é decisão de produto: acrescente aqui,
 * e o tipo (`ManualCallOutcome`) e o dropdown acompanham sozinhos.
 */
export const MANUAL_OUTCOMES: readonly ManualCallOutcome[] = [
  "connected",
  "no_answer",
  "busy",
  "voicemail",
  "wrong_number",
  "callback_scheduled",
];

export function useCallLogs(leadId?: string, limit = 20) {
  const { organizationId } = useOrganization();
  const orgId = organizationId;

  return useQuery<CallLog[]>({
    queryKey: ["call-logs", orgId, leadId, limit],
    queryFn: async () => {
      let q = (supabase.from as any)("call_logs")
        .select("*")
        .eq("organization_id", orgId!)
        .order("started_at", { ascending: false })
        .limit(limit);

      if (leadId) q = q.eq("lead_id", leadId);

      const { data, error } = await q;
      if (error) throw error;
      return data as CallLog[];
    },
    enabled: !!orgId,
  });
}

export interface LogCallInput {
  lead_id?: string;
  direction: CallDirection;
  /** Registro manual só escreve os desfechos que um humano observa. */
  outcome: ManualCallOutcome;
  duration_seconds?: number;
  notes?: string;
  phone_number?: string;
}

export function useLogCall() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: LogCallInput) => {
      const { data, error } = await (supabase.from as any)("call_logs")
        .insert({
          organization_id: organizationId!,
          user_id: user!.id,
          lead_id: input.lead_id ?? null,
          direction: input.direction,
          outcome: input.outcome,
          duration_seconds: input.duration_seconds ?? null,
          notes: input.notes ?? null,
          phone_number: input.phone_number ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Ligação registrada");
      queryClient.invalidateQueries({ queryKey: ["call-logs"] });
      queryClient.invalidateQueries({ queryKey: ["lead-timeline"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro: ${error.message}`);
    },
  });
}
