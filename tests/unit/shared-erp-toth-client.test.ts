/**
 * Tests for _shared/erp/toth-client.ts — transporte do ERP Toth.
 * Foco no que a documentação do fornecedor NÃO garante: validade do token,
 * transporte do token, e o que acontece quando o host não responde.
 */
import { describe, it, expect, vi } from "vitest";
import {
  TothClient,
  TothAuthError,
  TothRequestError,
} from "../../supabase/functions/_shared/erp/toth-client";

const BASE = "https://erp.exemplo.com.br/toth/services";
const CREDS = { baseUrl: BASE, user: "milennialstech", password: "s3nh4" };

function res(body: unknown, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

/** Devolve respostas na ordem dada e registra as URLs chamadas. */
function fakeFetch(responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("chamada além do esperado");
    return Promise.resolve(next);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("login", () => {
  it("posta usuário e senha como form urlencoded no caminho certo", async () => {
    const { impl, calls } = fakeFetch([res({ token: "T1" })]);
    const client = new TothClient(CREDS, { fetchImpl: impl });

    await client.login();

    expect(calls[0].url).toBe(`${BASE}/users/login`);
    expect(calls[0].init.method).toBe("POST");
    expect(String(calls[0].init.body)).toBe("user=milennialstech&password=s3nh4");
  });

  it("traduz 401 em erro de autenticação legível", async () => {
    const { impl } = fakeFetch([res("nao autorizado", 401)]);
    const client = new TothClient(CREDS, { fetchImpl: impl });
    await expect(client.login()).rejects.toThrow(TothAuthError);
  });

  it("falha quando o login responde 200 sem token reconhecível", async () => {
    const { impl } = fakeFetch([res({ status: "ok" })]);
    const client = new TothClient(CREDS, { fetchImpl: impl });
    await expect(client.login()).rejects.toThrow(/sem token reconhecível/);
  });

  it("nomeia os campos recebidos, mas NUNCA ecoa o valor do token", async () => {
    // A mensagem vai para runtime_logs e para a tela do admin. Um corpo de login
    // não reconhecido contém, por definição, a credencial.
    const { impl } = fakeFetch([res({ chaveDeAcesso: "SEGREDO-VIVO-123" })]);
    const client = new TothClient(CREDS, { fetchImpl: impl });

    const err = await client.login().catch((e: Error) => e);

    expect(err).toBeInstanceOf(TothAuthError);
    expect((err as Error).message).toContain("chaveDeAcesso");
    expect((err as Error).message).not.toContain("SEGREDO-VIVO-123");
  });

  it("não ecoa o corpo quando o login falha com 5xx", async () => {
    const { impl } = fakeFetch([res("erro ao validar senha=s3nh4", 500)]);
    const client = new TothClient(CREDS, { fetchImpl: impl });

    const err = (await client.login().catch((e: Error) => e)) as TothRequestError;

    expect(err).toBeInstanceOf(TothRequestError);
    expect(err.message).not.toContain("s3nh4");
    expect(err.bodyPreview).toBe("");
  });
});

describe("get", () => {
  it("faz login sozinho e manda o token na query", async () => {
    const { impl, calls } = fakeFetch([res({ token: "T1" }), res({ clientes: [] })]);
    const client = new TothClient(CREDS, { fetchImpl: impl });

    await client.get("clientes", { limit: "1" });

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(`${BASE}/clientes?limit=1&token=T1`);
  });

  it("manda o token em header quando configurado assim", async () => {
    const { impl, calls } = fakeFetch([res({ token: "T1" }), res([])]);
    const client = new TothClient(
      { ...CREDS, tokenTransport: "header" },
      { fetchImpl: impl },
    );

    await client.get("clientes");

    expect(calls[1].url).toBe(`${BASE}/clientes`);
    expect((calls[1].init.headers as Record<string, string>)["X-Auth-Token"]).toBe("T1");
  });

  it("reautentica uma vez quando o token expira no meio do uso", async () => {
    // O TTL do token não é documentado — expirar é evento normal, não erro.
    const { impl, calls } = fakeFetch([
      res({ token: "T1" }),
      res("expirado", 401),
      res({ token: "T2" }),
      res({ clientes: [{ id: 1 }] }),
    ]);
    const client = new TothClient(CREDS, { fetchImpl: impl });

    const out = await client.get<{ clientes: unknown[] }>("clientes");

    expect(out.clientes).toHaveLength(1);
    expect(calls).toHaveLength(4);
    expect(calls[3].url).toContain("token=T2");
  });

  it("desiste se o token continua recusado depois de reautenticar", async () => {
    const { impl } = fakeFetch([
      res({ token: "T1" }),
      res("expirado", 401),
      res({ token: "T2" }),
      res("expirado", 401),
    ]);
    const client = new TothClient(CREDS, { fetchImpl: impl });
    await expect(client.get("clientes")).rejects.toThrow(TothAuthError);
  });

  it("expõe o status em erro HTTP não relacionado a auth", async () => {
    const { impl } = fakeFetch([res({ token: "T1" }), res("boom", 500)]);
    const client = new TothClient(CREDS, { fetchImpl: impl });
    await expect(client.get("clientes")).rejects.toMatchObject({
      name: "TothRequestError",
      status: 500,
    });
  });

  it("erra de forma legível quando a resposta não é JSON", async () => {
    const { impl } = fakeFetch([res({ token: "T1" }), res("<html>login</html>")]);
    const client = new TothClient(CREDS, { fetchImpl: impl });
    await expect(client.get("clientes")).rejects.toThrow(/não é JSON/);
  });
});

describe("falha de rede", () => {
  it("diz que não alcançou o host, em vez de repassar 'fetch failed'", async () => {
    // Modo de falha esperado enquanto o ERP não foi publicado na internet.
    const impl = vi.fn(() => Promise.reject(new Error("fetch failed"))) as unknown as typeof fetch;
    const client = new TothClient(CREDS, { fetchImpl: impl });

    await expect(client.login()).rejects.toThrow(TothRequestError);
    await expect(client.login()).rejects.toThrow(/não foi possível alcançar o erp/i);
  });
});

describe("base_url", () => {
  it("recusa endereço interno já na construção", () => {
    expect(() => new TothClient({ ...CREDS, baseUrl: "http://localhost:8080/toth" })).toThrow();
  });

  it("normaliza e expõe a base para diagnóstico", () => {
    const client = new TothClient({ ...CREDS, baseUrl: `${BASE}/` });
    expect(client.baseUrl).toBe(BASE);
  });
});
