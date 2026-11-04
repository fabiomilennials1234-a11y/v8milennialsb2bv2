import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import { CADENCIAS, type PedidoDeDisparo } from "../lib/disparo";
import { CHAVE_LISTA_FRIA } from "./useListaFriaDados";
import { useOrganization } from "@/modules/identity";

export interface ResultadoDoDisparo {
  disparoId: string;
  planId: string;
  importados: number;
  negocios: number;
  semNegocio: number;
  destinatarios: number;
  lotes: number;
}

/** A recusa do servidor chega no corpo da resposta; o cliente só diz "non-2xx". */
export class RecusaDoDisparo extends Error {
  constructor(
    message: string,
    readonly codigo: string,
  ) {
    super(message);
    this.name = "RecusaDoDisparo";
  }
}

async function lerRecusa(error: unknown): Promise<RecusaDoDisparo> {
  const e = error as { context?: { json?: () => Promise<unknown> }; message?: string } | null;
  if (e?.context && typeof e.context.json === "function") {
    try {
      const corpo = (await e.context.json()) as { error?: unknown; message?: unknown };
      return new RecusaDoDisparo(String(corpo?.message ?? corpo?.error ?? "Não foi possível disparar."), String(corpo?.error ?? "erro"));
    } catch {
      // Corpo ausente ou inválido: cai na mensagem do cliente.
    }
  }
  return new RecusaDoDisparo(e?.message ?? "Não foi possível disparar.", "erro");
}

/**
 * Importa os contatos selecionados, abre um negócio de cada um no funil/etapa e
 * cria o disparo cadenciado — tudo no servidor (lista-fria-importar-e-disparar),
 * então fechar a aba no meio não interrompe.
 */
export function useImportarEDisparar() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  return useMutation({
    mutationFn: async (v: { buscaId: string; pedido: PedidoDeDisparo }): Promise<ResultadoDoDisparo> => {
      const cadencia = CADENCIAS.find((c) => c.id === v.pedido.cadencia) ?? CADENCIAS[1];
      const { data, error } = await supabase.functions.invoke("lista-fria-importar-e-disparar", {
        body: {
          busca_id: v.buscaId,
          pipeline_id: v.pedido.funilId,
          stage_id: v.pedido.etapaId,
          mensagem: v.pedido.mensagem,
          instance_ids: v.pedido.chipIds,
          delay_min_ms: cadencia.minMs,
          delay_max_ms: cadencia.maxMs,
        },
      });
      if (error) throw await lerRecusa(error);
      const r = data as Record<string, unknown> | null;
      if (!r?.ok) throw new RecusaDoDisparo(String(r?.message ?? r?.error ?? "Não foi possível disparar."), String(r?.error ?? "erro"));
      return {
        disparoId: String(r.disparo_id),
        planId: String(r.plan_id),
        importados: Number(r.importados ?? 0),
        negocios: Number(r.negocios ?? 0),
        semNegocio: Number(r.sem_negocio ?? 0),
        destinatarios: Number(r.destinatarios ?? 0),
        lotes: Number(r.lotes ?? 0),
      };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [CHAVE_LISTA_FRIA, organizationId] });
      // Lead novo na aba Lista fria, negócio novo no funil e plano novo em Disparos.
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["blast_plans"] });
    },
  });
}
