// @vitest-environment node
/**
 * O smoke do deploy decide se a versão nova recebe tráfego e se a promovida
 * fica. Um smoke que aceita o host errado promove front quebrado; um que
 * recusa o host certo trava todo deploy. Aqui ele roda contra um host falso
 * (o `send` dublado) que imita o Worker — a escolha de interface vem do
 * próprio `uiFromCookie` do Worker — e cada teste quebra uma coisa só.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import config from "../../../cloudflare/headers.json";
import { uiFromCookie } from "../../../cloudflare/src/routing";
import {
  EXIT,
  LIMITS,
  OVERRIDE_HEADER,
  SmokeUsageError,
  WORKER_NAME,
  assetEntries,
  formatSmoke,
  overrideValue,
  parseSmokeUrl,
  runSmoke,
  smokeUntilPass,
} from "../../../scripts/cloudflare/smoke.mjs";

type Response = { url: string; status: number; headers: Headers; body: Buffer };
type TestCase = { method: string; path: string; headers?: Record<string, string>; raw?: boolean; rawHeaders?: string[] };
type Mutate = (path: string, request: { cookie: string | null; headers: Record<string, string> }, response: Response) => Response | void;

const WORKERS_DEV = "https://torque-front.example.workers.dev";
const REAL = "https://torquecrm.com.br";
const VERSION = "0b6f7a2e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

let dir: string;
const file = (rel: string) => fs.readFileSync(path.join(dir, rel));

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-assets-"));
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write(
    "index.html",
    '<html><script type="module" crossorigin src="/assets/index-V5.js"></script><link rel="modulepreload" crossorigin href="/assets/vendor-V5.js"><link rel="stylesheet" crossorigin href="/assets/index-V5.css"></html>',
  );
  write("index.classic.html", '<html><script type="module" crossorigin src="/assets/index-CL.js"></script></html>');
  write("sw.js", "/* sw v5 */");
  write("sw.classic.js", "/* sw classic */");
  write("assets/index-V5.js", "console.log('v5')");
  write("assets/vendor-V5.js", "export const v = 1");
  write("assets/index-V5.css", "body{}");
  write("assets/index-CL.js", "console.log('classic')");
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const APP = config.profiles.app as Record<string, string>;

/** Pares [nome, valor, …] → objeto com nome minúsculo. */
function headersOf(testCase: TestCase): Record<string, string> {
  if (!testCase.raw) return Object.fromEntries(Object.entries(testCase.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const out: Record<string, string> = {};
  const raw = testCase.rawHeaders ?? [];
  for (let i = 0; i < raw.length; i += 2) out[raw[i]!.toLowerCase()] = raw[i + 1]!;
  return out;
}

/**
 * Um host saudável que imita o Worker; `mutate` quebra o que o teste quiser.
 * `version`: o X-Torque-Version das respostas do Worker (null = versão antiga,
 * sem o header). `/assets/*` nunca leva o header: não passa pelo Worker.
 */
function fakeHost({ origin = WORKERS_DEV, mutate, version = VERSION }: { origin?: string; mutate?: Mutate; version?: string | null } = {}) {
  const robots = new URL(origin).hostname.endsWith(".workers.dev");
  const calls: { origin: string; testCase: TestCase; options?: unknown }[] = [];
  const send = vi.fn(async (base: string, testCase: TestCase, options?: unknown): Promise<Response> => {
    calls.push({ origin: base, testCase, options });
    const headers = headersOf(testCase);
    const cookie = headers.cookie ?? null;
    const ui = uiFromCookie(cookie);
    const p = testCase.path;
    const worker = (status: number, body: Buffer | string, type: string) => {
      const h = new Headers({ "content-type": type, "cache-control": config.cache.noStore, ...APP });
      if (robots) h.set("x-robots-tag", "noindex, nofollow");
      if (version) h.set("x-torque-version", version);
      return { url: base + p, status, headers: h, body: Buffer.from(body) };
    };
    let response: Response;
    if (p === "/" || p === "/index.html") response = worker(200, file(ui === "v5" ? "index.html" : "index.classic.html"), "text/html");
    else if (p === "/index.classic.html" || p === "/leads") response = worker(200, file("index.classic.html"), "text/html");
    else if (p === "/sw.js") response = worker(200, file(ui === "v5" ? "sw.js" : "sw.classic.js"), "application/javascript");
    else if (p === "/sw.classic.js") response = worker(200, file("sw.classic.js"), "application/javascript");
    else if (p.startsWith("/assets/")) {
      const local = path.join(dir, p.slice(1));
      response = fs.existsSync(local)
        ? {
            url: base + p,
            status: 200,
            headers: new Headers({ "content-type": p.endsWith(".css") ? "text/css" : "text/javascript", ...APP, "cache-control": config.cache.immutable }),
            body: fs.readFileSync(local),
          }
        : { url: base + p, status: 404, headers: new Headers({ ...APP, "cache-control": config.cache.immutable }), body: Buffer.from("Not Found") };
    } else if (p === "/api/v1/leads") {
      // A da function, não a do app (Div9): os headers que vêm do upstream ficam.
      const h = new Headers(APP);
      h.set("content-type", "application/json");
      h.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      h.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
      if (robots) h.set("x-robots-tag", "noindex, nofollow");
      if (version) h.set("x-torque-version", version);
      response = { url: base + p, status: 401, headers: h, body: Buffer.from('{"error":{"code":"unauthorized","message":"API key obrigatória."}}') };
    } else response = worker(404, "Not Found", "text/plain");
    return mutate?.(p, { cookie, headers }, response) ?? response;
  });
  return { send, calls };
}

const run = (options: Partial<{ url: string; assetsDir: string; override: string; expectVersion: string; allowMissingVersion: boolean }>, host = fakeHost()) =>
  runSmoke({ url: WORKERS_DEV, ...options, send: host.send }) as Promise<{ outcome: string; checks: { name: string; problems: string[] }[]; blockedBy: string[] }>;

const problems = (result: { checks: { name: string; problems: string[] }[] }) =>
  result.checks.flatMap((c) => c.problems.map((p) => `${c.name}: ${p}`));

describe("runSmoke — host saudável", () => {
  it("com --assets: PASS, e cada index, sw e chunk de entrada foi conferido", async () => {
    const host = fakeHost();
    const result = await run({ assetsDir: dir }, host);
    expect(problems(result)).toEqual([]);
    expect(result.outcome).toBe("PASS");
    const paths = host.calls.map((c) => c.testCase.path);
    for (const p of ["/index.classic.html", "/index.html", "/sw.js", "/sw.classic.js", "/leads", "/api/v1/leads", "/assets/index-V5.js", "/assets/vendor-V5.js", "/assets/index-V5.css", "/assets/index-CL.js", "/assets/index-V5.js.map", "/assets/index-CL.js.map"]) {
      expect(paths, p).toContain(p);
    }
    // Uma requisição de `/` por variante de cookie medida em produção.
    expect(paths.filter((p) => p === "/").length).toBe(14);
  });

  it("autoconsistente (sem --assets): PASS com o próprio host como referência", async () => {
    expect((await run({})).outcome).toBe("PASS");
  });

  it("domínio real sem X-Robots-Tag: PASS", async () => {
    const result = await runSmoke({ url: REAL, assetsDir: dir, send: fakeHost({ origin: REAL }).send });
    expect(result.outcome).toBe("PASS");
  });

  it("API sem Accept-Encoding: vai por node:http (raw), sem credencial", async () => {
    const host = fakeHost();
    await run({}, host);
    const api = host.calls.find((c) => c.testCase.path === "/api/v1/leads")!;
    expect(api.testCase.raw).toBe(true);
    for (const { testCase } of host.calls) {
      const names = Object.keys(headersOf(testCase));
      expect(names).not.toContain("authorization");
      expect(names).not.toContain("x-api-key");
      expect(names).not.toContain("apikey");
      expect(names).not.toContain(OVERRIDE_HEADER);
    }
  });
});

describe("runSmoke — cada quebra vira FAIL", () => {
  const broken = async (mutate: Mutate, options: Partial<{ url: string; assetsDir: string }> = { assetsDir: dir }) => {
    const origin = options.url ?? WORKERS_DEV;
    const result = await runSmoke({ url: origin, ...options, send: fakeHost({ origin, mutate }).send });
    expect(result.outcome).toBe("FAIL");
    return problems(result).join("\n");
  };

  it("`/` sem cookie servindo a V5", async () => {
    const out = await broken((p, { cookie }, r) => (p === "/" && !cookie ? { ...r, body: file("index.html") } : r));
    expect(out).toMatch(/GET \/ \[cookie: \(nenhum\)\] → classic: corpo difere/);
  });

  it("variante de cookie com a interface errada (o `a=1,torque_ui=v5` do nginx, Div12)", async () => {
    const out = await broken((p, { cookie }, r) => (p === "/" && cookie === "a=1,torque_ui=v5" ? { ...r, body: file("index.classic.html") } : r));
    expect(out).toMatch(/a=1,torque_ui=v5.*corpo difere/);
  });

  it("index servido diferente do artefato (--assets)", async () => {
    const out = await broken((p, _c, r) => (p === "/index.classic.html" ? { ...r, body: Buffer.from("<html>outro</html>") } : r));
    expect(out).toMatch(/index\.classic\.html: corpo difere de index\.classic\.html/);
  });

  it("sw.js da V5 diferente do arquivo", async () => {
    const out = await broken((p, { cookie }, r) => (p === "/sw.js" && cookie ? { ...r, body: Buffer.from("/* velho */") } : r));
    expect(out).toMatch(/sw da V5: corpo difere de sw\.js/);
  });

  it("autoconsistente: /sw.js com cookie da V5 devolvendo o sw da clássica", async () => {
    const out = await broken((p, _c, r) => (p === "/sw.js" ? { ...r, body: file("sw.classic.js") } : r), {});
    expect(out).toMatch(/serviu o sw da clássica com o cookie da V5/);
  });

  it("chunk de entrada com outro conteúdo, sem cache imutável ou 404", async () => {
    expect(await broken((p, _c, r) => (p === "/assets/index-V5.js" ? { ...r, body: Buffer.from("outro") } : r))).toMatch(/index-V5\.js: corpo difere/);
    expect(
      await broken((p, _c, r) => {
        if (p === "/assets/vendor-V5.js") r.headers.set("cache-control", "no-cache");
        return r;
      }),
    ).toMatch(/vendor-V5\.js: cache-control: "no-cache"/);
    expect(await broken((p, _c, r) => (p === "/assets/index-CL.js" ? { ...r, status: 404 } : r), {})).toMatch(/index-CL\.js: status 404/);
  });

  it("source map servido", async () => {
    const out = await broken((p, _c, r) => (p.endsWith(".map") ? { ...r, status: 200, body: Buffer.from('{"version":3,"mappings":""}') } : r));
    expect(out).toMatch(/\.map → 404: status 200/);
    expect(out).toMatch(/devolveu source map/);
  });

  it("API: comprimida sem o cliente pedir, fora do envelope, ou 200", async () => {
    expect(
      await broken((p, _c, r) => {
        if (p === "/api/v1/leads") r.headers.set("content-encoding", "gzip");
        return r;
      }),
    ).toMatch(/Content-Encoding gzip sem o cliente pedir/);
    expect(await broken((p, _c, r) => (p === "/api/v1/leads" ? { ...r, body: Buffer.from('{"message":"x"}') } : r))).toMatch(/fora do envelope/);
    expect(await broken((p, _c, r) => (p === "/api/v1/leads" ? { ...r, body: Buffer.from([0x1f, 0x8b, 0x08, 0x00]) } : r))).toMatch(/não é JSON legível \(1f8b0800/);
    expect(await broken((p, _c, r) => (p === "/api/v1/leads" ? { ...r, status: 200 } : r))).toMatch(/status 200 \(esperado 401\)/);
  });

  it("CSP juntada (duas políticas) ou header de segurança faltando", async () => {
    expect(
      await broken((p, _c, r) => {
        if (p === "/") r.headers.append("content-security-policy", "default-src 'none'");
        return r;
      }),
    ).toMatch(/CSP juntada/);
    expect(
      await broken((p, _c, r) => {
        if (p === "/leads") r.headers.delete("x-frame-options");
        return r;
      }),
    ).toMatch(/GET \/leads.*X-Frame-Options: null/);
    expect(
      await broken((p, _c, r) => {
        if (p === "/api/v1/leads") r.headers.delete("referrer-policy");
        return r;
      }),
    ).toMatch(/sem referrer-policy/);
  });

  it("X-Robots-Tag: faltando no workers.dev, ou presente no domínio real (inclusive em /assets/*)", async () => {
    expect(
      await broken((p, _c, r) => {
        if (p === "/leads") r.headers.delete("x-robots-tag");
        return r;
      }),
    ).toMatch(/X-Robots-Tag null no workers\.dev/);
    expect(
      await broken(
        (p, _c, r) => {
          if (p === "/assets/index-V5.js") r.headers.set("x-robots-tag", "noindex, nofollow");
          return r;
        },
        { url: REAL, assetsDir: dir },
      ),
    ).toMatch(/index-V5\.js: X-Robots-Tag "noindex, nofollow" no domínio real/);
  });

  it("rota do SPA sem o index", async () => {
    expect(await broken((p, _c, r) => (p === "/leads" ? { ...r, status: 404 } : r))).toMatch(/GET \/leads.*status 404/);
  });

  it("erro de rede numa verificação vira FAIL, não exceção", async () => {
    const host = fakeHost();
    const send = async (base: string, testCase: TestCase) => {
      if (testCase.path === "/assets/vendor-V5.js") throw new Error("ECONNRESET");
      return host.send(base, testCase);
    };
    const result = await runSmoke({ url: WORKERS_DEV, assetsDir: dir, send });
    expect(result.outcome).toBe("FAIL");
    expect(problems(result).join()).toMatch(/vendor-V5\.js: erro de rede: ECONNRESET/);
  });

  it("sem os dois index não há referência: para cedo, com FAIL", async () => {
    const host = fakeHost({ mutate: (p, _c, r) => (p === "/index.classic.html" ? { ...r, status: 503 } : r) });
    const result = await run({}, host);
    expect(result.outcome).toBe("FAIL");
    expect(host.calls.length).toBe(2);
  });

  it("V5 e clássica iguais: o cookie não está trocando nada", async () => {
    const out = await broken((p, _c, r) => (p === "/index.html" ? { ...r, body: file("index.classic.html") } : r), {});
    expect(out).toMatch(/são iguais/);
  });
});

describe("runSmoke — desafio da zona", () => {
  it("cf-mitigated: challenge = BLOQUEADO, não FAIL (mesmo numa resposta só)", async () => {
    const host = fakeHost({
      mutate: (p, _c, r) => {
        if (p === "/api/v1/leads") return { ...r, status: 403, headers: new Headers({ "cf-mitigated": "challenge" }), body: Buffer.from("<html>") };
      },
    });
    const result = await run({ assetsDir: dir }, host);
    expect(result.outcome).toBe("BLOQUEADO");
    expect(result.blockedBy).toEqual(["/api/v1/leads"]);
    expect(EXIT.BLOQUEADO).toBe(3);
  });
});

describe("runSmoke — override de versão", () => {
  it("toda requisição leva `Cloudflare-Workers-Version-Overrides: torque-front=\"<id>\"`, inclusive a raw", async () => {
    const host = fakeHost();
    expect((await run({ assetsDir: dir, override: VERSION }, host)).outcome).toBe("PASS");
    expect(host.calls.length).toBeGreaterThan(20);
    for (const { testCase } of host.calls) expect(headersOf(testCase)[OVERRIDE_HEADER], testCase.path).toBe(`torque-front="${VERSION}"`);
  });

  it("id que não é UUID é recusado antes de qualquer requisição", async () => {
    const host = fakeHost();
    await expect(run({ override: 'x"; evil="1' }, host)).rejects.toBeInstanceOf(SmokeUsageError);
    expect(host.calls).toHaveLength(0);
    expect(() => overrideValue("ABC")).toThrow(/UUID/);
  });

  it("o nome do Worker no header é o do wrangler.jsonc", () => {
    const wranglerFile = path.resolve(__dirname, "../../../cloudflare/wrangler.jsonc");
    const { config: wrangler } = ts.parseConfigFileTextToJson(wranglerFile, fs.readFileSync(wranglerFile, "utf8"));
    expect(WORKER_NAME).toBe(wrangler.name);
  });
});

describe("parseSmokeUrl", () => {
  it("só origem https (http só em localhost)", () => {
    expect(parseSmokeUrl("https://torque-front.torquecrm.workers.dev")).toBe("https://torque-front.torquecrm.workers.dev");
    expect(parseSmokeUrl("https://torquecrm.com.br/")).toBe("https://torquecrm.com.br");
    expect(parseSmokeUrl("http://localhost:8787")).toBe("http://localhost:8787");
    for (const bad of ["http://torquecrm.com.br", "https://torquecrm.com.br/leads", "https://u:p@torquecrm.com.br", "https://torquecrm.com.br/?x=1", "ftp://x", "nada"]) {
      expect(() => parseSmokeUrl(bad), bad).toThrow(SmokeUsageError);
    }
  });
});

describe("smokeUntilPass", () => {
  const result = (outcome: string) => ({ outcome, checks: [{ name: "x", problems: outcome === "PASS" ? [] : ["y"] }], blockedBy: [] });

  it("repete o FAIL até passar (propagação da versão nova)", async () => {
    const outcomes = ["FAIL", "FAIL", "PASS"];
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });
    const out = await smokeUntilPass({}, { retryForMs: 180_000, intervalMs: 10_000, run: async () => result(outcomes.shift()!), sleep, now: () => clock });
    expect(out).toMatchObject({ outcome: "PASS", attempts: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("para no prazo com o último FAIL", async () => {
    let clock = 0;
    const out = await smokeUntilPass({}, {
      retryForMs: 25_000,
      intervalMs: 10_000,
      run: async () => result("FAIL"),
      sleep: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
    });
    expect(out).toMatchObject({ outcome: "FAIL", attempts: 3 });
  });

  it("BLOQUEADO não é propagação: volta na primeira", async () => {
    const sleep = vi.fn();
    const out = await smokeUntilPass({}, { retryForMs: 180_000, run: async () => result("BLOQUEADO"), sleep });
    expect(out).toMatchObject({ outcome: "BLOQUEADO", attempts: 1 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("sem retry: uma tentativa só", async () => {
    const out = await smokeUntilPass({}, { run: async () => result("FAIL"), sleep: vi.fn() });
    expect(out.attempts).toBe(1);
  });
});

describe("utilidades", () => {
  it("assetEntries: script de entrada, modulepreload e CSS, sem duplicata e sem nada fora de /assets/", () => {
    const html = '<script type="module" src="/assets/index-A.js"></script><link rel="modulepreload" href="/assets/v-B.js"><link href="/assets/index-C.css" rel="stylesheet"><link rel="manifest" href="/manifest.webmanifest"><script src="/assets/index-A.js"></script><script src="https://cdn.example/x.js"></script>';
    expect(assetEntries(html)).toEqual(["/assets/index-A.js", "/assets/index-C.css", "/assets/v-B.js"]);
  });

  it("formatSmoke: só as falhas e uma linha final", () => {
    const lines = formatSmoke({
      outcome: "FAIL",
      attempts: 2,
      checks: [
        { name: "ok", problems: [] },
        { name: "ruim", problems: ["status 500"] },
      ],
    });
    expect(lines).toEqual(["FAIL       ruim", "           ↳ status 500", "SMOKE FAIL — 2 verificações, 1 com problema em 2 tentativas"]);
  });

});

describe("runSmoke — prova de versão (X-Torque-Version)", () => {
  const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

  it("override ignorado em silêncio (a versão ANTERIOR responde) → FAIL logo nos index, sem avaliar o resto", async () => {
    const host = fakeHost({ version: OTHER });
    const result = await run({ assetsDir: dir, override: VERSION }, host);
    expect(result.outcome).toBe("FAIL");
    expect(problems(result).join("\n")).toContain(`versão ${OTHER} respondeu (esperada ${VERSION})`);
    expect(host.calls).toHaveLength(2);
  });

  it("versão sem o header (anterior à prova) → FAIL, a não ser com allowMissingVersion (rollback para versão antiga)", async () => {
    const result = await run({ assetsDir: dir, expectVersion: VERSION }, fakeHost({ version: null }));
    expect(result.outcome).toBe("FAIL");
    expect(problems(result).join()).toMatch(/sem X-Torque-Version/);
    expect((await run({ expectVersion: VERSION, allowMissingVersion: true }, fakeHost({ version: null }))).outcome).toBe("PASS");
    // allowMissing não aceita OUTRA versão: só a ausência do header.
    expect((await run({ expectVersion: VERSION, allowMissingVersion: true }, fakeHost({ version: OTHER }))).outcome).toBe("FAIL");
  });

  it("a versão é conferida em toda resposta do Worker (inclusive a API), e não em /assets/*", async () => {
    const host = fakeHost({
      mutate: (p, _c, r) => {
        if (p === "/api/v1/leads") r.headers.set("x-torque-version", OTHER);
        return r;
      },
    });
    const result = await run({ assetsDir: dir, expectVersion: VERSION }, host);
    expect(problems(result)).toEqual([`GET /api/v1/leads sem Accept-Encoding → 401 JSON: versão ${OTHER} respondeu (esperada ${VERSION})`]);
  });

  it("sem versão esperada, o header não é exigido (smoke manual de um host qualquer)", async () => {
    expect((await run({ assetsDir: dir }, fakeHost({ version: null }))).outcome).toBe("PASS");
  });

  it("--expect-version que não é UUID é recusado", async () => {
    await expect(run({ expectVersion: "abc" })).rejects.toBeInstanceOf(SmokeUsageError);
  });
});

describe("runSmoke — prazos", () => {
  it("cada requisição: 10 s, uma tentativa, com o sinal da rodada", async () => {
    const host = fakeHost();
    await run({ assetsDir: dir }, host);
    for (const { options } of host.calls) {
      expect(options).toMatchObject({ timeoutMs: LIMITS.requestMs, attempts: 1 });
      expect((options as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
    }
    expect(LIMITS).toEqual({ requestMs: 10_000, attemptMs: 60_000 });
  });

  it("o teto da rodada corta o que estiver pendurado: FAIL rápido, nunca pendura", async () => {
    const host = fakeHost();
    const hanging = (base: string, testCase: TestCase, options?: { signal?: AbortSignal }) =>
      testCase.path === "/assets/vendor-V5.js"
        ? new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(new Error("aborted"))))
        : host.send(base, testCase, options);
    const started = Date.now();
    const result = await runSmoke({ url: WORKERS_DEV, assetsDir: dir, send: hanging, limits: { requestMs: 50, attemptMs: 300 } });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.outcome).toBe("FAIL");
    expect(problems(result).join()).toMatch(/vendor-V5\.js: teto da rodada \(0\.3 s\) estourado/);
  });
});
