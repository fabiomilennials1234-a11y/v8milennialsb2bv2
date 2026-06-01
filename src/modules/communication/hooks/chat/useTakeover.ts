/**
 * useTakeover — hook FSM de takeover IA↔humano por conversa.
 *
 * C28: tipos + mutations para conversations.ai_state
 *
 * API:
 *   state           — AiTakeoverState atual
 *   resumeMode      — AiStateResumeMode atual
 *   updatedAt       — timestamp da última transição
 *   pauseAi(mode)   — pausa IA com resume mode
 *   resumeAi()      — retoma IA (→ AI_ACTIVE)
 *   markWaitingHuman()  — sinaliza que IA precisa de humano (→ WAITING_HUMAN)
 *   markHumanActive()   — operador assume (→ HUMAN_ACTIVE)
 *   markHandoffBack()   — devolve para IA (→ HANDOFF_BACK)
 *
 * Segurança:
 *   - Trigger Postgres enforce_ai_state_transition valida transições
 *   - Se transition ilegal: throw → toast.error com msg clara
 *   - ai_state_updated_by sempre incluído (Security audit trail)
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
import type { TablesUpdate } from "@/integrations/supabase/types";
import type { AiTakeoverState, AiStateResumeMode, AiStatePayload } from "@/modules/communication/lib/chat-types";

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_STATE: AiTakeoverState = "AI_ACTIVE";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationAiState {
  ai_state: AiTakeoverState;
  ai_state_resume_mode: AiStateResumeMode | null;
  ai_state_updated_at: string | null;
}

interface UseTakeoverResult {
  state: AiTakeoverState;
  resumeMode: AiStateResumeMode | null;
  updatedAt: string | null;
  isLoading: boolean;
  isMutating: boolean;
  pauseAi: (mode: AiStateResumeMode) => Promise<void>;
  resumeAi: () => Promise<void>;
  markWaitingHuman: () => Promise<void>;
  markHumanActive: () => Promise<void>;
  markHandoffBack: () => Promise<void>;
}

// ─── Mutation helper ──────────────────────────────────────────────────────────

const FSM_TRANSITION_LABELS: Record<string, string> = {
  AI_PAUSED_MANUAL: "IA pausada",
  AI_ACTIVE:        "IA retomada",
  WAITING_HUMAN:    "Aguardando humano",
  HUMAN_ACTIVE:     "Você assumiu a conversa",
  HANDOFF_BACK:     "Devolvendo para IA",
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTakeover(conversationId: string | null | undefined): UseTakeoverResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  // ── Query: estado atual da conversa ──────────────────────────────────────
  const queryKey = ["takeover", conversationId];

  const { data, isLoading } = useQuery<ConversationAiState | null>({
    queryKey,
    queryFn: async () => {
      if (!conversationId) return null;

      const { data: row, error } = await supabase
        .from("conversations")
        .select("ai_state, ai_state_resume_mode, ai_state_updated_at")
        .eq("id", conversationId)
        .maybeSingle();

      if (error) throw error;
      if (!row) return null;

      return {
        ai_state: (row.ai_state ?? DEFAULT_STATE) as AiTakeoverState,
        ai_state_resume_mode: (row.ai_state_resume_mode ?? null) as AiStateResumeMode | null,
        ai_state_updated_at: row.ai_state_updated_at ?? null,
      };
    },
    enabled: !!conversationId && !!user,
    staleTime: 30_000,
  });

  // ── Mutation: transição FSM ───────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async (payload: AiStatePayload) => {
      if (!conversationId) throw new Error("conversationId ausente");
      if (!user) throw new Error("Usuário não autenticado");

      const updatePayload: TablesUpdate<"conversations"> = {
        ai_state: payload.ai_state,
        ai_state_updated_by: payload.ai_state_updated_by,
        ...(payload.ai_state_resume_mode !== undefined && {
          ai_state_resume_mode: payload.ai_state_resume_mode,
        }),
      };

      const { error } = await supabase
        .from("conversations")
        .update(updatePayload)
        .eq("id", conversationId);

      if (error) {
        // Trigger exception → FSM transition inválida
        if (error.code === "23514" || error.message?.includes("transition not allowed")) {
          throw new Error(`Transição inválida: ${error.message}`);
        }
        throw error;
      }
    },
    onSuccess: (_data, payload) => {
      qc.invalidateQueries({ queryKey });
      const label = FSM_TRANSITION_LABELS[payload.ai_state] ?? payload.ai_state;
      toast.success(label);
    },
    onError: (error: Error) => {
      const msg = error.message?.includes("transition not allowed")
        ? "Transição de estado inválida. Recarregue e tente novamente."
        : error.message || "Erro ao alterar estado da IA";
      toast.error(msg);
    },
  });

  // ── Helpers de transição ──────────────────────────────────────────────────
  const transition = async (payload: AiStatePayload) => {
    if (!user?.id) {
      toast.error("Usuário não autenticado");
      return;
    }
    await mutation.mutateAsync(payload);
  };

  const pauseAi = async (mode: AiStateResumeMode) =>
    transition({
      ai_state: "AI_PAUSED_MANUAL",
      ai_state_resume_mode: mode,
      ai_state_updated_by: user!.id,
    });

  const resumeAi = async () =>
    transition({
      ai_state: "AI_ACTIVE",
      ai_state_resume_mode: null,
      ai_state_updated_by: user!.id,
    });

  const markWaitingHuman = async () =>
    transition({
      ai_state: "WAITING_HUMAN",
      ai_state_updated_by: user!.id,
    });

  const markHumanActive = async () =>
    transition({
      ai_state: "HUMAN_ACTIVE",
      ai_state_updated_by: user!.id,
    });

  const markHandoffBack = async () =>
    transition({
      ai_state: "HANDOFF_BACK",
      ai_state_updated_by: user!.id,
    });

  // ── API pública ───────────────────────────────────────────────────────────
  return {
    state: data?.ai_state ?? DEFAULT_STATE,
    resumeMode: data?.ai_state_resume_mode ?? null,
    updatedAt: data?.ai_state_updated_at ?? null,
    isLoading,
    isMutating: mutation.isPending,
    pauseAi,
    resumeAi,
    markWaitingHuman,
    markHumanActive,
    markHandoffBack,
  };
}
