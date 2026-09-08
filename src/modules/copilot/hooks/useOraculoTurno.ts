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

export interface OraculoMensagem {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Ferramentas que o servidor consultou para redigir esta resposta. */
  procedencia?: string[];
  criadaEm: Date;
}

interface RespostaTurno {
  conversa_id: string;
  resposta: string;
  procedencia: string[];
  teto_de_ferramentas_atingido?: boolean;
  restantes_hoje: number;
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

  return {
    mensagens,
    conversaId,
    restantesHoje,
    erro,
    pensando: mutation.isPending,
    perguntar,
    abrirConversa,
  };
}
