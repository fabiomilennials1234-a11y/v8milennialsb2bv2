// @vitest-environment node
/**
 * wizardData → estado das ferramentas do Playground.
 *
 * Regressão coberta: ENVIAR_DOCUMENTO / TRANSFERIR_SZ_CHAT eram carregados
 * hardcoded como `false`, ignorando `can_send_document` / `can_transfer_sz_chat`.
 * O save seguinte (que só guarda `enabled && instruction`) apagava a instrução da
 * ferramenta e recompilava o system_prompt sem o bloco dela — com a flag do banco
 * ainda `true`, ou seja, tool exposta no runtime e sem instrução de uso.
 */

import { describe, it, expect } from "vitest";
import { wizardToolsState } from "@/modules/copilot/components/playground/tools-mapping";

describe("wizardToolsState", () => {
  it("liga ENVIAR_DOCUMENTO quando can_send_document vem true do banco", () => {
    const tools = wizardToolsState({ canSendDocument: true });

    expect(tools.ENVIAR_DOCUMENTO.enabled).toBe(true);
  });

  it("preserva a instrução salva da ferramenta em vez do texto default", () => {
    const tools = wizardToolsState({
      canSendDocument: true,
      toolInstructions: { ENVIAR_DOCUMENTO: "Catálogo vai antes da reunião." },
    });

    expect(tools.ENVIAR_DOCUMENTO.instruction).toBe("Catálogo vai antes da reunião.");
  });

  it("sobrevive ao round-trip do save, que só persiste ferramenta habilitada com instrução", () => {
    const tools = wizardToolsState({
      canSendDocument: true,
      toolInstructions: { ENVIAR_DOCUMENTO: "Catálogo vai antes da reunião." },
    });

    // Espelha o filtro de CopilotPlayground ao montar conversation_style.toolInstructions.
    const persisted = Object.fromEntries(
      Object.entries(tools)
        .filter(([, s]) => s.enabled && s.instruction)
        .map(([id, s]) => [id, s.instruction]),
    );

    expect(persisted.ENVIAR_DOCUMENTO).toBe("Catálogo vai antes da reunião.");
  });

  it("mantém desligada a ferramenta cuja flag está false, sem herdar instrução default", () => {
    const tools = wizardToolsState({ canSendDocument: false, canTransferSzChat: false });

    expect(tools.ENVIAR_DOCUMENTO.enabled).toBe(false);
    expect(tools.ENVIAR_DOCUMENTO.instruction).toBe("");
    expect(tools.TRANSFERIR_SZ_CHAT.enabled).toBe(false);
  });

  it("liga TRANSFERIR_SZ_CHAT pela flag do banco", () => {
    expect(wizardToolsState({ canTransferSzChat: true }).TRANSFERIR_SZ_CHAT.enabled).toBe(true);
  });

  it("PAUSAR_ATENDIMENTO_HUMANO é ligado por default e carrega a duração salva", () => {
    const tools = wizardToolsState({ humanPauseDurationMinutes: 30 });

    expect(tools.PAUSAR_ATENDIMENTO_HUMANO.enabled).toBe(true);
    expect(tools.PAUSAR_ATENDIMENTO_HUMANO.config.durationMinutes).toBe(30);
  });

  it("não devolve ferramenta legada (RESPONDER_FAQ / ENVIAR_FOLLOWUP)", () => {
    const tools = wizardToolsState({});

    expect(tools.RESPONDER_FAQ).toBeUndefined();
    expect(tools.ENVIAR_FOLLOWUP).toBeUndefined();
  });
});
