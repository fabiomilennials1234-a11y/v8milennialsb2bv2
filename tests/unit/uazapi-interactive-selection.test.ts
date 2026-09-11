import { describe, expect, it } from "vitest";
import { extractInteractiveSelection } from "../../supabase/functions/whatsapp-webhook/interactive-reply";

describe("Uazapi real list response contract", () => {
  it("shows the selected title instead of the routing id", () => {
    expect(extractInteractiveSelection({ messageType: "ListResponseMessage", text: "", buttonOrListid: "route-2", content: { title: "Concluir", singleSelectReply: { selectedRowID: "route-2" } } })).toBe("Concluir");
  });
  it("does not treat a regular message title as a selection", () => {
    expect(extractInteractiveSelection({ content: { title: "Unrelated title" } })).toBeNull();
  });
  it("retains the id fallback when the display title is blank", () => {
    expect(extractInteractiveSelection({ content: { title: " ", singleSelectReply: { selectedRowID: "route-2" } }, buttonOrListid: "route-2" })).toBe("route-2");
  });
});
