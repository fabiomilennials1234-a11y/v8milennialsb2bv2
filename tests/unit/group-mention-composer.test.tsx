import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockFunctionsInvoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  ["select", "eq", "in", "is", "gte", "order", "limit", "upsert", "abortSignal"].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { metadata: {} }, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.then = (res: any, rej: any) => Promise.resolve({ data: [], error: null }).then(res, rej);
  return {
    supabase: {
      from: vi.fn().mockReturnValue(chain),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      functions: { invoke: (...args: any[]) => mockFunctionsInvoke(...args) },
    },
  };
});
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t", role: "admin", user_id: "u1" } }),
  isVirtualTeamMember: () => false,
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import {
  applyMention,
  buildMentionOptions,
  deriveMentions,
  detectMentionTrigger,
  parseGroupParticipants,
  MAX_MENTIONS,
  type GroupParticipant,
} from "@/modules/communication/lib/groupMentionComposer";
import { MentionPopover } from "@/modules/communication/components/chat/composer/MentionPopover";
import { groupParticipantsQueryKey } from "@/modules/communication/hooks/chat/useGroupParticipants";
import { useSendWhatsAppMessage, useSendWhatsAppMedia } from "@/modules/communication/hooks/chat/useWhatsAppSend";

const A = "5548999990001";
const B = "5548999990002";
const PARTICIPANTS: GroupParticipant[] = [
  { phone: B, lid: null, name: "Bruno Souza", isAdmin: true },
  { phone: A, lid: "111@lid", name: "Ana Júlia", isAdmin: false },
  { phone: null, lid: "222@lid", name: "Só LID", isAdmin: false },
  { phone: "5548999990003", lid: null, name: null, isAdmin: false },
];

describe("detectMentionTrigger", () => {
  it("opens at start of text and after whitespace", () => {
    expect(detectMentionTrigger("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(detectMentionTrigger("oi @an", 6)).toEqual({ start: 3, end: 6, query: "an" });
    expect(detectMentionTrigger("oi\n@an", 6)).toMatchObject({ start: 3, query: "an" });
    expect(detectMentionTrigger("(@an", 4)).toMatchObject({ start: 1, query: "an" });
  });
  it("does not open inside a word or e-mail (WORD_CHAR rule)", () => {
    expect(detectMentionTrigger("ana@email", 9)).toBeNull();
    expect(detectMentionTrigger("x_@a", 4)).toBeNull();
    expect(detectMentionTrigger("@@a", 3)).toBeNull();
  });
  it("closes once the term has a space or the caret leaves it", () => {
    expect(detectMentionTrigger("@ana souza", 10)).toBeNull();
    expect(detectMentionTrigger("oi @an", 2)).toBeNull();
    expect(detectMentionTrigger("sem arroba", 5)).toBeNull();
    expect(detectMentionTrigger("", 0)).toBeNull();
  });
});

describe("buildMentionOptions", () => {
  it("lists Todos first, then participants with phone, named first and sorted", () => {
    const opts = buildMentionOptions(PARTICIPANTS, "");
    expect(opts.map((o) => o.token)).toEqual(["todos", A, B, "5548999990003"]);
  });
  it("never lists LID-only participants", () => {
    expect(buildMentionOptions(PARTICIPANTS, "lid").some((o) => o.kind === "participant")).toBe(false);
  });
  it("filters by name ignoring accents and case, and by number", () => {
    expect(buildMentionOptions(PARTICIPANTS, "julia").map((o) => o.token)).toEqual([A]);
    expect(buildMentionOptions(PARTICIPANTS, "0002").map((o) => o.token)).toEqual([B]);
    expect(buildMentionOptions(PARTICIPANTS, "to").map((o) => o.token)).toEqual(["todos"]);
    expect(buildMentionOptions(PARTICIPANTS, "zzz")).toEqual([]);
  });
  it("still offers Todos while participants are unknown", () => {
    expect(buildMentionOptions(undefined, "").map((o) => o.kind)).toEqual(["all"]);
  });
});

describe("applyMention", () => {
  it("replaces the @term and leaves the caret after a trailing space", () => {
    const text = "oi @an tudo bem";
    const r = applyMention(text, { start: 3, end: 6, query: "an" }, A);
    expect(r.text).toBe(`oi @${A} tudo bem`);
    expect(r.caret).toBe(`oi @${A} `.length);
  });
  it("adds a space at end of text", () => {
    expect(applyMention("@to", { start: 0, end: 3, query: "to" }, "todos")).toEqual({ text: "@todos ", caret: 7 });
  });
});

describe("deriveMentions (from the final text)", () => {
  it("keeps only known participants still present in the text", () => {
    expect(deriveMentions(`oi @${A} e @${B} e @5548111112222`, [A, B])).toEqual([A, B]);
    expect(deriveMentions(`oi @${A}`, [B])).toEqual([]);
  });
  it("ignores e-mail-like, prefixes of longer numbers and dupes", () => {
    expect(deriveMentions(`x@${A} @${A}9 @${A} @${A}`, [A])).toEqual([A]);
  });
  it("@todos needs no mentions list and empty inputs are safe", () => {
    expect(deriveMentions("@todos bom dia", [A])).toEqual([]);
    expect(deriveMentions(undefined, [A])).toEqual([]);
    expect(deriveMentions(`@${A}`, [])).toEqual([]);
  });
  it("caps at MAX_MENTIONS", () => {
    const phones = Array.from({ length: 70 }, (_, i) => `55489999${String(i).padStart(5, "0")}`);
    expect(deriveMentions(phones.map((p) => `@${p}`).join(" "), phones)).toHaveLength(MAX_MENTIONS);
  });
});

describe("parseGroupParticipants", () => {
  it("accepts only participant-shaped items", () => {
    expect(parseGroupParticipants([{ phone: A, lid: null, name: " Ana ", isAdmin: true }, { phone: "x" }, null, "a"]))
      .toEqual([{ phone: A, lid: null, name: "Ana", isAdmin: true }]);
    expect(parseGroupParticipants({ not: "array" })).toEqual([]);
  });
});

describe("MentionPopover", () => {
  const setup = (query = "") => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<MentionPopover query={query} participants={PARTICIPANTS} onSelect={onSelect} onClose={onClose} />);
    return { onSelect, onClose };
  };

  it("shows Todos + participants, hides LID-only", () => {
    setup();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Todos");
    expect(options).toHaveLength(4);
    expect(screen.queryByText("Só LID")).toBeNull();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("navigates with arrows and selects with Enter", () => {
    const { onSelect } = setup();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(A);
  });

  it("Tab selects the highlighted item; first is Todos", () => {
    const { onSelect } = setup();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(onSelect).toHaveBeenCalledWith("todos");
  });

  it("Esc closes", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("filters by query and selects by click", () => {
    const { onSelect } = setup("bru");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByText("Bruno Souza"));
    expect(onSelect).toHaveBeenCalledWith(B);
  });

  it("renders nothing and does not capture Enter when nothing matches", () => {
    const { onSelect } = setup("zzz");
    expect(screen.queryByRole("listbox")).toBeNull();
    const ev = new KeyboardEvent("keydown", { key: "Enter", cancelable: true, bubbles: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("send hooks derive mentions from the final text", () => {
  const GROUP_ID = "120363404701403742";
  const GROUP_JID = `${GROUP_ID}@g.us`;
  let qc: QueryClient;
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  const proxyBody = () => mockFunctionsInvoke.mock.calls.find(([fn]) => fn === "whatsapp-api-proxy")?.[1].body;

  beforeEach(() => {
    mockFunctionsInvoke.mockReset().mockResolvedValue({ data: { ok: true, result: { message_id: "M1", status: "sent" } }, error: null });
    qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });

  it("group text: sends only the known numbers present in the text", async () => {
    qc.setQueryData(groupParticipantsQueryKey("inst-g1", GROUP_JID), PARTICIPANTS);
    const { result } = renderHook(() => useSendWhatsAppMessage(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ phoneNumber: GROUP_ID, isGroup: true, message: `oi @${A} e @5548111112222`, instanceName: "x", instanceId: "inst-g1" });
    });
    expect(proxyBody().payload).toEqual({ number: GROUP_JID, text: `oi @${A} e @5548111112222`, mentions: [A] });
  });

  it("group text without mention (or only @todos): payload unchanged", async () => {
    qc.setQueryData(groupParticipantsQueryKey("inst-g2", GROUP_JID), PARTICIPANTS);
    const { result } = renderHook(() => useSendWhatsAppMessage(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ phoneNumber: GROUP_ID, isGroup: true, message: "@todos bom dia", instanceName: "x", instanceId: "inst-g2" });
    });
    expect(proxyBody().payload).toEqual({ number: GROUP_JID, text: "@todos bom dia" });
  });

  it("1:1 conversation never sends mentions", async () => {
    qc.setQueryData(groupParticipantsQueryKey("inst-g3", GROUP_JID), PARTICIPANTS);
    const { result } = renderHook(() => useSendWhatsAppMessage(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ phoneNumber: "48999990001", message: `oi @${A}`, instanceName: "x", instanceId: "inst-g3" });
    });
    expect(proxyBody().payload).not.toHaveProperty("mentions");
  });

  it("group media caption carries mentions", async () => {
    qc.setQueryData(groupParticipantsQueryKey("inst-g4", GROUP_JID), PARTICIPANTS);
    const { result } = renderHook(() => useSendWhatsAppMedia(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        phoneNumber: GROUP_ID, isGroup: true, instanceName: "x", instanceId: "inst-g4",
        mediaType: "image", media: "https://x.test/a.png", caption: `olha @${B}`,
      });
    });
    expect(proxyBody().action).toBe("sendMedia");
    expect(proxyBody().payload.mentions).toEqual([B]);
  });
});
