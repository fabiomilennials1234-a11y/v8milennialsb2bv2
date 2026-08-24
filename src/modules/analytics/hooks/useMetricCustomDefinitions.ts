import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { MetricTreeNode } from "@/modules/analytics/lib/metric-tree";
import type { MetricFormatId, MetricUnit } from "@/modules/analytics/lib/metric-vocabulary";

/**
 * Métricas personalizadas da organização — Emenda 1 do ADR-0023 (SCRUM-316..320).
 *
 * Leitura e escrita vão por PostgREST com RLS, sem função nova: a tabela
 * `metric_custom_definitions` isola por `get_my_organization_ids()` na leitura
 * e por `get_my_team_admin_organization_ids()` na escrita. Não há GRANT em
 * SECURITY DEFINER para errar aqui.
 *
 * ⚠ A helper de ESCRITA é `get_my_team_admin_organization_ids()`, NÃO
 * `get_my_admin_organization_ids()` — os nomes não distinguem, os corpos sim.
 * A segunda inclui GESTOR DE PORTFÓLIO (ADR-0021), papel escopado a funis, que
 * não deve definir métrica da organização inteira. A policy usa `role = 'admin'
 * AND is_active`, e nada mais. Ver o cabeçalho da migration
 * `20270813110000_metric_custom_definitions.sql`. Não "alinhe" uma à outra.
 *
 * MASTER entra por policy PRÓPRIA, não pela helper de tenant:
 * `master_ghost_all_metric_custom_definitions` (mig. `20270824070000`), no
 * padrão `master_ghost_all_*` do repositório. Sem ela o master não escrevia
 * — e nem lia, porque `get_my_organization_ids()` também é vazia para ele.
 * Gestor de portfólio continua fora das duas portas.
 *
 * A validação da árvore acontece nas DUAS pontas, e nenhuma delas é este hook:
 * o compositor valida com `validarArvore` antes de habilitar o botão, e o banco
 * valida de novo no trigger. Este hook só carrega o payload — se ele passar uma
 * árvore inválida, o `INSERT` levanta 22023 e a mensagem chega ao usuário.
 */

export interface MetricCustomDefinition {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  tree: MetricTreeNode;
  format_id: MetricFormatId;
  derived_unit: MetricUnit;
  created_at: string;
  updated_at: string;
}

export interface MetricCustomDraft {
  name: string;
  description?: string | null;
  tree: MetricTreeNode;
  format_id: MetricFormatId;
}

const CHAVE = "metric-custom-definitions";

/**
 * PONTE DE COMPATIBILIDADE — some junto com o apply em prod.
 *
 * `metric_custom_definitions` nasce na migration 20270813110000, que ainda NÃO
 * está em produção. `src/integrations/supabase/types.ts` é gerado A PARTIR DE
 * PROD, então a tabela não existe para o cliente tipado: sem assinatura
 * conhecida, o TypeScript percorre a cadeia do PostgrestBuilder sem fim e
 * estoura TS2589, que reprova o TSC ratchet do job `Lint & Build`.
 *
 * A chamada é isolada aqui e a resposta é lida como forma PLANA — silenciar o
 * erro na linha do `.from` não basta, porque o tipo profundo continua fluindo
 * para a anotação de retorno da queryFn (foi o que aconteceu no #1497).
 *
 * Ordem correta (runbook): apply em prod → `gen types` apontando para PROD →
 * apagar esta ponte. Nunca gerar types a partir de branch efêmera.
 */
type RespostaPlana<T> = Promise<{ data: T; error: { message: string; code?: string } | null }>;

interface TabelaPlana {
  select: (c: string) => {
    eq: (c: string, v: string) => {
      order: (c: string, o: { ascending: boolean }) => RespostaPlana<MetricCustomDefinition[] | null>;
    };
  };
  insert: (row: Record<string, unknown>) => {
    select: (c: string) => {
      single: () => RespostaPlana<MetricCustomDefinition | null>;
    };
  };
  update: (row: Record<string, unknown>) => {
    eq: (c: string, v: string) => {
      eq: (c: string, v: string) => RespostaPlana<null>;
    };
  };
  delete: () => {
    eq: (c: string, v: string) => {
      eq: (c: string, v: string) => RespostaPlana<null>;
    };
  };
}

function tabela(): TabelaPlana {
  return (supabase as unknown as { from: (t: string) => TabelaPlana }).from(
    "metric_custom_definitions",
  );
}

/** `42P01` = relação inexistente: a migration ainda não foi aplicada no alvo. */
function tabelaAusente(erro: { code?: string; message: string } | null): boolean {
  return erro?.code === "42P01" || /metric_custom_definitions.*does not exist/i.test(erro?.message ?? "");
}

export interface MetricCustomApi {
  definicoes: MetricCustomDefinition[];
  isLoading: boolean;
  criar: (draft: MetricCustomDraft) => Promise<MetricCustomDefinition | null>;
  atualizar: (id: string, draft: MetricCustomDraft) => Promise<void>;
  remover: (id: string) => Promise<void>;
  salvando: boolean;
}

export function useMetricCustomDefinitions(): MetricCustomApi {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [CHAVE, organizationId],
    queryFn: async (): Promise<MetricCustomDefinition[]> => {
      const { data, error } = await tabela()
        .select("id, organization_id, name, description, tree, format_id, derived_unit, created_at, updated_at")
        .eq("organization_id", organizationId!)
        .order("name", { ascending: true });

      // Antes do apply, a lista fica VAZIA em vez de derrubar o Estúdio: a
      // feature simplesmente não aparece, que é o mesmo comportamento da trava
      // de rollout. Falha para fechado.
      if (error) {
        if (tabelaAusente(error)) return [];
        throw new Error(`Métricas personalizadas: ${error.message}`);
      }
      return data ?? [];
    },
    enabled: isReady && !!organizationId,
    staleTime: 60 * 1000,
  });

  const invalidar = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [CHAVE, organizationId] });
  }, [queryClient, organizationId]);

  const criar = useMutation({
    mutationFn: async (draft: MetricCustomDraft) => {
      const { data, error } = await tabela()
        .insert({
          organization_id: organizationId,
          name: draft.name,
          description: draft.description ?? null,
          tree: draft.tree,
          format_id: draft.format_id,
          // `derived_unit` NÃO vai no payload de propósito: ela é DERIVADA da
          // árvore pelo trigger BEFORE INSERT, que roda antes de o `NOT NULL`
          // ser avaliado. Mandá-la daqui seria oferecer ao cliente um campo que
          // o banco sobrescreve — convite a acreditar num valor que não vale.
        })
        .select("id, organization_id, name, description, tree, format_id, derived_unit, created_at, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: invalidar,
  });

  const atualizar = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: MetricCustomDraft }) => {
      const { error } = await tabela()
        .update({
          name: draft.name,
          description: draft.description ?? null,
          tree: draft.tree,
          format_id: draft.format_id,
        })
        .eq("id", id)
        .eq("organization_id", organizationId!);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidar,
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tabela()
        .delete()
        .eq("id", id)
        .eq("organization_id", organizationId!);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidar,
  });

  return {
    definicoes: query.data ?? [],
    isLoading: query.isLoading,
    criar: (draft) => criar.mutateAsync(draft),
    atualizar: (id, draft) => atualizar.mutateAsync({ id, draft }),
    remover: (id) => remover.mutateAsync(id),
    salvando: criar.isPending || atualizar.isPending || remover.isPending,
  };
}
