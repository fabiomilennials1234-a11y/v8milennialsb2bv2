/**
 * whatsapp-media-retention — pure helper unit tests.
 *
 * Covers:
 *  - path→message correlation (inbound by message_id, outbound by media_url LIKE)
 *  - scope guard: only `whatsapp-media/` paths are ever in scope
 *  - LIKE escaping for outbound path matching
 *  - dry-run summary aggregation (no side effects)
 */
import { describe, it, expect } from "vitest";
import {
  correlatePathToMessage,
  isWhatsAppMediaPath,
  escapeLike,
  summarizeCandidates,
  WHATSAPP_MEDIA_PREFIX,
  type MediaCandidate,
} from "../../supabase/functions/whatsapp-media-retention/media-paths";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";

describe("isWhatsAppMediaPath — scope guard", () => {
  it("accepts objects under the whatsapp-media/ prefix", () => {
    expect(isWhatsAppMediaPath(`${WHATSAPP_MEDIA_PREFIX}${ORG}/abc.jpg`)).toBe(true);
    expect(isWhatsAppMediaPath(`whatsapp-media/${ORG}/uuid/file.pdf`)).toBe(true);
  });

  it("REJECTS every other prefix in the shared bucket", () => {
    // These live in the same public `media` bucket and must never be deleted.
    expect(isWhatsAppMediaPath("message-templates/x.png")).toBe(false);
    expect(isWhatsAppMediaPath("campaigns/y.jpg")).toBe(false);
    expect(isWhatsAppMediaPath("avatars/z.webp")).toBe(false);
    expect(isWhatsAppMediaPath("copilot-audio/a.ogg")).toBe(false);
    // Look-alike prefix without the trailing slash must not match.
    expect(isWhatsAppMediaPath("whatsapp-media-backup/x.jpg")).toBe(false);
    expect(isWhatsAppMediaPath(null)).toBe(false);
    expect(isWhatsAppMediaPath(undefined)).toBe(false);
    expect(isWhatsAppMediaPath("")).toBe(false);
  });
});

describe("correlatePathToMessage", () => {
  it("inbound (3-segment) → matches by extracted message_id + org", () => {
    const corr = correlatePathToMessage(`whatsapp-media/${ORG}/3EB0ABCDEF123456.jpg`);
    expect(corr).toEqual({
      kind: "inbound",
      orgId: ORG,
      messageId: "3EB0ABCDEF123456",
      path: `whatsapp-media/${ORG}/3EB0ABCDEF123456.jpg`,
    });
  });

  it("inbound strips only the trailing extension (message_id may contain dots)", () => {
    const corr = correlatePathToMessage(`whatsapp-media/${ORG}/wamid.HBg1.2.3.mp4`);
    expect(corr.kind).toBe("inbound");
    if (corr.kind === "inbound") expect(corr.messageId).toBe("wamid.HBg1.2.3");
  });

  it("outbound (4-segment) → matches by media_url LIKE (no message_id)", () => {
    const path = `whatsapp-media/${ORG}/9f1c-uuid/image_1699999999.png`;
    const corr = correlatePathToMessage(path);
    expect(corr).toEqual({ kind: "outbound", orgId: ORG, path });
  });

  it("non-whatsapp-media prefix → unknown (never actioned)", () => {
    expect(correlatePathToMessage("avatars/x.png").kind).toBe("unknown");
  });

  it("malformed (missing org) → unknown", () => {
    expect(correlatePathToMessage("whatsapp-media/").kind).toBe("unknown");
    expect(correlatePathToMessage("whatsapp-media/onlyorg").kind).toBe("unknown");
  });
});

describe("escapeLike", () => {
  it("escapes underscores so file names are matched literally, not as wildcards", () => {
    expect(escapeLike("image_1699.png")).toBe("image\\_1699.png");
  });

  it("escapes percent and backslash", () => {
    expect(escapeLike("a%b")).toBe("a\\%b");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });
});

describe("summarizeCandidates — dry-run aggregation", () => {
  it("counts files, sums bytes, and counts distinct orgs from the path", () => {
    const orgB = "11111111-1111-1111-1111-111111111111";
    const candidates: MediaCandidate[] = [
      { path: `whatsapp-media/${ORG}/a.jpg`, size_bytes: 100 },
      { path: `whatsapp-media/${ORG}/uuid/b.pdf`, size_bytes: 250 },
      { path: `whatsapp-media/${orgB}/c.mp4`, size_bytes: 400 },
    ];
    expect(summarizeCandidates(candidates)).toEqual({
      deleted_count: 3,
      freed_bytes_estimate: 750,
      orgs_affected: 2,
    });
  });

  it("is pure — returns zeros for an empty list", () => {
    expect(summarizeCandidates([])).toEqual({
      deleted_count: 0,
      freed_bytes_estimate: 0,
      orgs_affected: 0,
    });
  });

  it("tolerates non-numeric sizes without throwing", () => {
    const candidates = [
      { path: `whatsapp-media/${ORG}/a.jpg`, size_bytes: NaN as unknown as number },
    ];
    expect(summarizeCandidates(candidates).freed_bytes_estimate).toBe(0);
  });
});
