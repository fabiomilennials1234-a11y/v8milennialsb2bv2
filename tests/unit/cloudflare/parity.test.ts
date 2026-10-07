// @vitest-environment node
/**
 * O classificador da paridade e a trava de leitura contra produção. Se o
 * `compare` aceitar uma CSP juntada, ou o `send` aceitar uma credencial, a
 * paridade deixa de provar o que diz provar.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../../cloudflare/headers.json";
import { COOKIE_CASES, DIVS, SECURITY_HEADERS, buildMatrix, compare, mediaType, send, servedByAssetServer } from "../../../scripts/cloudflare/parity.mjs";

type Side = { url: string; status: number; headers: Headers; body: Buffer };

const side = (status: number, headers: Record<string, string> = {}, body = "", url = "https://a.example/x"): Side => ({
  url,
  status,
  headers: new Headers(headers),
  body: Buffer.from(body),
});

const ctx = { robots: false };
const GET = (path = "/x", extra: object = {}) => ({ method: "GET", path, headers: {}, ...extra });

describe("compare", () => {
  it("igual em tudo → PASS", () => {
    const h = { "content-type": "text/html", "cache-control": "no-store", "content-security-policy": "default-src 'self'" };
    expect(compare(GET(), side(200, h, "a"), side(200, { ...h, "content-type": "text/html; charset=utf-8" }, "a", "http://b.example/x"), ctx).outcome).toBe("PASS");
  });

  it("JS: text/javascript ≡ application/javascript", () => {
    expect(mediaType("application/javascript")).toBe(mediaType("text/javascript; charset=utf-8"));
  });

  it("CSP juntada em B → FAIL, mesmo se A estiver igual", () => {
    const joined = { "content-security-policy": "default-src 'self', default-src 'none'" };
    const result = compare(GET(), side(200, joined), side(200, joined), ctx);
    expect(result.outcome).toBe("FAIL");
    expect(result.problems.join()).toMatch(/CSP juntada/);
  });

  it("diferença sem Div que a autorize → FAIL; com Div → EXPECTED-DIFF", () => {
    const a = side(404, { "cache-control": "public, max-age=600, must-revalidate" });
    const b = side(404, { "cache-control": "no-store, must-revalidate" });
    expect(compare(GET(), a, b, ctx).outcome).toBe("FAIL");
    const allowed = compare(GET("/x", { allow: { "cache-control": "Div5" } }), a, b, ctx);
    expect(allowed).toMatchObject({ outcome: "EXPECTED-DIFF", divs: ["Div5"] });
  });

  it("Div9: na API, B igual ao primeiro valor do header duplicado de A", () => {
    const a = side(404, { "content-security-policy": "default-src 'none'; frame-ancestors 'none', default-src 'self'" });
    const b = side(404, { "content-security-policy": "default-src 'none'; frame-ancestors 'none'" });
    expect(compare(GET("/api/v1/", { api: true }), a, b, ctx)).toMatchObject({ outcome: "EXPECTED-DIFF", divs: ["Div9"] });
    // Fora da API a mesma diferença é FAIL.
    expect(compare(GET("/x"), a, b, ctx).outcome).toBe("FAIL");
  });

  it("Div4: mesmo caminho, mas A absoluto em outra porta e B relativo", () => {
    const a = side(301, { location: "http://a.example:8080/lp/v1/" }, "", "https://a.example/lp/v1");
    const b = side(301, { location: "/lp/v1/" }, "", "http://b.example/lp/v1");
    expect(compare(GET("/lp/v1"), a, b, ctx)).toMatchObject({ outcome: "EXPECTED-DIFF", divs: ["Div4"] });
  });

  it("Location de B para outra origem → FAIL", () => {
    const a = side(301, { location: "https://evil.example/lp/v1/" });
    const b = side(301, { location: "https://evil.example/lp/v1/" }, "", "http://b.example/lp/v1");
    expect(compare(GET("/lp/v1"), a, b, ctx).problems.join()).toMatch(/outra origem/);
  });

  it("corpo diferente num 2xx estático → FAIL", () => {
    expect(compare(GET(), side(200, {}, "a"), side(200, {}, "b"), ctx).outcome).toBe("FAIL");
  });

  it("workers.dev sem X-Robots-Tag onde o Worker responde → FAIL", () => {
    expect(compare(GET(), side(200), side(200), { robots: true }).outcome).toBe("FAIL");
    expect(compare(GET(), side(200), side(200, { "x-robots-tag": "noindex, nofollow" }), { robots: true })).toMatchObject({
      outcome: "EXPECTED-DIFF",
      divs: ["Div8"],
    });
  });

  it("/assets/* sai do servidor de assets, sem Worker: X-Robots-Tag não é exigido (D-F2)", () => {
    for (const p of ["/assets/index-AbCdEf12.js", "/assets/x.json", "/assets/"]) {
      expect(servedByAssetServer(p)).toBe(true);
      expect(compare(GET(p), side(200), side(200), { robots: true }).outcome, p).toBe("PASS");
    }
    // O glob do run_worker_first diferencia maiúscula: /ASSETS/ passa pelo Worker.
    expect(servedByAssetServer("/ASSETS/x.js")).toBe(false);
    expect(compare(GET("/ASSETS/x.js"), side(404), side(404), { robots: true }).outcome).toBe("FAIL");
  });

  it("os headers de segurança comparados são os de cloudflare/headers.json", () => {
    expect(SECURITY_HEADERS).toEqual(Object.keys(config.profiles.app).map((name) => name.toLowerCase()));
  });

  it("Div12: corpo diferente só onde o cookie-cases.json declara", () => {
    const declared = COOKIE_CASES.filter((c: { div?: string }) => c.div);
    expect(declared.map((c: { cookie: string; div: string }) => [c.cookie, c.div])).toEqual([["a=1,torque_ui=v5", "Div12"]]);
    const result = compare(GET("/", { allow: { body: "Div12" } }), side(200, {}, "classic"), side(200, {}, "v5"), ctx);
    expect(result).toMatchObject({ outcome: "EXPECTED-DIFF", divs: ["Div12"] });
  });
});

describe("send — só leitura contra produção", () => {
  it.each(["X-API-Key", "Authorization", "apikey"])("recusa %s", async (name) => {
    await expect(send("http://127.0.0.1:9", GET("/", { headers: { [name]: "x" } }))).rejects.toThrow(/nunca manda/);
    await expect(send("http://127.0.0.1:9", GET("/", { raw: true, rawHeaders: [name, "x"] }))).rejects.toThrow(/nunca manda/);
  });

  it("caso raw só com GET", async () => {
    await expect(send("http://127.0.0.1:9", { method: "OPTIONS", path: "/", headers: {}, raw: true })).rejects.toThrow(/só com GET/);
  });

  it("recusa método de escrita", async () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      await expect(send("http://127.0.0.1:9", { method, path: "/api/v1/leads", headers: {} })).rejects.toThrow(/método recusado/);
    }
  });

  it("POST na API só com corpo acima de 1 MiB", async () => {
    await expect(send("http://127.0.0.1:9", { method: "POST", path: "/api/v1/leads", headers: {}, body: Buffer.alloc(10) })).rejects.toThrow(
      /acima de 1 MiB/,
    );
  });
});

describe("send — prazo e cancelamento (o smoke do deploy depende disso)", () => {
  /** Servidor que aceita a conexão e nunca responde. */
  async function hangingServer() {
    const server = http.createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
  }

  it("timeoutMs por requisição, sem nova tentativa quando attempts = 1 (fetch e raw)", async () => {
    const { base, close } = await hangingServer();
    try {
      for (const testCase of [GET("/"), GET("/", { raw: true })]) {
        const started = Date.now();
        await expect(send(base, testCase, { timeoutMs: 200, attempts: 1 })).rejects.toThrow();
        expect(Date.now() - started).toBeLessThan(2_000);
      }
    } finally {
      await close();
    }
  });

  it("signal aborta na hora, inclusive entre tentativas", async () => {
    const { base, close } = await hangingServer();
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 150);
      const started = Date.now();
      await expect(send(base, GET("/"), { timeoutMs: 10_000, attempts: 3, signal: controller.signal })).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await close();
    }
  });
});

describe("buildMatrix — Div13 (/50x.html)", () => {
  function assetsDir(with50x: boolean) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-matrix-"));
    const write = (rel: string, content = "x") => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    };
    for (const name of ["index.html", "index.classic.html", "_headers", ".assetsignore", "assets/index-A.js", "lp/v1/index.html"]) write(name);
    if (with50x) write("50x.html", "<html>nginx</html>");
    return dir;
  }

  it("com o 50x.html no artefato (cf:extract), o corpo tem de bater; sem ele (artefato do CI), Div13", () => {
    for (const with50x of [true, false]) {
      const dir = assetsDir(with50x);
      try {
        const testCase = buildMatrix({ assetsDir: dir, allAssets: false }).find((c: { path: string }) => c.path === "/50x.html");
        expect(testCase, String(with50x)).toBeDefined();
        expect(testCase.allow, String(with50x)).toEqual(with50x ? undefined : { body: "Div13" });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    expect(DIVS.Div13).toMatch(/50x\.html/);
  });

  it("Div13 só cobre o corpo: status diferente continua FAIL", () => {
    const testCase = GET("/50x.html", { allow: { body: "Div13" } });
    expect(compare(testCase, side(200, {}, "nginx"), side(200, {}, "index"), ctx)).toMatchObject({ outcome: "EXPECTED-DIFF", divs: ["Div13"] });
    expect(compare(testCase, side(200, {}, "nginx"), side(404, {}, "x"), ctx).outcome).toBe("FAIL");
  });
});
