/**
 * Um turno de conversa com o Oráculo.
 *
 * A pergunta entra na lista imediatamente — é o que o usuário acabou de
 * escrever, e segurar isso faz a tela parecer travada. A resposta, não: ela
 * chega do servidor com a procedência que o servidor registrou. O cliente não
 * fabrica fala do assistente nem adivinha o que foi consultado.
 */
import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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

export function useOraculoTurno(conversaInicial?: string) {
  const [mensagens, setMensagens] = useState<OraculoMensagem[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(conversaInicial ?? null);
  const [restantesHoje, setRestantesHoje] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (pergunta: string) => {
      const { data, error } = await supabase.functions.invoke<RespostaTurno>("oraculo-turno", {
        body: { pergunta, conversa_id: conversaId },
      });
      if (error) throw error;
      if (!data) throw new Error("resposta_vazia");
      return data;
    },
    onSuccess: (data) => {
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
    onError: (e: unknown) => {
      setErro(
        atingiuLimite(e)
          ? "Você atingiu o limite de perguntas de hoje. O contador zera amanhã."
          : "Não consegui responder agora. Tente de novo em instantes.",
      );
    },
  });

  const perguntar = useCallback(
    (pergunta: string) => {
      const texto = pergunta.trim();
      if (!texto || mutation.isPending) return;

      setErro(null);
      setMensagens((anteriores) => [
        ...anteriores,
        { id: crypto.randomUUID(), role: "user", content: texto, criadaEm: new Date() },
      ]);
      mutation.mutate(texto);
    },
    [mutation],
  );

  const abrirConversa = useCallback((id: string | null, historico: OraculoMensagem[]) => {
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
