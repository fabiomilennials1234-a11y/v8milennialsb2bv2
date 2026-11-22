/**
 * Aquecimento do boot — a carga fria não espera os gates para começar a tela.
 *
 * Antes, a 1ª query da tela só saía depois de TODO o boot em série: sessão →
 * master/gestor → team_member → feature permissions (edge) → assinatura → só
 * então o `import()` do chunk da rota e, montada a página, a 1ª consulta dela.
 * Duas peças cortam essa fila sem mexer em gate nenhum:
 *
 *   `iniciarCargaDaRotaAtual()` — no carregamento do módulo do App, baixa o
 *       chunk da rota em que a pessoa abriu o app. Chunk importado ≠ montado:
 *       quem decide se a página RENDERIZA continuam sendo os gates.
 *   `AquecerTelaAtual` — assim que o vínculo atual (org + team_member) existe,
 *       dispara a 1ª consulta da tela nas MESMAS chaves e queryFns que os hooks
 *       reais usam; quando a página monta, encontra o cache em voo ou cheio.
 *
 * Invariantes (testados em `tests/unit/boot-prewarm.test.tsx`):
 *   - sem sessão ou sem vínculo resolvido, nada sai;
 *   - master não é aquecido: ele não acessa nada antes do 2º fator (gate de
 *     MFA do ProtectedRoute), e o aquecimento não é exceção a isso;
 *   - a org é SEMPRE a do vínculo atual (`useCurrentTeamMember`) — nunca outra;
 *   - aquecer é leitura sob RLS e nunca decide acesso: falha vira silêncio e a
 *     tela faz a carga normal.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { preCarregarRota } from "@/core/route-prefetch";
import { useAuth, useCurrentTeamMember, useMasterAuth } from "@/modules/identity";
import {
  PIPELINES_STALE_MS,
  buscarPipelinesDaOrg,
  pipelinesQueryKey,
} from "@/modules/pipelines/hooks/model/usePipelines";
import { resolveFunil } from "@/modules/pipelines/lib/resolve-funil";
import { buscarEtapasDoFunil, funilStagesKey } from "@/modules/pipelines/hooks/model/usePaginatedFunil";
import {
  buscarCaixasDoUsuario,
  whatsappInstancesForUserKey,
  type DonoDaListaDeCaixas,
} from "@/modules/communication/hooks/chat/useWhatsAppInstances";

/** Mesmo frescor de `useFunilStages` (e de `usePrefetchPipes`). */
const FRESCOR_ETAPAS_MS = 60_000;

/** Baixa o chunk da rota atual. Respeita economia de dados/2g (`preCarregarRota`). */
export function iniciarCargaDaRotaAtual(
  pathname: string = typeof window === "undefined" ? "" : window.location.pathname,
): void {
  if (!pathname) return;
  preCarregarRota(pathname);
}

export type AlvoDoAquecimento =
  | { tipo: "funil"; slug: string }
  | { tipo: "caixas" }
  | null;

/** Qual é a 1ª consulta da tela, pelo caminho. Fora do mapa: nada. */
export function alvoDoAquecimento(pathname: string): AlvoDoAquecimento {
  const caminho = (pathname.split(/[?#]/, 1)[0] || "/").replace(/\/+$/, "") || "/";
  const funil = /^\/funil\/([^/]+)$/.exec(caminho);
  if (funil) return { tipo: "funil", slug: decodeURIComponent(funil[1]) };
  // Chat e Comando abrem pela lista de caixas do usuário.
  if (caminho === "/chat-whatsapp" || caminho === "/dashboard") return { tipo: "caixas" };
  return null;
}

/**
 * Aquece a 1ª consulta da tela de `pathname` para o vínculo `dono`.
 * Oportunista: nunca lança, nunca decide acesso.
 */
export async function aquecerTelaAtual(
  queryClient: QueryClient,
  pathname: string,
  dono: DonoDaListaDeCaixas,
): Promise<void> {
  const { organizationId, teamMemberId } = dono;
  if (!organizationId || !teamMemberId) return;
  const alvo = alvoDoAquecimento(pathname);
  if (!alvo) return;

  try {
    if (alvo.tipo === "caixas") {
      await queryClient.prefetchQuery({
        queryKey: whatsappInstancesForUserKey(dono),
        queryFn: () => buscarCaixasDoUsuario(dono),
      });
      return;
    }

    // Import estático de propósito: `usePaginatedFunil` já mora no chunk do
    // shell (o trilho o importa via `usePrefetchPipes`); `import()` aqui não
    // moveria nada e só custaria um tick.
    const pipelines = await queryClient.fetchQuery({
      queryKey: pipelinesQueryKey(organizationId),
      queryFn: () => buscarPipelinesDaOrg(organizationId),
      staleTime: PIPELINES_STALE_MS,
    });
    const pipeline = resolveFunil(pipelines, alvo.slug);
    if (!pipeline) return;
    await queryClient.prefetchQuery({
      queryKey: funilStagesKey(pipeline.id),
      queryFn: () => buscarEtapasDoFunil(pipeline.id),
      staleTime: FRESCOR_ETAPAS_MS,
    });
  } catch {
    // Aquecimento é oportunista: falha aqui só vira a carga normal da tela.
  }
}

/**
 * Monta dentro dos providers (Query + Router + Auth). Aquece uma vez por org,
 * no caminho em que a pessoa está quando o vínculo resolve.
 */
export function AquecerTelaAtual(): null {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { data: teamMember } = useCurrentTeamMember();
  const aquecidaPara = useRef<string | null>(null);

  const organizationId = teamMember?.organization_id ?? null;
  const teamMemberId = teamMember?.id ?? null;
  const teamMemberRole = teamMember?.role ?? null;
  const userId = user?.id ?? null;
  // O vínculo tem de ser DESTE usuário: um cache de outra sessão não aquece nada.
  // Master fica de fora: antes de o MFA decidir ele não lê nada do sistema, e o
  // ganho do aquecimento é para a base de membros, não para a Área Dev.
  const vinculoValido =
    !masterLoading &&
    !isMaster &&
    !!userId &&
    !!organizationId &&
    !!teamMemberId &&
    teamMember?.user_id === userId;

  useEffect(() => {
    if (!vinculoValido || !organizationId) return;
    if (aquecidaPara.current === organizationId) return;
    aquecidaPara.current = organizationId;
    void aquecerTelaAtual(queryClient, pathname, { organizationId, teamMemberId, teamMemberRole });
    // `pathname` fora de propósito: é o aquecimento do BOOT, não de cada navegação
    // (essa é do trilho, por hover/foco).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vinculoValido, organizationId, teamMemberId, teamMemberRole, queryClient]);

  return null;
}
