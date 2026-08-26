import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isVirtualTeamMember, useOrganization } from "@/modules/identity";
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

export function useMetricsStudioPanel(): PanelPersistence {
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
    queryKey: ["metrics-studio-panel", organizationId],
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
              maybeSingle: () => Promise<{
                data: { layout?: unknown } | null;
                error: { message: string; code?: string } | null;
              }>;
            };
          };
        };
      }).from("metrics_studio_panels");

      const { data, error } = await tabela
        .select("layout")
        .eq("organization_id", organizationId!)
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
    editorId: string | null;
    layout: StudioWindow[];
  } | null>(null);

  const gravar = useCallback(async () => {
    const alvo = pendente.current;
    if (!alvo) return;
    pendente.current = null;
    timer.current = null;

    const { organizationId: orgAlvo, editorId: editor, layout } = alvo;

    const { error } = await supabase
      // PONTE DE COMPATIBILIDADE — ver o bloco na leitura, acima. Some no mesmo
      // commit, depois do apply em prod e do `gen types`.
      // @ts-expect-error tabela ausente de types.ts até o apply em produção
      .from("metrics_studio_panels")
      .upsert(
        { organization_id: orgAlvo, team_member_id: editor, layout },
        { onConflict: "organization_id" },
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
    queryClient.setQueryData(["metrics-studio-panel", orgAlvo], layout);
  }, [queryClient]);

  const save = useCallback(
    (windows: StudioWindow[]) => {
      if (!ativa || !organizationId) return;
      pendente.current = { organizationId, editorId, layout: windows };
      setIsSaving(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void gravar(), DEBOUNCE_MS);
    },
    [ativa, organizationId, editorId, gravar],
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
