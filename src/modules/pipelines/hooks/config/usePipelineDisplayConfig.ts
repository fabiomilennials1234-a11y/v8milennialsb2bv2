import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
// Caminho relativo curto: config -> model é dentro do MESMO módulo, então não
// passa pelo barril público (regra de boundaries do ESLint).
import { rpcNaoTipada } from "../../lib/rpc-nao-tipada";

export type SystemPipeType = "whatsapp" | "confirmacao" | "propostas" | "upsell";

export interface PipelineDisplayConfig {
  id: string;
  organization_id: string;
  pipe_type: SystemPipeType;
  display_name: string;
  is_visible: boolean;
  position: number;
}

/**
 * Os quatro funis de sistema que EXISTEM no produto — não os que a org tem.
 *
 * 🚨 Isto é um CATÁLOGO, não um default. A distinção é o inteiro ponto da
 * migration 20270902000000: antes, esta mesma lista era o fallback devolvido
 * quando a org não tinha linha nenhuma, e por isso todo funil de sistema
 * parecia existir em toda org, sempre. Excluir um era impossível — a lista em
 * memória o trazia de volta na renderização seguinte, mesmo com o banco limpo.
 *
 * Agora ela serve só para responder "o que esta org PODE ativar" (ver
 * `useAvailableSystemPipes`) e para rotular o que o banco devolve. Quem
 * responde "o que esta org TEM" é exclusivamente `pipeline_display_config`.
 */
export const SYSTEM_PIPE_CATALOG: ReadonlyArray<{
  pipe_type: SystemPipeType;
  display_name: string;
  position: number;
}> = [
  { pipe_type: "whatsapp", display_name: "Oportunidades", position: 1 },
  { pipe_type: "confirmacao", display_name: "Agendamentos", position: 2 },
  { pipe_type: "propostas", display_name: "Orçamentos", position: 3 },
  { pipe_type: "upsell", display_name: "Carteira", position: 4 },
];

/**
 * Os funis de sistema que a organização TEM.
 *
 * Linha ausente = a org não tem aquele funil. Não há fallback: lista vazia é
 * uma resposta legítima e significa "esta org não tem funil de sistema algum".
 */
export function usePipelineDisplayConfig() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipeline-display-config", organizationId],
    queryFn: async (): Promise<PipelineDisplayConfig[]> => {
      if (!organizationId) return [];

      // Não há mais `ensure_pipeline_display_config` aqui. Era a torneira nº 1:
      // a cada leitura ela reinseria os 4 funis, o que fazia toda org nova
      // nascer com eles e desfazia qualquer exclusão. A RPC virou no-op na
      // migration 20270902000000 e a chamada saiu junto.
      const { data, error } = await supabase
        .from("pipeline_display_config")
        .select("*")
        .eq("organization_id", organizationId)
        .order("position");

      if (error) throw error;
      return (data ?? []) as PipelineDisplayConfig[];
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Os tipos de funil de sistema que a org tem e que estão ATIVOS.
 * Usado por quem precisa saber "posso semear/ler etapas deste tipo?".
 */
export function useEnabledSystemPipeTypes(): SystemPipeType[] {
  const { data: configs } = usePipelineDisplayConfig();
  return (configs ?? []).map((c) => c.pipe_type);
}

/**
 * Funis de sistema que a org pode REATIVAR — só os que ela TEM registrados
 * porém ocultos (`is_visible = false`).
 *
 * SCRUM-641: o trio legado deixou de ser oferecido como MODELO. Org que nunca
 * teve o registro (org nova pós-funil-único, ou org que excluiu o funil) não
 * vê mais o trio como opção — o único modelo do produto é o "Funil de Vendas"
 * (`FUNIL_DE_VENDAS_STAGES` em contracts/pipe), criado pelo caminho comum de
 * funil. A REATIVAÇÃO de funil oculto de org antiga continua intacta
 * (`enable_system_pipeline`, registry-gated).
 */
export function useAvailableSystemPipes() {
  const { data: configs } = usePipelineDisplayConfig();
  const existentes = new Map((configs ?? []).map((c) => [c.pipe_type, c]));

  return SYSTEM_PIPE_CATALOG.filter((cat) => {
    const atual = existentes.get(cat.pipe_type);
    return !!atual && !atual.is_visible;
  }).map((cat) => ({
    pipe_type: cat.pipe_type,
    // Preserva o nome que a org personalizou.
    display_name: existentes.get(cat.pipe_type)?.display_name ?? cat.display_name,
    /** Sempre true desde SCRUM-641 — a lista só contém funil registrado (oculto). */
    ja_existe: true,
  }));
}

/**
 * Cria (ou reativa) um funil de sistema na org — ato explícito.
 *
 * Substitui o `useTogglePipeVisibility({visible:true})` dos diálogos de
 * ativação: com a linha possivelmente ausente, um UPDATE não casaria com nada
 * e "ativaria" em silêncio, sem criar coisa alguma.
 */
export function useEnableSystemPipe() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (pipeType: SystemPipeType) => {
      if (!organizationId) throw new Error("Organização não resolvida");
      return rpcNaoTipada<{ pipe_type: string; display_name: string; pipeline_id: string | null }>(
        "enable_system_pipeline",
        { p_org_id: organizationId, p_pipe_type: pipeType },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-display-config"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_id"] });
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
      // SCRUM-618: as etapas são semeadas pelo PRÓPRIO `enable_system_pipeline`
      // (server-side, migration 20270906003000) — o front só refaz a leitura.
      queryClient.invalidateQueries({ queryKey: ["pipeline_stages"] });
    },
  });
}

/** Liga/desliga a visibilidade de um funil de sistema que a org JÁ tem. */
export function useTogglePipeVisibility() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ pipeType, visible }: { pipeType: string; visible: boolean }) => {
      if (!organizationId) throw new Error("No org");
      const { error } = await supabase
        .from("pipeline_display_config")
        .update({ is_visible: visible, updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("pipe_type", pipeType);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-display-config"] });
    },
  });
}
