/**
 * Persistência do turno — conversa, memória e telemetria.
 *
 * Escreve com `service_role`: `authenticated` só tem SELECT nas duas tabelas.
 * Se o usuário pudesse escrever turno, a procedência mostrada na tela seria
 * ficção — e é ela que torna "o Oráculo disse" auditável.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { OracleActor } from "./scope.ts";
import type { Turn } from "./memory.ts";
import type { TurnResult } from "./loop.ts";
import type { ConversationState, TurnStore } from "./turn-handler.ts";

/** Turnos carregados por conversa. O resto vive no resumo. */
const HISTORICO_MAX = 20;

export function createTurnStore(db: SupabaseClient): TurnStore {
  return {
    async turnsToday(userId: string): Promise<number> {
      const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await db
        .from("oraculo_turns")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("role", "user")
        .gte("created_at", desde);
      return count ?? 0;
    },

    async orgLimit(organizationId: string): Promise<number | null> {
      const { data } = await db
        .from("organizations")
        .select("oraculo_daily_turn_limit")
        .eq("id", organizationId)
        .maybeSingle();
      return data?.oraculo_daily_turn_limit ?? null;
    },

    async loadConversation(
      actor: OracleActor,
      conversationId: string | null,
    ): Promise<ConversationState> {
      if (conversationId) {
        const { data: conversa } = await db
          .from("oraculo_conversations")
          .select("id, summary")
          .eq("id", conversationId)
          // O dono é parte da chave de busca: quem passa o id de outra pessoa
          // não recebe erro revelador, recebe conversa nova.
          .eq("user_id", actor.userId)
          .maybeSingle();

        if (conversa) {
          const { data: turnos } = await db
            .from("oraculo_turns")
            .select("role, content")
            .eq("conversation_id", conversa.id)
            .order("created_at", { ascending: false })
            .limit(HISTORICO_MAX);

          const history = ((turnos ?? []) as Turn[]).slice().reverse();
          return { id: conversa.id, summary: conversa.summary, history };
        }
      }

      const { data: nova } = await db
        .from("oraculo_conversations")
        .insert({
          organization_id: actor.organizationId,
          user_id: actor.userId,
          team_member_id: actor.teamMemberId || null,
        })
        .select("id, summary")
        .single();

      return { id: nova.id, summary: null, history: [] };
    },

    async saveTurn(args: {
      conversation: ConversationState;
      actor: OracleActor;
      pergunta: string;
      resultado: TurnResult;
    }): Promise<void> {
      const base = {
        conversation_id: args.conversation.id,
        organization_id: args.actor.organizationId,
        user_id: args.actor.userId,
      };

      await db.from("oraculo_turns").insert([
        { ...base, role: "user", content: args.pergunta },
        {
          ...base,
          role: "assistant",
          content: args.resultado.text,
          tools_used: args.resultado.toolsUsed,
          rejected_tools: args.resultado.rejectedToolCalls,
          hit_tool_ceiling: args.resultado.hitToolCeiling,
          model: args.resultado.telemetry.model,
          input_tokens: args.resultado.telemetry.inputTokens,
          output_tokens: args.resultado.telemetry.outputTokens,
          latency_ms: args.resultado.telemetry.latencyMs,
        },
      ]);

      await db
        .from("oraculo_conversations")
        .update({
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // O título nasce da primeira pergunta: a lista do histórico precisa
          // de um nome antes de alguém resumir coisa alguma.
          ...(args.conversation.history.length === 0
            ? { title: args.pergunta.slice(0, 80) }
            : {}),
        })
        .eq("id", args.conversation.id);
    },
  };
}
