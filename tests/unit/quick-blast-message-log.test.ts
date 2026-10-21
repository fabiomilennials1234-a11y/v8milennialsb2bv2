// @vitest-environment node
/**
 * buildBlastLogRows — per-lead conversation logging for Quick Blast (Slice 5).
 *
 * Each blasted recipient becomes an outbound channel_messages row so the rep
 * sees what was sent and the Copilot has context if the lead replies. Pure:
 * turns recipients into insert rows. Written optimistically at enqueue
 * (sent timestamps are eventual, reconciled by mass-send-status).
 */

import { describe, it, expect } from "vitest";

const { buildBlastLogRows } = await import(
  "../../supabase/functions/_shared/quick-blast/message-log.ts"
);

describe("buildBlastLogRows", () => {
  const base = { orgId: "org-1", userId: "user-1", senderJobId: "job-1" };

  it("maps text recipients to outbound whatsapp rows", () => {
    const rows = buildBlastLogRows({
      ...base,
      recipients: [
        { number: "5511999990001", text: "Oi Ana", leadId: "a" },
        { number: "5511999990002", text: "Oi Bia", leadId: "b" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      organization_id: "org-1",
      lead_id: "a",
      direction: "outbound",
      channel: "whatsapp",
      content: "Oi Ana",
    });
    expect(rows[0].metadata).toMatchObject({ source: "quick_blast", sender_job_id: "job-1" });
  });

  it("uses the caption as content for image recipients", () => {
    const rows = buildBlastLogRows({
      ...base,
      recipients: [{ number: "5511999990001", leadId: "a", type: "image", file: "https://cdn/x.jpg", caption: "Promo Ana" }],
    });
    expect(rows[0].content).toBe("Promo Ana");
    expect(rows[0].metadata).toMatchObject({ source: "quick_blast", image_url: "https://cdn/x.jpg" });
  });

  it("records the attachment as media_url/media_type, keeping image_url for images", () => {
    const rows = buildBlastLogRows({
      ...base,
      recipients: [{ number: "5511999990001", leadId: "a", type: "image", file: "https://cdn/x.jpg", caption: "Promo" }],
    });
    expect(rows[0].metadata).toMatchObject({
      image_url: "https://cdn/x.jpg",
      media_url: "https://cdn/x.jpg",
      media_type: "image",
    });
  });

  it("logs a document recipient with media_url/media_type/media_name — never as image_url", () => {
    const rows = buildBlastLogRows({
      ...base,
      recipients: [
        {
          number: "5511999990001",
          leadId: "a",
          type: "document",
          file: "https://cdn/catalogo.pdf",
          docName: "Catálogo.pdf",
          caption: "Segue o catálogo",
        },
      ],
    });
    expect(rows[0].content).toBe("Segue o catálogo");
    expect(rows[0].metadata).toMatchObject({
      source: "quick_blast",
      media_url: "https://cdn/catalogo.pdf",
      media_type: "document",
      media_name: "Catálogo.pdf",
    });
    expect(rows[0].metadata).not.toHaveProperty("image_url");
  });

  it("skips recipients without a leadId (cannot attach to a conversation)", () => {
    const rows = buildBlastLogRows({
      ...base,
      recipients: [
        { number: "5511999990001", text: "x", leadId: "a" },
        { number: "5511999990002", text: "y", leadId: "" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].lead_id).toBe("a");
  });

  it("returns an empty array for no recipients", () => {
    expect(buildBlastLogRows({ ...base, recipients: [] })).toEqual([]);
  });
});
