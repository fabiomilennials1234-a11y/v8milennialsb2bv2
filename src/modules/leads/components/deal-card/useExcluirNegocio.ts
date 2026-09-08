import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";

/**
 * Excluir o NEGÓCIO — o card, não a pessoa.
 *
 * ── Por que este arquivo existe ────────────────────────────────────────────
 * Até aqui o painel do Negócio não tinha como excluir nada. A única porta era
 * o menu `⋯` do card no kanban ("Remover do funil"), que some em toda
 * superfície que não seja o board — e o painel é justamente onde a pessoa está
 * quando decide que aquele negócio não existe mais.
 *
 * Toda espécie de funil vive em `pipeline_entries`. O id recebido pelo painel
 * aponta direto para essa fonte única.
 *
 * ── POR QUE `.select()` DEPOIS DO DELETE ──────────────────────────────────
 * Um DELETE que a RLS recusa **não devolve erro** no PostgREST: devolve 0
 * linhas afetadas, e o cliente comemora. É a forma mais comum de "o botão não
 * faz nada" sobreviver em produção.
 *
 * Mas 0 linhas tem **dois** diagnósticos, e tratá-los como um só produz um
 * beco: quem já teve o card apagado noutra aba levaria "você não tem
 * permissão" (falso) e ficaria preso num painel que não fecha. Por isso o
 * ramo de 0 linhas RELÊ a linha antes de acusar alguém. A leitura é confiável
 * neste ponto específico porque o painel só existe se o SELECT daquela linha
 * já tiver funcionado — é o que desenhou a tela.
 *
 * ── O QUE ESTE CAMINHO DELIBERADAMENTE **NÃO** APAGA ──────────────────────
 * A linha em `deals` fica. Uma versão anterior deste arquivo apagava `deals` e
 * `deal_items` quando o negócio "ficava órfão", e estava errada em dois níveis:
 *
 *   1. **a guarda de órfã era vácua.** `uq_pipeline_entries_deal_id` é UNIQUE
 *      PARCIAL sobre `pipeline_entries(deal_id) WHERE deal_id IS NOT NULL`:
 *      nunca existe uma segunda linha ali com o mesmo `deal_id`, e a que havia
 *      acabara de ser apagada. A consulta devolvia `[]` SEMPRE e o DELETE
 *      seguia sempre. A referência que pode sobrar de verdade mora em
 *      `pipeline_entries.deal_id`, antes da unificação;
 *   2. **`deals` é soft-delete por decisão do produto.** A tabela tem
 *      `deleted_at`/`deleted_by` e o comentário da policy `deals_delete` diz,
 *      textualmente, que purgar é RPC `SECURITY DEFINER` (como `purge_lead`),
 *      não DELETE direto. As RPCs `bulk_delete_deals`/`restore_deal`/
 *      `purge_deal` ainda não existem. Entregar a UI de exclusão sem elas
 *      trocaria uma linha invisível por uma perda irreversível de `value`,
 *      `deal_items` e `deal_contacts`, sem lixeira e sem PITR.
 *
 * Linha em `deals` sem card é invisível: toda leitura de negócio passa por
 * `pipeline_entries` (`useLeadsDeals`, ADR-0023 §5). Deixá-la é estritamente
 * melhor que destruí-la sem volta. A limpeza certa é uma RPC de lixeira, em
 * fatia própria.
 */

/** Família do funil — vem de `pipelines.type`, não de slug. */
export interface NegocioAExcluir {
  entryId: string;
  leadId: string;
  /** `true` = funil de sistema. Ver o bloco do discriminador acima. */
  ehSystem: boolean;
  /** Só para o registro no histórico do lead. */
  titulo: string;
  funil: string;
}

export type ResultadoExclusao =
  | "excluido"
  | "ja-nao-existia"
  | "sem-permissao"
  | "erro";

export interface UseExcluirNegocioResult {
  excluindo: boolean;
  excluir: (negocio: NegocioAExcluir) => Promise<ResultadoExclusao>;
}

/**
 * O erro do `supabase-js` **não é um `Error`**.
 *
 * Sem `.throwOnError()`, o `PostgrestBuilder` devolve o corpo parseado — objeto
 * puro `{ message, details, hint, code }`. Um `err instanceof Error` é sempre
 * falso nesse caminho, e o usuário levaria "Erro ao excluir o negócio" quando
 * o banco disse "JWT expired". Testar por `message` cobre os dois formatos.
 */
function mensagemDoErro(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "Erro ao excluir o negócio";
}

/**
 * Mesmo conjunto de chaves que `useCrossPipeMove` invalida ao mover, e pelo
 * mesmo motivo: o board que hospeda o painel fica vivo por trás do overlay e é
 * a primeira coisa que aparece quando ele fecha. Sem o par `-stage-counts`, o
 * badge da coluna continua contando o card apagado até a janela perder e
 * recuperar o foco (`staleTime: 30_000`, sem assinatura de realtime).
 *
 * Prefixo em vez de chave completa: as queryKeys carregam `orgId` e o recorte
 * de filtros da página, que não dá para reconstruir aqui — o match parcial do
 * TanStack v5 cobre todas as variantes montadas.
 */
function invalidar(qc: ReturnType<typeof useQueryClient>, leadId: string): void {
  if (leadId) {
    qc.invalidateQueries({ queryKey: ["lead_all_pipelines", leadId] });
    qc.invalidateQueries({ queryKey: ["lead-pipes", leadId] });
    qc.invalidateQueries({ queryKey: ["lead-timeline", leadId] });
  }
  qc.invalidateQueries({ queryKey: ["pipeline-page"] });
  qc.invalidateQueries({ queryKey: ["pipeline-stage-counts"] });
  qc.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
  qc.invalidateQueries({ queryKey: ["custom_pipe_stage_counts"] });
  qc.invalidateQueries({ queryKey: ["leads-deals"] });
  qc.invalidateQueries({ queryKey: ["leads-sales-metrics"] });
}

export function useExcluirNegocio(): UseExcluirNegocioResult {
  const qc = useQueryClient();
  const registrar = useLogLeadAction();
  const { organizationId } = useOrganization();
  const [excluindo, setExcluindo] = useState(false);

  const excluir = useCallback(
    async (negocio: NegocioAExcluir): Promise<ResultadoExclusao> => {
      const { entryId, leadId, ehSystem } = negocio;

      setExcluindo(true);
      try {
        if (!organizationId) {
          throw new Error("Organização ativa não encontrada");
        }
        const { data: apagadas, error } = await supabase
          .from("pipeline_entries")
          .delete()
          .eq("id", entryId)
          .eq("organization_id", organizationId)
          .select("id");

        if (error) throw error;

        if (!apagadas || apagadas.length === 0) {
          const { data: aindaLa } = await supabase
            .from("pipeline_entries")
            .select("id")
            .eq("id", entryId)
            .eq("organization_id", organizationId)
            .maybeSingle();

          if (!aindaLa) {
            // Alguém chegou antes — outra aba, outro usuário, o ⋯ do kanban.
            // O desfecho que o usuário queria já aconteceu: tratar como
            // sucesso e deixar o painel fechar é o que não o prende num
            // negócio inexistente, tentando de novo para sempre.
            toast.info("Este negócio já havia sido excluído.");
            invalidar(qc, leadId);
            return "ja-nao-existia";
          }

          toast.error("Você não tem permissão para excluir este negócio.");
          return "sem-permissao";
        }

        /**
         * Registro no histórico do lead — a operação mais destrutiva do módulo
         * era a única sem rastro. `useCrossPipeMove` grava a cada MOVIMENTO de
         * etapa; destruir o negócio inteiro não gravava nada, e como a entry
         * some de vez não sobra fonte para reconstruir o que existiu. Sem isto
         * o gestor abre a ficha no dia seguinte e não há como saber sequer que
         * um negócio existiu — muito menos de quem, quando e de quanto.
         *
         * `pipe_removed` é o vocabulário que já existe para "saiu do funil".
         * Fire-and-forget de propósito: o card já saiu, e falhar o histórico
         * não pode transformar uma exclusão feita em erro na tela.
         */
        registrar({
          leadId,
          action: "pipe_removed",
          description: `Negócio "${negocio.titulo}" excluído do funil "${negocio.funil}"`,
          metadata: {
            entry_id: entryId,
            funil: negocio.funil,
            familia: ehSystem ? "system" : "custom",
          },
          tier: 1,
        });

        invalidar(qc, leadId);
        toast.success("Negócio excluído. O lead continua na base.");
        return "excluido";
      } catch (err) {
        toast.error(mensagemDoErro(err));
        return "erro";
      } finally {
        setExcluindo(false);
      }
    },
    [organizationId, qc, registrar],
  );

  return { excluindo, excluir };
}
