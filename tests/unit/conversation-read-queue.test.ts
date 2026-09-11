import { it, expect } from "vitest";
import { queueConversationReadChange } from "../../src/modules/communication/lib/conversationReadQueue";
it("orders unread then reopen without blocking another account", async () => {
  const events: string[] = [];
  let release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  const unread = queueConversationReadChange("box:phone", async () => { await slow; events.push("unread"); });
  const read = queueConversationReadChange("box:phone", async () => { events.push("read"); });
  await queueConversationReadChange("other:phone", async () => { events.push("other"); });
  expect(events).toEqual(["other"]);
  release(); await Promise.all([unread, read]);
  expect(events).toEqual(["other", "unread", "read"]);
});
it("a failed write does not poison future actions", async () => {
  await expect(queueConversationReadChange("failed", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  await expect(queueConversationReadChange("failed", async () => "read")).resolves.toBe("read");
});
