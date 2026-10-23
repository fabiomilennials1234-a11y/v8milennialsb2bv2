/**
 * Clássica — o passo Mensagem segura enquanto o anexo sobe (Chamado dac7e647).
 *
 * Cópia do caso de tests/unit/disparo-wizard.test.ts para o wizard-machine da
 * clássica (`@` resolve para classic/src). Um anexo sem URL ainda está subindo:
 * deixar avançar liberaria um Disparo que sai só com texto, sem aviso.
 */
import { describe, it, expect } from "vitest";
import {
  validateStep,
  type DisparoDraft,
  type DisparoNumber,
} from "@/modules/campaigns/components/disparo-wizard/wizard-machine";
import { createDefaultSelection } from "@/modules/campaigns/components/disparo-wizard/audience-resolve";

const NUMBERS: DisparoNumber[] = [
  { id: "a", label: "Comercial", cap: 80, selected: true, regime: "chip" },
];

function freshDraft(over: Partial<DisparoDraft> = {}): DisparoDraft {
  return {
    audienceSourceType: "estagio",
    audience: createDefaultSelection(),
    audienceLabel: "",
    audienceCount: 0,
    leadIds: [],
    audienceSource: null,
    message: "",
    media: null,
    mediaError: null,
    antiBan: true,
    postSendMode: "none",
    postSendPipelineId: null,
    postSendStageId: "",
    postSendLabel: "",
    numbers: NUMBERS,
    capPerNumber: 80,
    startDateIso: "2026-06-25",
    released: false,
    ...over,
  } as DisparoDraft;
}

describe("validateStep message — anexo (clássica)", () => {
  it("segura enquanto o anexo não tem URL e libera quando sobe", () => {
    const pending = freshDraft({
      message: "Olá",
      media: { type: "document", sizeBytes: 10, name: "catalogo.pdf", url: null },
    });
    expect(validateStep("message", pending).ok).toBe(false);
    expect(validateStep("message", pending).reason).toMatch(/anexo/i);

    const uploaded = freshDraft({
      message: "Olá",
      media: {
        type: "document",
        sizeBytes: 10,
        name: "catalogo.pdf",
        url: "https://x/storage/v1/object/public/media/disparo/c.pdf",
      },
    });
    expect(validateStep("message", uploaded).ok).toBe(true);
  });

  it("texto sem anexo segue passando", () => {
    expect(validateStep("message", freshDraft({ message: "Olá" })).ok).toBe(true);
  });
});
