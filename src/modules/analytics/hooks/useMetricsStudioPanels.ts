/**
 * As ABAS do Estúdio — a lista, não o conteúdo.
 *
 * Divisão de responsabilidade com `useMetricsStudioPanel`: este hook sabe
 * QUAIS abas existem (nome, ordem, origem) e como criá-las, renomeá-las,
 * reordená-las e removê-las. O outro sabe carregar e gravar o LAYOUT de uma
 * aba. Juntar os dois faria toda renomeação recarregar o canvas.
 *
 * ── 🔴 O par com a migration `20271001000000` é obrigatório ──
 *
 * Aquela migration derruba `metrics_studio_panels_org_unico` (o UNIQUE em
 * `organization_id`) para permitir mais de um painel por org. Só que o `upsert`
 * do painel usava `onConflict: "organization_id"`, e o Postgres exige um índice
 * único casando com o `ON CONFLICT`.
 *
 * **Aplicar a migration sem esta fatia deployada faz o Estúdio parar de salvar
 * painel** — com erro no console e nada na tela, que é o pior formato. O
 * `upsert` passou a apontar para a chave primária (`id`), que é estável e não
 * depende de índice que a evolução do produto derrube.
 *
 * ── Aba é da ORGANIZAÇÃO ──
 *
 * A RLS já dizia isso e não mudou: SELECT por `get_my_organization_ids()`,
 * escrita por `get_my_team_admin_organization_ids()`. Todos veem as mesmas
 * abas; admin edita. `team_member_id` é "quem mexeu por último", não dono.
 */

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { StudioWindow } from "@/modules/analytics/lib/metrics-studio-window";

export interface StudioPanel {
  id: string;
  nome: string;
  ordem: number;
  /** Template de fábrica que originou a aba; `null` = criada do zero. */
  templateKey: string | null;
  layout: StudioWindow[];
}

export interface PanelsApi {
  organizationId: string | null;
  paineis: StudioPanel[];
  isLoading: boolean;
  criar: (nome: string, layout?: StudioWindow[], templateKey?: string | null) => Promise<string | null>;
  renomear: (id: string, nome: string) => Promise<void>;
  remover: (id: string) => Promise<void>;
  reordenar: (idsNaOrdem: string[]) => Promise<void>;
}

const CHAVE = (orgId: string | null) => ["metrics-studio-panels", orgId];

/** Nome sempre visível e dentro do CHECK da coluna (1–60 chars). */
function sanearNome(nome: string): string {
  const limpo = nome.trim().slice(0, 60);
  return limpo.length > 0 ? limpo : "Nova aba";
}

export function useMetricsStudioPanels(): PanelsApi {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const ativa = isReady && !!organizationId;

  const query = useQuery({
    queryKey: CHAVE(organizationId),
    queryFn: async (): Promise<StudioPanel[]> => {
      const { data, error } = await supabase
        .from("metrics_studio_panels")
        .select("id, nome, ordem, template_key, layout")
        .eq("organization_id", organizationId!)
        // Desempate por `created_at`: `ordem` NÃO é única de propósito —
        // reordenar exigiria trocar duas linhas numa transação, e um UNIQUE
        // brigaria no meio da troca.
        .order("ordem", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw new Error(`Abas do Estúdio: ${error.message}`);

      /**
       * 🔴 O cast existe porque `types.ts` ainda não conhece `nome`, `ordem` e
       * `template_key` — e NÃO PODE conhecer ainda.
       *
       * `types.ts` é gerado de PROD, e a migration `20271001000000` não pode ser
       * aplicada antes deste código estar no ar: ela derruba o índice de que o
       * upsert antigo dependia. A ordem é mergear → aplicar → regenerar tipos,
       * e é nessa terceira etapa que estes casts somem.
       *
       * `unknown` no meio porque o PostgREST tipa a coluna desconhecida como
       * `SelectQueryError`, que não se sobrepõe a `Record` — converter direto é
       * recusado, e com razão.
       */
      return ((data ?? []) as unknown[]).map((linha) => {
        const bruto = linha as Record<string, unknown>;
        const layout = bruto.layout;
        return {
          id: String(bruto.id),
          nome: String(bruto.nome ?? "Painel"),
          ordem: Number(bruto.ordem ?? 0),
          templateKey: (bruto.template_key as string | null) ?? null,
          layout: Array.isArray(layout) ? (layout as StudioWindow[]) : [],
        };
      });
    },
    enabled: ativa,
    // A lista de abas só muda por ação do próprio usuário nesta janela.
    refetchOnWindowFocus: false,
  });

  const invalidar = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: CHAVE(organizationId) });
  }, [queryClient, organizationId]);

  const criarMut = useMutation({
    mutationFn: async (params: {
      nome: string;
      layout: StudioWindow[];
      templateKey: string | null;
    }) => {
      const atuais = query.data ?? [];
      // Nasce no fim. Calcular a partir do MAIOR `ordem`, e não do tamanho da
      // lista, é o que mantém a conta certa depois de remover uma aba do meio.
      const proximaOrdem = atuais.reduce((max, p) => Math.max(max, p.ordem), -1) + 1;

      const { data, error } = await supabase
        .from("metrics_studio_panels")
        // Mesmo motivo do cast na leitura: as três colunas só entram em
        // `types.ts` depois que a migration for aplicada, e ela vem DEPOIS
        // deste merge.
        .insert({
          organization_id: organizationId!,
          nome: sanearNome(params.nome),
          ordem: proximaOrdem,
          template_key: params.templateKey,
          layout: params.layout,
        } as unknown as never)
        .select("id")
        .single();

      if (error) throw new Error(`Criar aba: ${error.message}`);
      return String((data as { id: string }).id);
    },
    onSuccess: invalidar,
  });

  const renomearMut = useMutation({
    mutationFn: async (params: { id: string; nome: string }) => {
      const { error } = await supabase
        .from("metrics_studio_panels")
        .update({ nome: sanearNome(params.nome) } as unknown as never)
        .eq("id", params.id);
      if (error) throw new Error(`Renomear aba: ${error.message}`);
    },
    onSuccess: invalidar,
  });

  const removerMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("metrics_studio_panels").delete().eq("id", id);
      if (error) throw new Error(`Remover aba: ${error.message}`);
    },
    onSuccess: invalidar,
  });

  const reordenarMut = useMutation({
    mutationFn: async (idsNaOrdem: string[]) => {
      // Uma escrita por aba. Não é transação, e não precisa ser: `ordem` só
      // ordena a lista — uma falha no meio deixa a ordem torta, nunca perde
      // aba. Envolver isto numa RPC transacional custaria mais do que o
      // problema que evita.
      await Promise.all(
        idsNaOrdem.map((id, i) =>
          supabase
            .from("metrics_studio_panels")
            // Mesmo cast das outras escritas: `ordem` só entra em `types.ts`
            // depois que a migration for aplicada, e ela vem DEPOIS deste merge.
            .update({ ordem: i } as unknown as never)
            .eq("id", id),
        ),
      );
    },
    onSuccess: invalidar,
  });

  return {
    organizationId: organizationId ?? null,
    paineis: query.data ?? [],
    isLoading: query.isLoading,
    criar: async (nome, layout = [], templateKey = null) => {
      if (!ativa) return null;
      return criarMut.mutateAsync({ nome, layout, templateKey });
    },
    renomear: async (id, nome) => {
      await renomearMut.mutateAsync({ id, nome });
    },
    remover: async (id) => {
      await removerMut.mutateAsync(id);
    },
    reordenar: async (ids) => {
      await reordenarMut.mutateAsync(ids);
    },
  };
}
