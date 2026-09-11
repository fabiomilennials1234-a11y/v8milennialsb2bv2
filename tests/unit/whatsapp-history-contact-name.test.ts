import { describe, it, expect, vi } from "vitest";
import { UazapiClient } from "../../supabase/functions/_shared/uazapi-client";
import { historyContactName } from "../../supabase/functions/_shared/whatsapp-contact-name";
const jid = "5548999998888@s.whatsapp.net";
function client() {
  const api = new UazapiClient({ baseUrl: "https://example.invalid", token: "fixture" });
  const request = vi.spyOn(api as unknown as { request: (...args: unknown[]) => Promise<unknown> }, "request");
  return { api, request };
}
describe("importação prioriza agenda do vendedor", () => {
  it("leva o nome da lista de chats até a mensagem importada sem nova consulta", async () => {
    const { api, request } = client();
    request.mockResolvedValueOnce([{ wa_chatid: jid, wa_contactName: " João Mercado ", wa_name: "João" }]);
    expect((await api.listChats())[0].name).toBe("João Mercado");
    request.mockResolvedValueOnce([{ id: "m1", pushName: "João" }]);
    const result = await api.historySync({ number: jid });
    expect(historyContactName(result.messages[0] as Record<string, unknown>, false)).toBe("João Mercado");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("busca a agenda por JID ao importar uma conversa e reutiliza nas páginas", async () => {
    const { api, request } = client();
    request.mockResolvedValueOnce([{ id: "m1", pushName: "Perfil" }])
      .mockResolvedValueOnce({ chats: [{ wa_chatid: jid, wa_contactName: "Cliente salvo" }] })
      .mockResolvedValueOnce([{ id: "m2", pushName: "Perfil" }]);
    const first = await api.historySync({ number: jid, limit: 1 });
    const second = await api.historySync({ number: jid, cursor: first.nextCursor });
    expect(historyContactName(second.messages[0] as Record<string, unknown>, false)).toBe("Cliente salvo");
    expect(request.mock.calls[1][2]).toMatchObject({ wa_chatid: jid });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("ignora nome vazio e nunca usa perfil de mensagem enviada como nome do cliente", () => {
    expect(historyContactName({ wa_contactName: " ", pushName: "Perfil" }, false)).toBe("Perfil");
    expect(historyContactName({ pushName: "Vendedor" }, true)).toBeNull();
    expect(historyContactName({ wa_contactName: "Cliente", pushName: "Vendedor" }, true)).toBe("Cliente");
  });
  it("falha na agenda não impede histórico e não mistura contas", async () => {
    const { api, request } = client();
    request.mockResolvedValueOnce([{ id: "m1", pushName: "Perfil" }]).mockRejectedValueOnce(new Error("unavailable"));
    expect((await api.historySync({ number: jid })).messages).toEqual([{ id: "m1", pushName: "Perfil" }]);
    const other = client();
    other.request.mockResolvedValueOnce([{ id: "m1" }]).mockResolvedValueOnce([{ wa_chatid: jid, wa_contactName: "Outra agenda" }]);
    expect(historyContactName((await other.api.historySync({ number: jid })).messages[0] as Record<string, unknown>, false)).toBe("Outra agenda");
  });
  it("recusa resultado de contato diferente do solicitado", async () => {
    const { api, request } = client();
    request.mockResolvedValueOnce([{ pushName: "Perfil" }]).mockResolvedValueOnce([{ wa_chatid: "outro", wa_contactName: "Errado" }]);
    expect(historyContactName((await api.historySync({ number: jid })).messages[0] as Record<string, unknown>, false)).toBe("Perfil");
  });
});
