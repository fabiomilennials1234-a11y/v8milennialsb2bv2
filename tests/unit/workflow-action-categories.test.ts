/**
 * getActionCategories — org-gated picker for the unified message node (ADR-0012).
 *
 * Flag OFF (default / fail-closed) → legacy picker, exactly as before.
 * Flag ON → the six WhatsApp send actions collapse into send_whatsapp_message.
 */
import { describe, it, expect } from "vitest";
import { getActionCategories, ACTION_CATEGORIES } from "../../src/types/workflow";

function comunicacao(unified: boolean): string[] {
  const cat = getActionCategories(unified).find((c) => c.label === "Comunicação");
  return cat!.actions as string[];
}

describe("getActionCategories", () => {
  it("OFF: keeps the legacy WhatsApp send actions (unchanged from ACTION_CATEGORIES)", () => {
    const actions = comunicacao(false);
    expect(actions).toContain("send_whatsapp");
    expect(actions).toContain("send_whatsapp_audio");
    expect(actions).toContain("send_whatsapp_image");
    expect(actions).not.toContain("send_whatsapp_message");
    // Referentially the original list when disabled.
    expect(getActionCategories(false)).toBe(ACTION_CATEGORIES);
  });

  it("ON: collapses the seven sends into send_whatsapp_message", () => {
    const actions = comunicacao(true);
    expect(actions).toContain("send_whatsapp_message");
    for (const legacy of [
      "send_whatsapp",
      "send_whatsapp_audio",
      "send_whatsapp_image",
      "send_whatsapp_video",
      "send_whatsapp_sticker",
      "send_whatsapp_menu",
      "send_whatsapp_pix_button",
    ]) {
      expect(actions).not.toContain(legacy);
    }
  });

  it("ON: keeps the non-collapsed comms (Meta template, Meta message, semi-auto)", () => {
    const actions = comunicacao(true);
    expect(actions).toContain("send_whatsapp_template");
    expect(actions).toContain("send_meta_message");
    expect(actions).toContain("send_semi_automatic");
  });

  it("ON: leaves non-Comunicação categories untouched", () => {
    const off = getActionCategories(false);
    const on = getActionCategories(true);
    const lead = (cats: typeof off) => cats.find((c) => c.label === "Lead");
    expect(lead(on)).toEqual(lead(off));
  });
});
