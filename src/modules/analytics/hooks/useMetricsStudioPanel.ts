import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { isMissingSchemaError } from "@/lib/rpc-errors";
// Do módulo do tipo, NÃO de "./useMetricsStudio": aquele hook importa este, e o
// import de volta — mesmo sendo só de tipo — fecha ciclo no grafo de módulos e
// reprova o dep-cruiser. Foi o que derrubou o Lint & Build do #1497.
import type { StudioWindow } from "@/modules/analytics/lib/metrics-studio-window";

/**
 * Persistência do painel do Estúdio no SERVIDOR (SCRUM-309).
 *
 * Substitui o `usePersistedState` em localStorage, que morria ao trocar de
 * máquina, sumia com a limpeza de cache e não sobrevivia ao TTL de 30 dias.
 *
 * Tabela `metrics_studio_panels`, um painel por (org, membro). NÃO é
 * `dashboard_widgets`: aquela é grade, é admin-only e o trigger dela exige a
 * flag da TV — ver o cabeçalho da migration 20270811110000.
 *
 * ESCRITA ADIADA. Arrastar uma janela dispara dezenas de mudanças por segundo;
 * gravar cada uma seria uma requisição por quadro. O salvamento espera o
 * silêncio (debounce) e manda o layout inteiro num upsert — o painel é
 * pequeno e o conflito não existe, porque cada linha tem um dono só.
 *
 * DEGRADA SEM QUEBRAR. Enquanto a migration não estiver em prod, a leitura
 * devolve o painel vazio e a escrita falha em silêncio: o usuário monta o
 * painel e usa normalmente na sessão, só não persiste. Melhor que uma tela de
 * erro por uma feature que ainda está subindo.
 */

const DEBOUNCE_MS = 800;

export interface PanelPersistence {
  layout: StudioWindow[] | null;
  isLoading: boolean;
  /** Agenda a gravação. Chamadas seguidas colapsam numa só. */
  save: (windows: StudioWindow[]) => void;
  /** `true` entre a última mudança e a gravação efetiva. */
  isSaving: boolean;
}

export function useMetricsStudioPanel(): PanelPersistence {
  const { organizationId, teamMemberId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  const ativa = isReady && !!organizationId && !!teamMemberId;

  const query = useQuery({
    queryKey: ["metrics-studio-panel", organizationId, teamMemberId],
    queryFn: async (): Promise<StudioWindow[]> => {
      // PONTE DE COMPATIBILIDADE — some junto com o apply em prod.
      //
      // `metrics_studio_panels` nasce na migration 20270811110000, que ainda
      // NÃO está em produção. `src/integrations/supabase/types.ts` é gerado A
      // PARTIR DE PROD (`supabase gen types`), então a tabela não existe para o
      // cliente tipado. Sem assinatura conhecida, o TypeScript percorre a cadeia
      // do PostgrestBuilder sem fim e estoura TS2589 "Type instantiation is
      // excessively deep" — que reprovava o TSC ratchet do job `Lint & Build`
      // e, com ele, os outros SEIS jobs (`needs: [quality]`) e os cinco PRs
      // empilhados sobre esta branch.
      //
      // A chamada é ISOLADA numa variável e a resposta é lida como forma PLANA:
      // não basta silenciar o erro na linha do `.from`, porque o tipo profundo
      // continua fluindo para a anotação de retorno da queryFn (o erro reaparece
      // ali, e foi o que aconteceu na primeira tentativa). Cortar aqui é o que
      // impede a cadeia de sair deste bloco.
      //
      // Ordem correta (runbook): apply em prod → `gen types` apontando para
      // PROD → apagar as duas pontes deste arquivo. Nunca gerar types a partir
      // de branch efêmera: faltam a ela as versões órfãs de prod.
      const tabela = (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: string) => {
              eq: (c: string, v: string) => {
                maybeSingle: () => Promise<{
                  data: { layout?: unknown } | null;
                  error: { message: string; code?: string } | null;
                }>;
              };
            };
          };
        };
      }).from("metrics_studio_panels");

      const { data, error } = await tabela
        .select("layout")
        .eq("organization_id", organizationId!)
        .eq("team_member_id", teamMemberId!)
        .maybeSingle();

      // Tabela ainda não aplicada em prod → painel vazio, sem erro na tela.
      if (error) {
        if (isMissingSchemaError(error)) return [];
        throw new Error(`Painel do Estúdio: ${error.message}`);
      }
      const layout = (data as { layout?: unknown } | null)?.layout;
      return Array.isArray(layout) ? (layout as StudioWindow[]) : [];
    },
    enabled: ativa,
    // O painel só muda por ação do próprio usuário nesta aba. Refetch em foco
    // sobrescreveria o que ele acabou de mexer.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendente = useRef<StudioWindow[] | null>(null);

  const gravar = useCallback(async () => {
    const layout = pendente.current;
    if (!layout || !organizationId || !teamMemberId) return;
    pendente.current = null;

    const { error } = await supabase
      // PONTE DE COMPATIBILIDADE — ver o bloco na leitura, acima. Some no mesmo
      // commit, depois do apply em prod e do `gen types`.
      // @ts-expect-error tabela ausente de types.ts até o apply em produção
      .from("metrics_studio_panels")
      .upsert(
        { organization_id: organizationId, team_member_id: teamMemberId, layout },
        { onConflict: "organization_id,team_member_id" },
      );

    setIsSaving(false);
    if (error) {
      // Falha de persistência não pode derrubar o painel que está na tela.
      // O estado local segue válido; o próximo save tenta de novo.
      console.warn("[metrics-studio] painel não salvo:", error.message);
      return;
    }
    queryClient.setQueryData(["metrics-studio-panel", organizationId, teamMemberId], layout);
  }, [organizationId, teamMemberId, queryClient]);

  const save = useCallback(
    (windows: StudioWindow[]) => {
      if (!ativa) return;
      pendente.current = windows;
      setIsSaving(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void gravar(), DEBOUNCE_MS);
    },
    [ativa, gravar],
  );

  // Sair da página com gravação pendente perderia a última mexida.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void gravar();
      }
    };
  }, [gravar]);

  return {
    layout: ativa ? (query.data ?? null) : [],
    isLoading: ativa && query.isLoading,
    save,
    isSaving,
  };
}
