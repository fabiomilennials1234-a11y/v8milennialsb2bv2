// @vitest-environment node
/**
 * humanizeBatch — per-recipient mass-send variation (anti-ban Onda 0 QW6).
 *
 * The wrapper's contract, not the LLM: distinct variant per recipient, strict
 * fail-open on rewrite failure, wall-clock budget that degrades variation
 * (never the send), caption fallback for media items, order/field preservation.
 */
import { describe, it, expect, vi } from "vitest";

const { humanizeBatch } = await import(
  "../../supabase/functions/_shared/humanize-batch.ts"
);

const msg = (n: number, text?: string, caption?: string) => ({
  number: `55119999${String(n).padStart(4, "0")}`,
  type: caption ? ("image" as const) : ("text" as const),
  text,
  caption,
});

describe("humanizeBatch", () => {
  it("gives each recipient its own variant (kills the byte-identical fan-out)", async () => {
    let calls = 0;
    const humanize = vi.fn(async (t: string) => `${t} #v${++calls}`);
    const out = await humanizeBatch([msg(1, "Oi, tudo bem?"), msg(2, "Oi, tudo bem?")], { humanize });

    expect(out[0].text).not.toBe(out[1].text);
    expect(out[0].text).toContain("Oi, tudo bem?");
    expect(out[1].text).toContain("Oi, tudo bem?");
    expect(humanize).toHaveBeenCalledTimes(2);
  });

  it("fails open: a throwing humanizer keeps the original text and the batch completes", async () => {
    const humanize = vi.fn(async (t: string) => {
      if (t.includes("boom")) throw new Error("LLM down");
      return t + " ✨";
    });
    const out = await humanizeBatch([msg(1, "boom msg"), msg(2, "ok msg")], { humanize });

    expect(out[0].text).toBe("boom msg"); // original preserved
    expect(out[1].text).toBe("ok msg ✨");
  });

  it("fails open on empty/garbage rewrites", async () => {
    const humanize = vi.fn(async () => "   ");
    const out = await humanizeBatch([msg(1, "original")], { humanize });
    expect(out[0].text).toBe("original");
  });

  it("stops rewriting once the budget is spent — remaining items keep the original", async () => {
    let t = 0;
    const now = () => t;
    const humanize = vi.fn(async (text: string) => {
      t += 100; // each rewrite "costs" 100ms
      return text + " *";
    });
    const items = Array.from({ length: 10 }, (_, i) => msg(i, `m${i}`));
    const out = await humanizeBatch(items, { humanize, now, budgetMs: 250, poolSize: 1 });

    const rewritten = out.filter((m) => m.text!.endsWith("*")).length;
    expect(rewritten).toBeGreaterThan(0);
    expect(rewritten).toBeLessThan(10); // budget cut it short
    // nothing dropped — every recipient still present, in order, with text
    expect(out).toHaveLength(10);
    out.forEach((m, i) => expect(m.text).toContain(`m${i}`));
  });

  it("humanizes the caption for media items without a text body", async () => {
    const humanize = vi.fn(async (t: string) => t + " (var)");
    const out = await humanizeBatch([msg(1, undefined, "confira o catálogo")], { humanize });
    expect(out[0].caption).toBe("confira o catálogo (var)");
    expect(out[0].text).toBeUndefined();
  });

  it("skips items with no message content and preserves every other field", async () => {
    const humanize = vi.fn(async (t: string) => t + "!");
    const bare = { number: "5511", type: "image" as const, text: undefined, caption: undefined, file: "https://x/y.png" };
    const out = await humanizeBatch([bare], { humanize });
    expect(humanize).not.toHaveBeenCalled();
    expect(out[0]).toEqual(bare);
  });
});
