import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { sendMessage, _resetGatewayFlagCache } from "../../supabase/functions/_shared/message-gateway.ts";
import { UazapiClient } from "../../supabase/functions/_shared/uazapi-client.ts";

const instance = {
  id: "00000000-0000-4000-8000-000000000001",
  organization_id: "00000000-0000-4000-8000-000000000002",
  provider: "uazapi",
  instance_name: "button-test",
};

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  _resetGatewayFlagCache();
  UazapiClient._resetCircuitState();
  const env: Record<string, string> = {
    UAZAPI_BASE_URL: "https://uazapi.test",
    UAZAPI_ADMIN_TOKEN: "synthetic-admin-token",
  };
  vi.stubGlobal("Deno", { env: { get: (key: string) => env[key] } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetGatewayFlagCache();
  UazapiClient._resetCircuitState();
});

describe("Pergunta com botões — envio pelo gateway", () => {
  it.each([false, true])("devolve ID correlacionável do WhatsApp mesmo com falha de persistência=%s", async (persistFails) => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://uazapi.test" && url.pathname === "/send/menu") {
        return json({
          id: "internal-question-1", messageid: "whatsapp-question-1",
          status: "Pending", messageTimestamp: 1700000000123,
        });
      }
      if (url.origin !== "https://database.test") throw new Error(`Unexpected HTTP host: ${url.host}`);
      switch (url.pathname) {
        case "/rest/v1/organization_features": return json([{ enabled: true, expires_at: null }]);
        case "/rest/v1/whatsapp_instances": return json([instance]);
        case "/rest/v1/organizations": return json([{ whatsapp_provider_override: null }]);
        case "/rest/v1/rpc/get_uazapi_credentials": return json([{ uazapi_token: "synthetic-instance-token" }]);
        case "/rest/v1/rpc/check_rate_limit": return json(true);
        case "/rest/v1/whatsapp_messages":
          if (persistFails && init?.method === "POST") {
            return new Response(JSON.stringify({ message: "synthetic persistence failure" }), { status: 400 });
          }
          return json([]);
        default: throw new Error(`Unexpected database path: ${url.pathname}`);
      }
    }));
    const database = createClient("https://database.test", "synthetic-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await sendMessage(database, {
      organization_id: instance.organization_id, instance_id: instance.id,
      phone: "5511999999999", source: "workflow", message_type: "menu",
      content: "Escolha", track_id: "question-1",
      menu_options: { type: "button", choices: ["A|question-1:a"] },
    });

    expect(result).toMatchObject({
      success: !persistFails,
      message_id: "internal-question-1",
      provider_message_id: "internal-question-1",
      whatsapp_message_id: "whatsapp-question-1",
      ...(persistFails ? { error_code: "persist_failed" } : {}),
    });
  });

  it("preserva imagem fixa, opções e rastreamento até o HTTP da Uazapi", async () => {
    let menuBody: unknown;
    // Only external HTTP is simulated. Gateway, dispatch, factory, provider,
    // Uazapi client and Supabase client all execute their production code.
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://uazapi.test" && url.pathname === "/send/menu") {
        menuBody = JSON.parse(String(init?.body));
        return json({ id: "question-send-1", status: "queued", timestamp: 1700000000 });
      }
      if (url.origin !== "https://database.test") throw new Error(`Unexpected HTTP host: ${url.host}`);
      switch (url.pathname) {
        case "/rest/v1/organization_features": return json([{ enabled: true, expires_at: null }]);
        case "/rest/v1/whatsapp_instances": return json([instance]);
        case "/rest/v1/organizations": return json([{ whatsapp_provider_override: null }]);
        case "/rest/v1/rpc/get_uazapi_credentials": return json([{ uazapi_token: "synthetic-instance-token" }]);
        case "/rest/v1/rpc/check_rate_limit": return json(true);
        case "/rest/v1/whatsapp_messages": return json([]);
        default: throw new Error(`Unexpected database path: ${url.pathname}`);
      }
    }));
    const database = createClient("https://database.test", "synthetic-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await sendMessage(database, {
      organization_id: instance.organization_id,
      instance_id: instance.id,
      phone: "5511999999999",
      source: "workflow",
      message_type: "menu",
      content: "Como podemos ajudar?",
      track_id: "question-1",
      menu_options: {
        type: "button",
        choices: ["Comprar|question-1:buy", "Suporte|question-1:support"],
        footer: "Escolha abaixo",
        imageButton: "https://assets.example.test/catalog.jpg",
      },
    });

    expect({ success: result.success, body: menuBody }).toEqual({
      success: true,
      body: {
        number: "5511999999999",
        type: "button",
        text: "Como podemos ajudar?",
        choices: ["Comprar|question-1:buy", "Suporte|question-1:support"],
        footerText: "Escolha abaixo",
        imageButton: "https://assets.example.test/catalog.jpg",
        track_source: "workflow",
        track_id: "question-1",
      },
    });
  });
});
