import { describe, expect, it, vi } from "vitest";
import { runConversationBatch, selectableConversations } from "./conversationBatch";
import { RIOFIX_ORG_ID } from "./negocioNoChat";
import { batchContact } from "../../../../tests/helpers/conversationBatch";

describe("conversation batch", () => {
  it("applies only to selected rows and preserves the same phone in different boxes", async () => {
    const a = batchContact("5511999999999");
    const b = batchContact(a.phone_number, "box-b");
    const execute = vi.fn(async () => {});
    const result = await runConversationBatch(RIOFIX_ORG_ID, "archive", [a, b, a], false, execute);
    expect(execute.mock.calls).toEqual([[a], [b]]);
    expect(result.succeeded).toEqual([a, b]);
  });
  it("denies other orgs and deletion by members before any request", async () => {
    const execute = vi.fn();
    await expect(runConversationBatch("other", "archive", [batchContact("1")], true, execute)).rejects.toThrow();
    await expect(runConversationBatch(RIOFIX_ORG_ID, "delete", [batchContact("1")], false, execute)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it("limits concurrency and reports failures separately for retry", async () => {
    let active = 0, maximum = 0;
    const contacts = Array.from({ length: 11 }, (_, i) => batchContact(String(i)));
    const result = await runConversationBatch(RIOFIX_ORG_ID, "archive", contacts, false, async c => {
      active++; maximum = Math.max(active, maximum);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (c.phone_number === "2") throw new Error("network");
    });
    expect(maximum).toBe(3);
    expect(result.succeeded).toHaveLength(10);
    expect(result.failed).toEqual([contacts[2]]);
  });
  it("excludes unknown boxes", () => {
    expect(selectableConversations([batchContact("1"), { ...batchContact("2"), instance_id: null }])).toEqual([batchContact("1")]);
  });
});
