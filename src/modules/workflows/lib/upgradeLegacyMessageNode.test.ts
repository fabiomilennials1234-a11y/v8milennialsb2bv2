/**
 * upgradeLegacyMessageNode — pure lazy migration (ADR-0012).
 *
 * Converts the legacy per-type WhatsApp send nodes into the unified
 * send_whatsapp_message node. generate_ai_message and non-message nodes pass
 * through untouched. Idempotent.
 */
import { describe, it, expect } from "vitest";
import type { ActionNodeData } from "@/types/workflow";
import {
  upgradeLegacyMessageNodeData,
  upgradeWorkflowNodes,
} from "./upgradeLegacyMessageNode";

function action(actionType: string, extra: Partial<ActionNodeData> = {}): ActionNodeData {
  return { type: "action", actionType, label: "x", ...extra } as ActionNodeData;
}

describe("upgradeLegacyMessageNodeData", () => {
  it("converts send_whatsapp → texto", () => {
    const out = upgradeLegacyMessageNodeData(action("send_whatsapp", { messageTemplate: "Olá" }));
    expect(out.actionType).toBe("send_whatsapp_message");
    expect(out.messageType).toBe("texto");
    expect(out.messageTemplate).toBe("Olá"); // config preserved
  });

  it("converts send_whatsapp_audio → audio", () => {
    const out = upgradeLegacyMessageNodeData(action("send_whatsapp_audio", { audioUrl: "a.ogg" }));
    expect(out.actionType).toBe("send_whatsapp_message");
    expect(out.messageType).toBe("audio");
    expect(out.audioUrl).toBe("a.ogg");
  });

  it("converts send_whatsapp_image → imagem", () => {
    const out = upgradeLegacyMessageNodeData(action("send_whatsapp_image", { imageUrl: "i.jpg", imageCaption: "c" }));
    expect(out.messageType).toBe("imagem");
    expect(out.imageCaption).toBe("c");
  });

  it("converts sticker / menu / pix_button to their message types", () => {
    expect(upgradeLegacyMessageNodeData(action("send_whatsapp_video")).messageType).toBe("video");
    expect(upgradeLegacyMessageNodeData(action("send_whatsapp_sticker")).messageType).toBe("sticker");
    expect(upgradeLegacyMessageNodeData(action("send_whatsapp_menu")).messageType).toBe("menu");
    expect(upgradeLegacyMessageNodeData(action("send_whatsapp_pix_button")).messageType).toBe("pix");
  });

  it("leaves generate_ai_message untouched (it does not send)", () => {
    const input = action("generate_ai_message", { aiPrompt: "p" });
    const out = upgradeLegacyMessageNodeData(input);
    expect(out.actionType).toBe("generate_ai_message");
    expect(out.messageType).toBeUndefined();
  });

  it("leaves non-message nodes untouched", () => {
    const out = upgradeLegacyMessageNodeData(action("move_stage", { targetStage: "abordado" }));
    expect(out.actionType).toBe("move_stage");
  });

  it("is idempotent — an already-unified node is returned unchanged", () => {
    const already = action("send_whatsapp_message", { messageType: "texto" });
    expect(upgradeLegacyMessageNodeData(already)).toEqual(already);
  });

  it("is idempotent across double application", () => {
    const once = upgradeLegacyMessageNodeData(action("send_whatsapp_image", { imageUrl: "i.jpg" }));
    const twice = upgradeLegacyMessageNodeData(once);
    expect(twice).toEqual(once);
  });
});

describe("upgradeWorkflowNodes", () => {
  it("upgrades action nodes and leaves others intact", () => {
    const nodes = [
      { id: "1", type: "trigger", data: { type: "trigger", label: "t" } },
      { id: "2", type: "action", data: action("send_whatsapp", { messageTemplate: "Oi" }) },
      { id: "3", type: "action", data: action("generate_ai_message", { aiPrompt: "p" }) },
    ];
    const out = upgradeWorkflowNodes(nodes as any);
    expect(out[0]).toEqual(nodes[0]); // trigger untouched
    expect((out[1].data as ActionNodeData).actionType).toBe("send_whatsapp_message");
    expect((out[1].data as ActionNodeData).messageType).toBe("texto");
    expect((out[2].data as ActionNodeData).actionType).toBe("generate_ai_message");
  });

  it("returns a workflow without legacy senders unchanged (referential same data)", () => {
    const nodes = [{ id: "1", type: "action", data: action("move_stage") }];
    const out = upgradeWorkflowNodes(nodes as any);
    expect(out[0].data).toBe(nodes[0].data);
  });
});
