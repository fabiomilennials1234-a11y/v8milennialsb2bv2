/**
 * Test helper — mock PipeOpsPort + wrapper.
 *
 * Usado pelos testes de componentes leads que consomem `usePipeOps()`.
 * Fornece defaults no-op para toda a superfície do port; cada teste sobrescreve
 * só os hooks que exercita. Substitui os antigos `vi.mock("@/modules/pipelines/…")`
 * (que deixaram de funcionar pós-inversão — os componentes leem do context).
 */
import type { ReactNode } from "react";
import { PipeOpsContextProvider } from "./PipeOpsContext";
import type { PipeOpsPort } from "./PipeOpsPort";

const noopQuery = () => ({ data: undefined, isLoading: false, isPending: false }) as never;
const noopMutation = () =>
  ({ mutateAsync: async () => undefined, mutate: () => undefined, isPending: false }) as never;

/**
 * Constrói um PipeOpsPort completo com defaults inertes. Passe `overrides`
 * para injetar mocks específicos (ex.: `{ useUpdatePipeWhatsapp: () => ({ mutateAsync }) }`).
 */
export function makeMockPipeOps(overrides: Partial<PipeOpsPort> = {}): PipeOpsPort {
  const base: PipeOpsPort = {
    usePipelineStages: noopQuery,
    useAllPipelineStageOptions: () => ({ stagesByPipe: {}, isLoading: false }),
    // Default inerte = org SEM funil de sistema. É o pior caso e o mais
    // honesto: teste que espera ver "Oportunidades" no cadastro tem de dizer
    // qual funil a org tem, em vez de herdar três opções de graça — que foi
    // justamente a suposição que produziu o SCRUM-608.
    useSystemPipes: noopQuery,
    useCustomPipelines: noopQuery,
    useCustomPipelineStages: noopQuery,
    // SCRUM-633 — modelo unificado por pipeline_id (bulk sem sentinela).
    useFunnels: noopQuery,
    useFunnelStages: noopQuery,
    useAddLeadToCustomPipe: noopMutation,
    useMoveLeadInCustomPipe: noopMutation,
    useRemoveLeadFromCustomPipe: noopMutation,
    useCreatePipeWhatsapp: noopMutation,
    useCreatePipeConfirmacao: noopMutation,
    useCreatePipeProposta: noopMutation,
    // ADR-0023 decisão 4 — o drawer move o negócio em vez de duplicá-lo.
    //
    // `usePipelineId` devolve um id de mentira em vez de `noopQuery` (que devolve
    // `data: undefined`): o caminho do "compareceu" aborta com "Funil de
    // Orçamentos não encontrado" quando o id é nulo, então o default inerte
    // esconderia o comportamento sob teste. Sobrescreva se o teste quiser
    // exercitar justamente a ausência do funil.
    usePipelineId: (() =>
      ({ data: "pipeline-fake", isLoading: false, isPending: false }) as never),
    moverNegocio: async () => {},
    invalidateAfterMove: () => {},
    useUpdatePipeWhatsapp: noopMutation,
    useUpdatePipeConfirmacao: noopMutation,
    useDeletePipeConfirmacao: noopMutation,
    useUpdatePipeProposta: noopMutation,
    useDeletePipeProposta: noopMutation,
    usePipeConfirmacaoByLeadId: noopQuery,
    usePipePropostaByLeadId: noopQuery,
    usePipePropostaItems: noopQuery,
    useCreatePipePropostaItem: noopMutation,
    useUpdatePipePropostaItem: noopMutation,
    useDeletePipePropostaItem: noopMutation,
    useLossReasons: noopQuery,
    RescheduleModal: () => null,
    MergedMeetingEditor: () => null,
  };
  return { ...base, ...overrides };
}

export function MockPipeOpsProvider({
  children,
  port,
}: {
  children: ReactNode;
  port?: Partial<PipeOpsPort>;
}) {
  return <PipeOpsContextProvider value={makeMockPipeOps(port)}>{children}</PipeOpsContextProvider>;
}
