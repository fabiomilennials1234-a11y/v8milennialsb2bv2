import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isVirtualTeamMember, useOrganization } from "@/modules/identity";
import { isMissingSchemaError } from "@/lib/rpc-errors";
import type { Json } from "@/integrations/supabase/types";
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
 * Tabela `metrics_studio_panels`, **um painel por ORGANIZAÇÃO** desde a
 * migration 20270828000010. Admin de equipe e master editam; todo membro da org
 * lê o mesmo painel. Antes era um por (org, membro) — mudou junto com o gate de
 * edição, porque "todos visualizam" precisa de um objeto comum para visualizar.
 * NÃO é `dashboard_widgets`: aquela é grade, e o trigger dela exige a flag da TV
 * — ver o cabeçalho da migration 20270811110000.
 *
 * ESCRITA ADIADA. Arrastar uma janela dispara dezenas de mudanças por segundo;
 * gravar cada uma seria uma requisição por quadro. O salvamento espera o
 * silêncio (debounce) e manda o layout inteiro num upsert.
 *
 * ⚠️ A linha agora tem UM dono só na prática, mas vários EDITORES possíveis: se
 * dois admins mexerem ao mesmo tempo, o último a gravar vence, sem aviso. É
 * aceitável para um painel (o conteúdo é escolha de exibição, não dado), e é a
 * diferença que o modelo por membro escondia.
 *
 * DEGRADA SEM QUEBRAR. Enquanto a migration não estiver em prod, a leitura
 * devolve o painel vazio e a escrita falha em silêncio: o usuário monta o
 * painel e usa normalmente na sessão, só não persiste. Melhor que uma tela de
 * erro por uma feature que ainda está subindo.
 */

const DEBOUNCE_MS = 800;

export interface PanelPersistence {
  /**
   * A org a que `layout` pertence — `null` enquanto o contexto não resolveu.
   * Sai daqui, e não de um `useOrganization()` próprio no consumidor, para que
   * painel e organização venham SEMPRE do mesmo render: dois hooks lendo a org
   * em pontos diferentes é como a cópia de trabalho se descasa do destino.
   */
  organizationId: string | null;
  layout: StudioWindow[] | null;
  isLoading: boolean;
  /** Agenda a gravação. Chamadas seguidas colapsam numa só. */
  save: (windows: StudioWindow[]) => void;
  /** `true` entre a última mudança e a gravação efetiva. */
  isSaving: boolean;
}

/**
 * 🔴 `panelId` é obrigatório desde que o painel deixou de ser um por org
 * (migration `20271001000000`). Sem ele, a leitura usaria `maybeSingle()` numa
 * tabela que agora aceita várias linhas por org — e `maybeSingle()` ESTOURA com
 * mais de uma. Não é preferência de API: é o que impede a tela de quebrar assim
 * que existir a segunda aba.
 */
export function useMetricsStudioPanel(panelId: string | null): PanelPersistence {
  const { organizationId, teamMemberId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  // O painel é DA ORGANIZAÇÃO, não do membro (mig. 20270828000010). A leitura
  // não depende mais de haver `teamMemberId`: é isso que faz MASTER — que não
  // tem linha em `team_members` — enxergar o painel em vez de tela vazia.
  const ativa = isReady && !!organizationId;

  // `team_member_id` deixou de ser dono e virou "quem editou por último".
  // O id virtual do master (`master-virtual-<uuid>`) NÃO é uuid de
  // `team_members`: mandá-lo estoura 22P02/23503. Vira NULL, que a coluna
  // agora aceita — e era exatamente isto que impedia master de salvar painel.
  const editorId = isVirtualTeamMember(teamMemberId) ? null : (teamMemberId ?? null);

  const query = useQuery({
    queryKey: ["metrics-studio-panel", organizationId, panelId],
    queryFn: async (): Promise<StudioWindow[]> => {
      // As duas PONTES DE COMPATIBILIDADE deste arquivo foram removidas em
      // 2026-08-31, seguindo o runbook que o próprio comentário delas descrevia:
      // apply em prod → `gen types` apontando para PROD → apagar as pontes.
      //
      // `metrics_studio_panels` (migration 20270811110000) já está em produção e
      // é tipada. O `as unknown as { from: ... }` que existia aqui era para
      // evitar TS2589 ("Type instantiation is excessively deep") enquanto o
      // cliente não conhecia a tabela; com a assinatura real, ele deixou de ser
      // necessário — e passou a ser nocivo, porque escondia a checagem.
      const { data, error } = await supabase
        .from("metrics_studio_panels")
        .select("layout")
        .eq("id", panelId!)
        .maybeSingle();

      // Tabela ainda não aplicada em prod → painel vazio, sem erro na tela.
      if (error) {
        if (isMissingSchemaError(error)) return [];
        throw new Error(`Painel do Estúdio: ${error.message}`);
      }
      const layout = (data as { layout?: unknown } | null)?.layout;
      return Array.isArray(layout) ? (layout as StudioWindow[]) : [];
    },
    enabled: ativa && !!panelId,
    // O painel só muda por ação do próprio usuário nesta aba. Refetch em foco
    // sobrescreveria o que ele acabou de mexer.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * A gravação pendente carrega o DESTINO junto, não só o conteúdo.
   *
   * 🚨 Antes guardava só `StudioWindow[]`, e o destino saía do closure de
   * `gravar` no momento do disparo. Entre o agendamento e o disparo cabe uma
   * TROCA DE ORGANIZAÇÃO — e aí o layout de uma org era carimbado em outra.
   * Foi assim que o painel da org Milennials virou `[]` em 26/08/2026: o POST
   * saiu no mesmo milissegundo do `invalidateQueries()` do `switchOrg`.
   *
   * `editorId` entra no pacote pelo mesmo motivo: ele vem de `teamMemberId`,
   * que também muda com a org. Registrar quem editou usando o membro da org
   * NOVA numa escrita da org VELHA seria mentir na única coluna de autoria
   * que a tabela tem.
   */
  const pendente = useRef<{
    organizationId: string;
    panelId: string;
    editorId: string | null;
    layout: StudioWindow[];
  } | null>(null);

  const gravar = useCallback(async () => {
    const alvo = pendente.current;
    if (!alvo) return;
    pendente.current = null;
    timer.current = null;

    const { organizationId: orgAlvo, panelId: painelAlvo, editorId: editor, layout } = alvo;

    const { error } = await supabase
      .from("metrics_studio_panels")
      .upsert(
        {
          // 🔴 `id` no corpo E como alvo do conflito. O upsert apontava para
          // `organization_id`, que dependia do índice
          // `metrics_studio_panels_org_unico` — derrubado pela migration
          // `20271001000000` para permitir abas. Sem índice único casando com o
          // `ON CONFLICT`, o Postgres RECUSA a escrita, e o painel para de
          // salvar com erro só no console.
          id: painelAlvo,
          organization_id: orgAlvo,
          team_member_id: editor,
          // `layout` é `Json` na coluna e `StudioWindow[]` aqui. A dupla
          // conversão é necessária: `Json` é recursivo e não aceita uma
          // interface nominal direto, mesmo sendo estruturalmente compatível.
          // É a única forma que o tipo gerado admite — não é frouxidão.
          layout: layout as unknown as Json,
        },
        { onConflict: "id" },
      );

    setIsSaving(false);
    if (error) {
      // Falha de persistência não pode derrubar o painel que está na tela.
      // O estado local segue válido; o próximo save tenta de novo.
      //
      // Membro comum cai AQUI de propósito: a RLS de escrita é admin-only, e o
      // front já esconde os controles de edição. Este ramo é a segunda barreira,
      // não a primeira — e ela avisa no console em vez de gritar na tela, porque
      // membro nenhum deveria conseguir chegar até aqui.
      console.warn("[metrics-studio] painel não salvo:", error.message);
      return;
    }
    queryClient.setQueryData(["metrics-studio-panel", orgAlvo, painelAlvo], layout);
  }, [queryClient]);

  const save = useCallback(
    (windows: StudioWindow[]) => {
      if (!ativa || !organizationId || !panelId) return;
      pendente.current = { organizationId, panelId, editorId, layout: windows };
      setIsSaving(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void gravar(), DEBOUNCE_MS);
    },
    [ativa, organizationId, panelId, editorId, gravar],
  );

  /**
   * Sair da página com gravação pendente perderia a última mexida.
   *
   * 🚨 As dependências são `[]` DE PROPÓSITO, e `gravar` entra por ref. Com
   * `[gravar]` no lugar, este cleanup deixava de ser "saiu da página" e virava
   * "qualquer coisa de que `gravar` dependa mudou" — inclusive a ORGANIZAÇÃO.
   * Trocar de org derrubava o efeito e disparava a gravação no meio da troca.
   * Hoje `gravar` já não depende da org (o destino viaja em `pendente`), mas
   * amarrar a intenção aqui impede que a próxima dependência ressuscite o bug.
   */
  const gravarRef = useRef(gravar);
  gravarRef.current = gravar;
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void gravarRef.current();
      }
    };
  }, []);

  return {
    organizationId: ativa ? organizationId : null,
    layout: ativa ? (query.data ?? null) : [],
    isLoading: ativa && query.isLoading,
    save,
    isSaving,
  };
}
