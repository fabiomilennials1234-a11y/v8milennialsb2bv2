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
      const { count, error } = await db
        .from("oraculo_turns")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("role", "user")
        .gte("created_at", desde);
      if (error) throw new Error("Não foi possível consultar a quota do Oráculo.");
      return count ?? 0;
    },

    async orgLimit(organizationId: string): Promise<number | null> {
      const { data, error } = await db
        .from("organizations")
        .select("oraculo_daily_turn_limit")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw new Error("Não foi possível consultar o limite do Oráculo.");
      return data?.oraculo_daily_turn_limit ?? null;
    },

    async loadConversation(
      actor: OracleActor,
      conversationId: string | null,
    ): Promise<ConversationState> {
      if (conversationId) {
        const { data: conversa, error: conversationError } = await db
          .from("oraculo_conversations")
          .select("id, summary, last_message_at")
          .eq("id", conversationId)
          // O dono é parte da chave de busca: quem passa o id de outra pessoa
          // não recebe erro revelador, recebe conversa nova.
          .eq("user_id", actor.userId)
          .eq("organization_id", actor.organizationId)
          .maybeSingle();
        if (conversationError) throw new Error("Não foi possível carregar a conversa do Oráculo.");

        if (conversa) {
          const { data: turnos, error: historyError } = await db
            .from("oraculo_turns")
            .select("role, content")
            .eq("conversation_id", conversa.id)
            .eq("organization_id", actor.organizationId)
            .eq("user_id", actor.userId)
            .order("created_at", { ascending: false })
            .limit(HISTORICO_MAX);
          if (historyError) throw new Error("Não foi possível carregar os turnos do Oráculo.");

          const history = ((turnos ?? []) as Turn[]).slice().reverse();
          return {
            id: conversa.id,
            summary: conversa.summary,
            history,
            lastMessageAt: conversa.last_message_at,
          };
        }
      }

      const { data: nova, error } = await db
        .from("oraculo_conversations")
        .insert({
          organization_id: actor.organizationId,
          user_id: actor.userId,
          team_member_id: actor.teamMemberId || null,
        })
        .select("id, summary, last_message_at")
        .single();

      // Sem conversa não há onde pendurar o turno. Falhar aqui, com o motivo,
      // é melhor que seguir e estourar um TypeError na hora de gravar.
      if (error || !nova) {
        throw new Error(
          `oraculo: conversa não pôde ser criada — ${error?.message ?? "sem retorno"}`,
        );
      }

      return { id: nova.id, summary: null, history: [], lastMessageAt: null };
    },

    async loadProfileContext(actor: OracleActor): Promise<string | null> {
      const { data, error } = await db.rpc("oraculo_get_profile_context", {
        p_organization_id: actor.organizationId,
        p_team_member_id: actor.isAdmin ? null : actor.teamMemberId,
      });
      if (error) throw new Error("Não foi possível carregar o perfil da operação.");
      return typeof data === "string" && data.trim() ? data.trim() : null;
    },

    async loadInterviewState(actor: OracleActor, conversationId: string) {
      const recentSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const [questions, answered] = await Promise.all([
        db
          .from("oraculo_interview_questions")
          .select("question_key, conversation_id")
          .eq("organization_id", actor.organizationId)
          .eq("subject_team_member_id", actor.teamMemberId)
          .gte("created_at", recentSince),
        db
          .from("oraculo_operation_profile_entries")
          .select("question_key")
          .eq("organization_id", actor.organizationId)
          .eq("subject_team_member_id", actor.teamMemberId)
          .eq("author_role", "member"),
      ]);
      if (questions.error || answered.error) {
        throw new Error("Não foi possível carregar a entrevista da operação.");
      }
      const rows = (questions.data ?? []) as Array<
        { question_key: string; conversation_id: string }
      >;
      const answeredRows = (answered.data ?? []) as Array<{ question_key: string }>;
      return {
        askedKeys: [
          ...new Set([
            ...rows.map((row) => row.question_key),
            ...answeredRows.map((row) => row.question_key),
          ]),
        ],
        questionCount: rows.filter((row) => row.conversation_id === conversationId).length,
      };
    },

    async saveTurn(args: {
      conversation: ConversationState;
      actor: OracleActor;
      pergunta: string;
      resultado: TurnResult;
      summary?: string | null;
    }): Promise<void> {
      // Evidência crua pode conter linhas de CRM. Só perguntas derivadas e
      // agregados necessários atravessam a fronteira de persistência.
      const persistableResult = { ...args.resultado };
      delete (persistableResult as Partial<TurnResult>).toolEvidence;
      const { error } = await db.rpc("oraculo_save_turn", {
        p_conversation_id: args.conversation.id,
        p_organization_id: args.actor.organizationId,
        p_user_id: args.actor.userId,
        p_expected_last_message_at: args.conversation.lastMessageAt ?? null,
        p_question: args.pergunta,
        p_result: persistableResult,
        p_summary: args.summary ?? args.conversation.summary,
      });
      if (error?.code === "40001" || error?.code === "PT409") throw new TurnConflictError();
      if (error) throw new Error("Não foi possível salvar o turno do Oráculo.");
    },
  };
}

export class TurnConflictError extends Error {
  constructor() {
    super("A conversa recebeu outra resposta. Recarregue antes de continuar.");
    this.name = "TurnConflictError";
  }
}
