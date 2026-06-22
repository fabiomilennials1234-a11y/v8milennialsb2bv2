import { assertEquals } from "@std/assert";
import { threadSummary } from "./conversation.ts";

Deno.test("threadSummary — counts directions and flags awaiting reply", () => {
  const msgs = [
    { direction: "incoming", timestamp: "2026-06-22T10:00:00Z" },
    { direction: "outgoing", timestamp: "2026-06-22T10:05:00Z" },
  ];
  assertEquals(threadSummary(msgs), {
    total: 2,
    inbound: 1,
    outbound: 1,
    last_at: "2026-06-22T10:05:00Z",
    awaiting_reply: true, // last message was ours → lead hasn't replied
  });
});

Deno.test("threadSummary — empty thread", () => {
  assertEquals(threadSummary([]), {
    total: 0,
    inbound: 0,
    outbound: 0,
    last_at: null,
    awaiting_reply: false,
  });
});

Deno.test("threadSummary — lead replied last → not awaiting", () => {
  const msgs = [
    { direction: "outgoing", timestamp: "2026-06-22T10:00:00Z" },
    { direction: "incoming", timestamp: "2026-06-22T10:05:00Z" },
  ];
  assertEquals(threadSummary(msgs).awaiting_reply, false);
});
