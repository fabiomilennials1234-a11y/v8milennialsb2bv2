/**
 * wizardData (DB) → estado das ferramentas do Playground.
 *
 * Função pura, sem React: o que sai daqui alimenta os toggles da aba Ferramentas,
 * o bloco `# FERRAMENTAS DISPONÍVEIS` do prompt recompilado e o
 * `conversation_style.toolInstructions` gravado no save.
 *
 * ⚠️ Esta é a fonte da regressão silenciosa que atingiu a Loo (Loofting): enquanto
 * ENVIAR_DOCUMENTO era carregado hardcoded como `false`, o save seguinte — inclusive
 * o save que só anexa um PDF — descartava a chave de `toolInstructions` (o filtro do
 * save é `enabled && instruction`) e recompilava o system_prompt SEM o bloco
 * "## Enviar Documento". A flag `can_send_document` continuava `true` no banco, então
 * o runtime seguia expondo a tool — sem instrução de uso. Quem manda no toggle é a
 * flag do banco; nunca uma constante.
 */
import { PLAYGROUND_TOOLS, filterLegacyTools, type PlaygroundToolState } from "./types";

/** Recorte de CopilotWizardData que decide o estado das ferramentas. */
export interface WizardToolFlags {
  canQualifyLead?: boolean;
  canScheduleMeeting?: boolean;
  canMoveCards?: boolean;
  canTransferHuman?: boolean;
  canCreateLead?: boolean;
  canSendDocument?: boolean;
  canTransferSzChat?: boolean;
  humanPauseEnabled?: boolean;
  humanPauseDurationMinutes?: number;
  toolInstructions?: Record<string, string>;
}

export function wizardToolsState(
  wd: WizardToolFlags,
): Record<string, PlaygroundToolState> {
  const toolState = (
    enabled: boolean,
    toolId: string,
    config: Record<string, unknown> = {},
  ): PlaygroundToolState => {
    const savedInstruction = wd.toolInstructions?.[toolId] || "";
    const def = PLAYGROUND_TOOLS.find((t) => t.id === toolId);
    return {
      enabled,
      config,
      instruction: savedInstruction || (enabled && def ? def.defaultInstruction : ""),
    };
  };

  return filterLegacyTools({
    QUALIFICAR_LEAD: toolState(wd.canQualifyLead ?? false, "QUALIFICAR_LEAD"),
    AGENDAR_REUNIAO: toolState(wd.canScheduleMeeting ?? false, "AGENDAR_REUNIAO"),
    MOVER_CARD: toolState(wd.canMoveCards ?? false, "MOVER_CARD"),
    TRANSFERIR_HUMANO: toolState(wd.canTransferHuman ?? false, "TRANSFERIR_HUMANO"),
    CRIAR_LEAD: toolState(wd.canCreateLead ?? false, "CRIAR_LEAD"),
    PREENCHER_CAMPOS: toolState(true, "PREENCHER_CAMPOS"),
    CRIAR_CAMPO: toolState(false, "CRIAR_CAMPO"),
    TRANSFERIR_SZ_CHAT: toolState(wd.canTransferSzChat ?? false, "TRANSFERIR_SZ_CHAT"),
    ENVIAR_DOCUMENTO: toolState(wd.canSendDocument ?? false, "ENVIAR_DOCUMENTO"),
    PAUSAR_ATENDIMENTO_HUMANO: {
      enabled: wd.humanPauseEnabled ?? true,
      config: { durationMinutes: wd.humanPauseDurationMinutes ?? 60 },
      instruction: wd.toolInstructions?.PAUSAR_ATENDIMENTO_HUMANO ?? "",
    },
  });
}
