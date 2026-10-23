/**
 * `lid → nome` das menções de grupo (Chamado 6885e65d): o que a thread já tem
 * resolve sem rede; só o LID que falta vai ao banco — escopado por org,
 * instância e grupo, `limit(1)`. Fixtures fictícias.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../../../../../tests/helpers/hook-test-utils";
import type { WhatsAppMessage } from "./types";

const result: { data: Array<{ push_name: string | null }>; error: unknown } = { data: [], error: null };
const builder = {
  select: vi.fn(() => builder),
  eq: vi.fn(() => builder),
  not: vi.fn(() => builder),
  order: vi.fn(() => builder),
  limit: vi.fn(() => builder),
  then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
};
const fromMock = vi.fn((..._args: unknown[]) => builder);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...a: unknown[]) => fromMock(...a) },
}));

import { useGroupMentionNames } from "./useGroupMentionNames";

const ANA = "11111111111111@lid";
const BETO = "222222222222222@lid";

function msg(over: Partial<Record<string, unknown>>): WhatsAppMessage {
  return {
    id: `id-${Math.random()}`,
    organization_id: "org-1",
    instance_id: "inst-1",
    message_id: "wamid",
    remote_jid: "120000000000000000@g.us",
    phone_number: "120000000000000000",
    direction: "incoming",
    message_type: "text",
    content: "oi",
    media_url: null,
    push_name: null,
    is_group: true,
    status: "received",
    lead_id: null,
    timestamp: "2026-10-15T13:00:00.000Z",
    created_at: "2026-10-15T13:00:00.000Z",
    sent_by_ai: false,
    ...over,
  } as unknown as WhatsAppMessage;
}

beforeEach(() => {
  result.data = [];
  fromMock.mockClear();
  for (const fn of [builder.select, builder.eq, builder.not, builder.order, builder.limit]) fn.mockClear();
});

describe("useGroupMentionNames", () => {
  it("resolve pelo remetente já carregado, sem ir ao banco", () => {
    const messages = [
      msg({ uazapi_sender_lid: ANA, push_name: "Ana Teste" }),
      msg({ content: "@11111111111111 ok", uazapi_mentioned_jids: [ANA] }),
    ];
    const { result: hook } = renderHook(() => useGroupMentionNames(messages), { wrapper: createWrapper() });
    expect(hook.current.get(ANA)).toBe("Ana Teste");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("LID citado que não escreveu na thread carregada: uma consulta escopada, limit(1)", async () => {
    result.data = [{ push_name: " Beto Teste " }];
    const messages = [msg({ content: "@222222222222222 ok", uazapi_mentioned_jids: [BETO] })];
    const { result: hook } = renderHook(() => useGroupMentionNames(messages), { wrapper: createWrapper() });

    await waitFor(() => expect(hook.current.get(BETO)).toBe("Beto Teste"));
    expect(fromMock).toHaveBeenCalledWith("whatsapp_messages");
    expect(builder.eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["organization_id", "org-1"],
        ["instance_id", "inst-1"],
        ["remote_jid", "120000000000000000@g.us"],
        ["raw_payload->>sender_lid", BETO],
      ]),
    );
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  it("conversa 1:1 não consulta nada e devolve mapa vazio", () => {
    const messages = [
      msg({ is_group: false, remote_jid: "5548999990000@s.whatsapp.net", uazapi_mentioned_jids: [BETO] }),
    ];
    const { result: hook } = renderHook(() => useGroupMentionNames(messages), { wrapper: createWrapper() });
    expect(hook.current.size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
