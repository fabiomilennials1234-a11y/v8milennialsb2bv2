import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { sendOwnedWhatsApp } from "./owned-whatsapp.ts";

Deno.test("canal próprio — envia somente para a configuração injetada da plataforma", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = (input, init) => {
    requests.push({ url: String(input), init });
    return Promise.resolve(new Response(null, { status: 204 }));
  };

  const result = await sendOwnedWhatsApp(
    "alerta",
    {
      baseUrl: "https://platform.uazapi.test/",
      token: "platform-token",
      groupJid: "5511999999999@g.us",
    },
    fetchImpl,
  );

  assertEquals(result, { ok: true });
  assertEquals(requests.length, 1);
  assertEquals(requests[0].url, "https://platform.uazapi.test/send/text");
  assertEquals(requests[0].init?.headers, {
    "Content-Type": "application/json",
    token: "platform-token",
  });
  assertEquals(JSON.parse(String(requests[0].init?.body)), {
    number: "5511999999999@g.us",
    text: "alerta",
  });
});

Deno.test("canal próprio — falha fechado sem segredos da plataforma", async () => {
  let called = false;
  const fetchImpl: typeof fetch = () => {
    called = true;
    return Promise.resolve(new Response(null, { status: 204 }));
  };

  const result = await sendOwnedWhatsApp("alerta", null, fetchImpl);

  assertEquals(result, { ok: false, error: "secrets do canal próprio ausentes" });
  assertEquals(called, false);
});
