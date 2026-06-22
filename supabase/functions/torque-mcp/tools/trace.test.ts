import { assertEquals } from "@std/assert";
import { mergeTimeline, type TimelineEvent } from "./trace.ts";

Deno.test("mergeTimeline — flattens sources sorted newest-first", () => {
  const leadHistory: TimelineEvent[] = [
    { source: "lead_history", at: "2026-01-02T00:00:00Z", kind: "note", detail: {} },
  ];
  const audit: TimelineEvent[] = [
    { source: "audit_log", at: "2026-01-03T00:00:00Z", kind: "UPDATE", detail: {} },
    { source: "audit_log", at: "2026-01-01T00:00:00Z", kind: "INSERT", detail: {} },
  ];
  const out = mergeTimeline([leadHistory, audit]);
  assertEquals(out.map((e) => e.at), [
    "2026-01-03T00:00:00Z",
    "2026-01-02T00:00:00Z",
    "2026-01-01T00:00:00Z",
  ]);
});

Deno.test("mergeTimeline — drops events without a timestamp", () => {
  const out = mergeTimeline([
    [{ source: "x", at: "2026-01-01T00:00:00Z", kind: "k", detail: {} }],
    [{ source: "y", at: null as unknown as string, kind: "k", detail: {} }],
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].source, "x");
});
