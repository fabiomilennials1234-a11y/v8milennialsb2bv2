/**
 * Regressão: o chat "não carregava todas as mensagens".
 *
 * Causa: a mesma pessoa tem mensagens gravadas em >1 formato de `phone_number`
 * (webhook inbound = `55…`; primeiro outbound = `lead.phone` cru, muitas vezes
 * SEM `55`). A query antiga fazia `.eq("phone_number", phoneNumber)` — match
 * EXATO — e devolvia só a metade da thread que casava o formato passado.
 *
 * Fix: filtrar por `normalized_phone` (identidade única). Estes testes travam
 * o filtro pra garantir que qualquer formato de entrada vira o MESMO valor
 * normalizado — a thread inteira volta independentemente do formato de origem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Builder supabase inspecionável — cadeia: from().select().eq().eq().eq().order()
const orderResult: { data: unknown[]; error: unknown } = { data: [], error: null };
const builder = {
  select: vi.fn(() => builder),
  eq: vi.fn(() => builder),
  order: vi.fn(() => Promise.resolve(orderResult)),
};
const fromMock = vi.fn((..._args: unknown[]) => builder);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...a: unknown[]) => fromMock(...a) },
}));

import { fetchConversationMessages, WHATSAPP_MESSAGE_COLUMNS } from "./whatsappMessagesQuery";

beforeEach(() => {
  orderResult.data = [];
  orderResult.error = null;
  fromMock.mockClear();
  builder.select.mockClear();
  builder.eq.mockClear();
  builder.order.mockClear();
});

/** Todos os `.eq(col, val)` chamados, como pares [col, val]. */
function eqCalls(): Array<[string, unknown]> {
  return builder.eq.mock.calls as Array<[string, unknown]>;
}

describe("fetchConversationMessages — filtro por telefone normalizado", () => {
  it("filtra por normalized_phone e NUNCA por phone_number cru", async () => {
    await fetchConversationMessages({
      organizationId: "org-1",
      instanceId: "inst-1",
      phoneNumber: "5515992486581",
    });

    expect(fromMock).toHaveBeenCalledWith("whatsapp_messages");
    expect(builder.select).toHaveBeenCalledWith(WHATSAPP_MESSAGE_COLUMNS);

    const cols = eqCalls().map(([c]) => c);
    expect(cols).toContain("normalized_phone");
    // O bug era filtrar por phone_number exato — garante que não volta.
    expect(cols).not.toContain("phone_number");
    expect(eqCalls()).toContainEqual(["organization_id", "org-1"]);
    expect(eqCalls()).toContainEqual(["instance_id", "inst-1"]);
    expect(builder.order).toHaveBeenCalledWith("timestamp", { ascending: true });
  });

  it("formatos divergentes (com/sem 55, com/sem 9º dígito) colapsam no MESMO filtro", async () => {
    const formats = [
      "5515992486581", // 55 + DDD + 9 + número (webhook)
      "15992486581", // sem 55 (lead.phone cru)
      "+55 (15) 99248-6581", // formatado
      "1592486581", // 10 dígitos, sem o 9º → normaliza pra 15992486581
    ];

    const normalizedValues: unknown[] = [];
    for (const phone of formats) {
      builder.eq.mockClear();
      await fetchConversationMessages({
        organizationId: "org-1",
        instanceId: "inst-1",
        phoneNumber: phone,
      });
      const normEq = eqCalls().find(([c]) => c === "normalized_phone");
      normalizedValues.push(normEq?.[1]);
    }

    // Todos os formatos precisam produzir o mesmo valor de filtro.
    expect(new Set(normalizedValues).size).toBe(1);
    expect(normalizedValues[0]).toBe("15992486581");
  });

  it("telefone vazio/inválido não consulta e devolve []", async () => {
    const res = await fetchConversationMessages({
      organizationId: "org-1",
      instanceId: "inst-1",
      phoneNumber: "   ",
    });
    expect(res).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("propaga erro do supabase", async () => {
    orderResult.error = new Error("boom");
    await expect(
      fetchConversationMessages({
        organizationId: "org-1",
        instanceId: "inst-1",
        phoneNumber: "5515992486581",
      }),
    ).rejects.toThrow("boom");
  });
});
