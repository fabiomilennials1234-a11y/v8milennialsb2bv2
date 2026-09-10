/**
 * Um turno de conversa com o Oráculo.
 *
 * A pergunta entra na lista imediatamente — é o que o usuário acabou de
 * escrever, e segurar isso faz a tela parecer travada. A resposta, não: ela
 * chega do servidor com a procedência que o servidor registrou. O cliente não
 * fabrica fala do assistente nem adivinha o que foi consultado.
 */
import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OraculoResultadoAcao {
  status: "sucesso" | "aviso";
  previstos?: number;
  qualificaveis_no_clique?: number;
  alterados: number;
  ja_tratados?: number;
  codigo?: string;
}

export interface OraculoProposta {
  kind?: "oraculo_action_proposal";
  id: string;
  acao: "mover_etapa" | "criar_follow_up" | "atribuir_responsavel" | "adicionar_tag";
  criterio: { tipo: "leads_parados" | "leads_sem_contato"; dias: number };
  parametros: Record<string, unknown>;
  previsao: number;
  status: "pending" | "executed" | "expired";
  resultado?: OraculoResultadoAcao;
  erro?: string;
}

export type OraculoPerfilChave =
  | "sales_outside_crm"
  | "meeting_definition"
  | "seasonality"
  | "perceived_bottleneck"
  | "personal_practice";

export interface OraculoPerguntaPerfil {
  id: string;
  question_key: OraculoPerfilChave;
  prompt: string;
  measured_context: Record<string, unknown>;
  status: "pending" | "answered" | "skipped";
  error?: string;
}

export interface OraculoMensagem {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Ferramentas que o servidor consultou para redigir esta resposta. */
  procedencia?: string[];
  propostas?: OraculoProposta[];
  perguntasPerfil?: OraculoPerguntaPerfil[];
  criadaEm: Date;
}

interface RespostaTurno {
  conversa_id: string;
  resposta: string;
  procedencia: string[];
  teto_de_ferramentas_atingido?: boolean;
  restantes_hoje: number;
  propostas?: OraculoProposta[];
  perguntas_perfil?: Array<Omit<OraculoPerguntaPerfil, "status">>;
}

/**
 * `supabase.functions.invoke` embrulha qualquer não-2xx num FunctionsHttpError
 * com mensagem genérica — o status real só existe em `context`. Ler apenas a
 * mensagem transformaria "acabou sua cota" em "erro desconhecido", que é
 * exatamente a diferença entre o usuário entender e desistir.
 */
function atingiuLimite(e: unknown): boolean {
  const status = (e as { context?: { status?: number } })?.context?.status;
  if (status === 429) return true;

  const mensagem = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "");
  return mensagem.includes("limite_diario");
}

function mensagemErroAcao(e: unknown): string {
  const status = (e as { context?: { status?: number } })?.context?.status;
  if (status === 403) return "Você não tem permissão para confirmar esta ação agora.";
  if (status === 409) return "A proposta mudou ou não está mais disponível. Atualize a conversa.";
  return "Não consegui executar esta ação agora. Tente de novo em instantes.";
}

export function useOraculoTurno(organizationId: string | null, conversaInicial?: string) {
  const queryClient = useQueryClient();
  const viewRevision = useRef(0);
  const [mensagens, setMensagens] = useState<OraculoMensagem[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(conversaInicial ?? null);
  const [restantesHoje, setRestantesHoje] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ pergunta, conversationId }: { pergunta: string; conversationId: string | null; revision: number }) => {
      const { data, error } = await supabase.functions.invoke<RespostaTurno>("oraculo-turno", {
        body: { pergunta, conversa_id: conversationId, organization_id: organizationId },
      });
      if (error) throw error;
      if (!data) throw new Error("resposta_vazia");
      return data;
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["oraculo_conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["oraculo_turns"] });
      if (variables.revision !== viewRevision.current) return;
      setConversaId(data.conversa_id);
      setRestantesHoje(data.restantes_hoje);
      setMensagens((anteriores) => [
        ...anteriores,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.resposta,
          procedencia: data.procedencia,
          propostas: data.propostas,
          perguntasPerfil: data.perguntas_perfil?.map((question) => ({
            ...question,
            status: "pending",
          })),
          criadaEm: new Date(),
        },
      ]);
    },
    onError: (e: unknown, variables) => {
      if (variables.revision !== viewRevision.current) return;
      const status = (e as { context?: { status?: number } })?.context?.status;
      if (status === 409) {
        void queryClient.invalidateQueries({ queryKey: ["oraculo_turns"] });
        setErro("A conversa recebeu outra resposta. Abra novamente para atualizar.");
        return;
      }
      if (status === 403) {
        setErro("Seu acesso ao Oráculo não está disponível nesta organização. Consulte o administrador.");
        return;
      }
      setErro(
        atingiuLimite(e)
          ? "Você atingiu o limite de perguntas de hoje. O contador zera amanhã."
          : "Não consegui responder agora. Tente de novo em instantes.",
      );
    },
  });

  const actionMutation = useMutation({
    mutationFn: async (proposalId: string) => {
      if (!organizationId) throw new Error("organizacao_ausente");
      const { data, error } = await supabase.functions.invoke<OraculoResultadoAcao>("oraculo-action", {
        body: { proposta_id: proposalId, organization_id: organizationId },
      });
      if (error) throw error;
      if (!data) throw new Error("resultado_vazio");
      return { proposalId, result: data };
    },
    onSuccess: ({ proposalId, result }) => {
      setMensagens((current) => current.map((message) => ({
        ...message,
        propostas: message.propostas?.map((proposal) => proposal.id === proposalId
          ? {
              ...proposal,
              status: result.codigo === "proposta_expirada" || result.codigo === "destino_indisponivel"
                ? "expired"
                : "executed",
              resultado: result,
              erro: undefined,
            }
          : proposal),
      })));
      void queryClient.invalidateQueries({ queryKey: ["oraculo_turns"] });
    },
    onError: (error, proposalId) => {
      setMensagens((current) => current.map((message) => ({
        ...message,
        propostas: message.propostas?.map((proposal) => proposal.id === proposalId
          ? { ...proposal, erro: mensagemErroAcao(error) }
          : proposal),
      })));
    },
  });

  const profileMutation = useMutation({
    mutationFn: async (input: { questionId: string; answer?: string; skip: boolean }) => {
      if (!organizationId) throw new Error("organizacao_ausente");
      const { data, error } = await supabase.functions.invoke("oraculo-profile", {
        body: {
          acao: input.skip ? "ignorar" : "responder",
          pergunta_id: input.questionId,
          resposta: input.answer,
          organization_id: organizationId,
        },
      });
      if (error) throw error;
      return { input, data };
    },
    onSuccess: ({ input }) => {
      setMensagens((current) => current.map((message) => ({
        ...message,
        perguntasPerfil: message.perguntasPerfil?.map((question) =>
          question.id === input.questionId
            ? { ...question, status: input.skip ? "skipped" : "answered", error: undefined }
            : question
        ),
      })));
      void queryClient.invalidateQueries({ queryKey: ["oraculo-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["oraculo_turns"] });
    },
    onError: (_error, input) => {
      setMensagens((current) => current.map((message) => ({
        ...message,
        perguntasPerfil: message.perguntasPerfil?.map((question) =>
          question.id === input.questionId
            ? { ...question, error: "Não consegui salvar. Tente novamente." }
            : question
        ),
      })));
    },
  });

  const perguntar = useCallback(
    (pergunta: string, historico: OraculoMensagem[] | null = []) => {
      const texto = pergunta.trim();
      if (!texto || mutation.isPending) return;
      if (!organizationId) {
        setErro("Selecione uma organização antes de perguntar.");
        return;
      }

      if (historico === null) {
        setErro("Aguarde o histórico da conversa antes de continuar.");
        return;
      }
      setErro(null);
      setMensagens((anteriores) => [
        ...(anteriores.length ? anteriores : historico),
        { id: crypto.randomUUID(), role: "user", content: texto, criadaEm: new Date() },
      ]);
      mutation.mutate({ pergunta: texto, conversationId: conversaId, revision: viewRevision.current });
    },
    [mutation, organizationId, conversaId],
  );

  const abrirConversa = useCallback((id: string | null, historico: OraculoMensagem[]) => {
    viewRevision.current++;
    setConversaId(id);
    setMensagens(historico);
    setErro(null);
  }, []);

  const executarProposta = useCallback((proposalId: string) => {
    if (actionMutation.isPending) return;
    actionMutation.mutate(proposalId);
  }, [actionMutation]);

  const responderPerguntaPerfil = useCallback((questionId: string, answer: string) => {
    if (!profileMutation.isPending) profileMutation.mutate({ questionId, answer, skip: false });
  }, [profileMutation]);

  const ignorarPerguntaPerfil = useCallback((questionId: string) => {
    if (!profileMutation.isPending) profileMutation.mutate({ questionId, skip: true });
  }, [profileMutation]);

  return {
    mensagens,
    conversaId,
    restantesHoje,
    erro,
    pensando: mutation.isPending,
    executandoPropostaId: actionMutation.isPending ? actionMutation.variables : null,
    perguntar,
    executarProposta,
    responderPerguntaPerfil,
    ignorarPerguntaPerfil,
    salvandoPerguntaPerfilId: profileMutation.isPending
      ? profileMutation.variables?.questionId ?? null
      : null,
    abrirConversa,
  };
}
