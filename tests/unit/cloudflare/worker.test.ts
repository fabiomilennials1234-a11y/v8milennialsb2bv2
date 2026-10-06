// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import worker from "../../../cloudflare/src/worker";
import { PROFILES } from "../../../cloudflare/src/headers";
import { decodePath } from "../../../cloudflare/src/routing";

/**
 * Servidor de assets falso, com o comportamento do real em `html_handling:
 * "none"`: caminho exato (decodificado), 404 sem corpo quando não existe,
 * HEAD sem corpo, e o Cache-Control padrão que o Worker tem de substituir.
 * Pior caso de propósito: cada resposta já traz uma CSP e um X-Frame-Options
 * próprios (como se uma regra do `_headers` valesse no `ASSETS.fetch`, o que a
 * doc não define). O Worker tem de SUBSTITUIR — juntar daria duas políticas.
 */
const FILES: Record<string, { body: string; type: string }> = {
  "/index.html": { body: "<html>V5</html>", type: "text/html; charset=utf-8" },
  "/index.classic.html": { body: "<html>CLASSIC</html>", type: "text/html; charset=utf-8" },
  "/sw.js": { body: "/* sw v5 */", type: "text/javascript; charset=utf-8" },
  "/sw.classic.js": { body: "/* sw classic */", type: "text/javascript; charset=utf-8" },
  "/sobre.html": { body: "<html>sobre</html>", type: "text/html; charset=utf-8" },
  "/privacidade.html": { body: "<html>privacidade</html>", type: "text/html; charset=utf-8" },
  "/robots.txt": { body: "User-agent: *", type: "text/plain; charset=utf-8" },
  "/.well-known/security.txt": { body: "Contact: mailto:security@example.com", type: "text/plain; charset=utf-8" },
  "/landing/Paleta de Cor_Milennials.png": { body: "PNG", type: "image/png" },
  "/lp/v1/index.html": { body: "<html>lp v1</html>", type: "text/html; charset=utf-8" },
  "/lp/v1/css/styles.css": { body: "body{}", type: "text/css; charset=utf-8" },
  "/assets/index-abc.js": { body: "console.log(1)", type: "text/javascript; charset=utf-8" },
};

let assetCalls: { path: string; method: string }[] = [];

const ASSETS = {
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = decodePath(url.pathname);
    assetCalls.push({ path, method });
    const file = FILES[path];
    if (!file) return new Response(null, { status: 404 });
    return new Response(method === "HEAD" ? null : file.body, {
      status: 200,
      headers: {
        "Content-Type": file.type,
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Security-Policy": "default-src 'none'",
        "X-Frame-Options": "SAMEORIGIN",
        ETag: '"etag"',
      },
    });
  },
};

const ENV = { ASSETS, API_UPSTREAM: "https://jsjsmuncfkbsbzqzqhfq.supabase.co" } as unknown as Env;

const HOST = "https://torque-front.example.workers.dev";

async function call(path: string, init: RequestInit & { host?: string } = {}): Promise<Response> {
  const { host = HOST, ...rest } = init;
  return worker.fetch(new Request(`${host}${path}`, rest) as Parameters<typeof worker.fetch>[0], ENV, {} as ExecutionContext);
}

let logSpy: MockInstance<typeof console.log>;
beforeEach(() => {
  assetCalls = [];
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  vi.unstubAllGlobals();
});

function expectProfile(response: Response, profile: "app" | "lp") {
  for (const [name, value] of Object.entries(PROFILES[profile])) expect(response.headers.get(name), name).toBe(value);
  if (profile === "lp") expect(response.headers.has("x-xss-protection")).toBe(false);
}

describe("index, service worker e páginas", () => {
  it("/ sem cookie → clássica; com torque_ui=v5 → V5", async () => {
    expect(await (await call("/")).text()).toBe("<html>CLASSIC</html>");
    expect(await (await call("/", { headers: { cookie: "torque_ui=v5" } })).text()).toBe("<html>V5</html>");
    expect(await (await call("/index.html")).text()).toBe("<html>CLASSIC</html>");
  });

  it("/sw.js segue o cookie", async () => {
    expect(await (await call("/sw.js")).text()).toBe("/* sw classic */");
    expect(await (await call("/sw.js", { headers: { cookie: "torque_ui=v5" } })).text()).toBe("/* sw v5 */");
  });

  it("headers do app e no-store substituindo o padrão do servidor de assets", async () => {
    for (const path of ["/", "/sw.js", "/sobre", "/privacidade", "/leads", "/robots.txt", "/.well-known/security.txt"]) {
      const response = await call(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control"), path).toBe("no-store, must-revalidate");
      expectProfile(response, "app");
    }
  });

  it("HEAD mantém status e headers, sem corpo", async () => {
    const response = await call("/", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
  });
});

describe("cookie em pedaços", () => {
  it("dois headers Cookie (a=1 e torque_ui=v5), nas duas ordens → V5", async () => {
    for (const parts of [["a=1", "torque_ui=v5"], ["torque_ui=v5", "a=1"]]) {
      const headers = new Headers();
      for (const part of parts) headers.append("cookie", part);
      expect(await (await call("/", { headers })).text(), parts.join(" + ")).toBe("<html>V5</html>");
    }
  });
});

describe("SPA", () => {
  it("arquivo exato quando existe, index pelo cookie quando não", async () => {
    expect(await (await call("/robots.txt")).text()).toBe("User-agent: *");
    expect(await (await call("/landing/Paleta%20de%20Cor_Milennials.png")).text()).toBe("PNG");
    expect(await (await call("/leads")).text()).toBe("<html>CLASSIC</html>");
    expect(await (await call("/configuracoes/usuarios?x=1", { headers: { cookie: "torque_ui=v5" } })).text()).toBe("<html>V5</html>");
  });

  it("caminho com barra no fim vai direto ao index", async () => {
    await call("/leads/");
    expect(assetCalls).toEqual([{ path: "/index.classic.html", method: "GET" }]);
  });
});

describe("landing pages", () => {
  it("pasta → index.html, com os headers da LP e cache de 600 s", async () => {
    const response = await call("/lp/v1/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>lp v1</html>");
    expect(response.headers.get("cache-control")).toBe("public, max-age=600, must-revalidate");
    expectProfile(response, "lp");
  });

  it("arquivo da LP", async () => {
    const response = await call("/lp/v1/css/styles.css");
    expect(await response.text()).toBe("body{}");
    expectProfile(response, "lp");
  });

  it("sem barra, com index → 301 relativo mantendo a query (Div4)", async () => {
    const response = await call("/lp/v1?utm=x");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/lp/v1/?utm=x");
    expectProfile(response, "lp");
  });

  it("pasta sem index e caminho inexistente → 404 com no-store (Div2, Div5)", async () => {
    for (const path of ["/lp/", "/lp/nao-existe", "/lp/v1/css"]) {
      const response = await call(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
      expectProfile(response, "lp");
    }
  });
});

describe("erros gerados pelo Worker", () => {
  it("dotfile → 404 sem tocar no servidor de assets", async () => {
    for (const path of ["/.env", "/.git/config", "/.assetsignore", "/%2eenv"]) {
      const response = await call(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
      expectProfile(response, "app");
    }
    expect(assetCalls).toEqual([]);
  });

  it("variação de caixa de /assets/ → 404 sem tocar no servidor de assets", async () => {
    const response = await call("/ASSETS/index-abc.js");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expect(assetCalls).toEqual([]);
  });

  it("POST/OPTIONS fora da API → 405 com Allow", async () => {
    for (const [path, method] of [["/", "POST"], ["/leads", "OPTIONS"], ["/lp/v1/", "PUT"]] as const) {
      const response = await call(path, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
      expectProfile(response, "app");
    }
  });

  it("/api/v1 → 301 relativo", async () => {
    const response = await call("/api/v1?x=1");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/api/v1/?x=1");
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
  });

  it("exceção → 500 genérico, sem stack, com os headers do app", async () => {
    const broken = { ...ENV, ASSETS: { fetch: () => Promise.reject(new Error("segredo interno /leads?cpf=123")) } } as unknown as Env;
    const response = await worker.fetch(new Request(`${HOST}/leads?cpf=123`) as Parameters<typeof worker.fetch>[0], broken, {} as ExecutionContext);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toBe("Internal Server Error");
    expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
    expectProfile(response, "app");
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("segredo");
    expect(logged).not.toContain("cpf");
  });
});

describe("headers sem junção", () => {
  it("nenhuma resposta sai com CSP juntada (vírgula = duas políticas)", async () => {
    const paths = ["/", "/sw.js", "/sobre", "/leads", "/lp/v1/", "/lp/v1", "/lp/x", "/.env", "/api/v1", "/ASSETS/x.js"];
    for (const path of paths) {
      const response = await call(path);
      const csp = response.headers.get("content-security-policy");
      expect(csp, path).not.toBeNull();
      expect(csp!.includes(","), path).toBe(false);
    }
    const post = await call("/", { method: "POST" });
    expect(post.headers.get("content-security-policy")!.includes(",")).toBe(false);
  });

  it("nunca chama o servidor de assets em /assets/* (esse caminho não passa pelo Worker)", async () => {
    for (const path of ["/", "/leads", "/lp/v1/", "/lp/v1", "/sobre", "/ASSETS/x.js", "/assets-like"]) await call(path);
    expect(assetCalls.some((c) => c.path.startsWith("/assets/"))).toBe(false);
  });
});

describe("X-Robots-Tag (Div8)", () => {
  it("só em *.workers.dev", async () => {
    expect((await call("/")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await call("/.env")).headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await call("/", { host: "https://torquecrm.com.br" })).headers.get("x-robots-tag")).toBeNull();
    expect((await call("/", { host: "http://localhost:8787" })).headers.get("x-robots-tag")).toBeNull();
  });
});

describe("API e log", () => {
  it("/api/v1/* vai para o Supabase; o log tem método, caminho, rota, status e duração — sem query nem headers", async () => {
    const fetchSpy = vi.fn(async () => new Response('{"data":[]}', { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const response = await call("/api/v1/leads?email=lead@example.com", {
      headers: { "x-api-key": "tq_live_segredo", authorization: "Bearer segredo", cookie: "torque_ui=v5" },
    });
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe(
      "https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/api/v1/leads?email=lead@example.com",
    );
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(Object.keys(entry).sort()).toEqual(["method", "ms", "path", "route", "status"]);
    expect(entry).toMatchObject({ method: "GET", path: "/api/v1/leads", route: "api", status: 200 });
    const logged = String(logSpy.mock.calls[0]![0]);
    for (const secret of ["email", "lead@example.com", "tq_live_segredo", "segredo", "torque_ui"]) {
      expect(logged).not.toContain(secret);
    }
  });

  describe("token no caminho nunca vai para o log", () => {
    // Formato real dos dois tokens: hex de 64 caracteres.
    const TOK = "9f".repeat(32);
    const SPA_PATHS = [
      `/checkout/${TOK}`,
      `/CHECKOUT/${TOK}`,
      `/checkout%2F${TOK}`,
      `//checkout/${TOK}`,
      `/checkout/${TOK}?next=/leads`,
      `/reset-password/${TOK}`,
      `/RESET-PASSWORD/${TOK}`,
      `/reset-password%2F${TOK}`,
      `/rota-que-ninguem-listou/${TOK}`,
      // Casos do QA: token como 1º segmento e grudado com `;`.
      `/${TOK}`,
      `/checkout;${TOK}`,
    ];
    const linesOf = () => logSpy.mock.calls.map((c) => String(c[0]));

    it.each(SPA_PATHS)("SPA %s: só o primeiro segmento", async (p) => {
      const response = await call(p);
      expect(response.status).toBe(200);
      const lines = linesOf();
      expect(lines).toHaveLength(1);
      for (const line of lines) expect(line).not.toContain(TOK);
      expect(JSON.parse(lines[0]!).path).toMatch(/^\/([a-z0-9-]{1,32}|:seg)(\/\*)?$/);
      expect(JSON.parse(lines[0]!).route).toBe("spa");
    });

    it.each(SPA_PATHS)("SPA %s: também no caminho de erro", async (p) => {
      const broken = { ...ENV, ASSETS: { fetch: () => Promise.reject(new Error(`falhou ${p}`)) } } as unknown as Env;
      const response = await worker.fetch(new Request(`${HOST}${p}`) as Parameters<typeof worker.fetch>[0], broken, {} as ExecutionContext);
      expect(response.status).toBe(500);
      const lines = linesOf();
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(line).not.toContain(TOK);
      expect(JSON.parse(lines[0]!)).toMatchObject({ level: "error", route: "spa" });
    });

    it("API /api/v1/checkout/<token>: redigido no sucesso e no erro", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } })));
      await call(`/api/v1/checkout/${TOK}`);
      expect(JSON.parse(linesOf()[0]!)).toMatchObject({ path: "/api/v1/checkout/:token", route: "api" });

      logSpy.mockClear();
      // API_UPSTREAM fora do formato faz o proxy lançar: caminho de erro da rota api.
      const broken = { ...ENV, API_UPSTREAM: "http://inseguro.example" } as unknown as Env;
      const response = await worker.fetch(new Request(`${HOST}/api/v1/checkout/${TOK}`) as Parameters<typeof worker.fetch>[0], broken, {} as ExecutionContext);
      expect(response.status).toBe(500);
      const lines = linesOf();
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(line).not.toContain(TOK);
      expect(JSON.parse(lines[0]!)).toMatchObject({ level: "error", route: "api", path: "/api/v1/checkout/:token" });
    });

    it("405 e not-found também cortam (negar por padrão); LP passa pela lista", async () => {
      // 405 e not-found não fazem I/O, então não chegam ao caminho de erro; o
      // corte é o mesmo `logPath` (testado por rota em routing.test.ts).
      await call(`/checkout/${TOK}`, { method: "POST" });
      await call(`/convite/${TOK}`, { method: "POST" });
      await call(`/convite/.${TOK}`);
      await call(`/lp/checkout/${TOK}`);
      const lines = linesOf();
      expect(lines).toHaveLength(4);
      for (const line of lines) expect(line).not.toContain(TOK);
      expect(lines.map((line) => JSON.parse(line))).toMatchObject([
        { route: "method-not-allowed", status: 405, path: "/checkout/*" },
        { route: "method-not-allowed", status: 405, path: "/convite/*" },
        { route: "not-found", status: 404, path: "/convite/*" },
        { route: "landing", path: "/lp/checkout/:token" },
      ]);
    });

    it("rotas do app continuam legíveis no log", async () => {
      await call("/leads");
      await call("/configuracoes/usuarios");
      expect(linesOf().map((line) => JSON.parse(line).path)).toEqual(["/leads", "/configuracoes/*"]);
    });
  });

  it("uma linha de log por requisição, também fora da API", async () => {
    await call("/leads?token=abc");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(logSpy.mock.calls[0]![0]))).toMatchObject({ method: "GET", path: "/leads", route: "spa", status: 200 });
    expect(String(logSpy.mock.calls[0]![0])).not.toContain("token");
  });
});
