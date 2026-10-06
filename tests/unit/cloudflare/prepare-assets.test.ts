// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import config from "../../../cloudflare/headers.json";
import { PrepareError, prepareAssets, scanContent } from "../../../scripts/cloudflare/prepare-assets.mjs";

/**
 * Caixa de areia: TODO caminho que estes testes passam ao prepareAssets fica em
 * um diretório temporário. `cfRoot` faz o papel de `cloudflare/` e é o
 * `allowedRoot` de todas as chamadas. Nenhum teste aqui conhece o caminho do
 * repositório — se a trava do destino regredir, o pior que um `rm -rf` apaga é
 * o tmp (e as sentinelas denunciam). A trava contra os caminhos reais do repo é
 * testada como função pura em lib.test.ts.
 */
let tmp: string;
let cfRoot: string;
let from: string;
let out: string;
const SENTINEL = "SENTINELA-nao-apagar";
const sentinels = () => [path.join(tmp, SENTINEL), path.join(cfRoot, SENTINEL), path.join(cfRoot, "src", SENTINEL)];

const write = (rel: string, content: string | Buffer = "x") => {
  const file = path.join(from, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const jwt = (payload: object) =>
  [{ alg: "HS256", typ: "JWT" }, payload].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".c2ln";

/** Build dual mínima, limpa. */
function dualBuild() {
  write("index.html", "<html>V5</html>");
  write("index.classic.html", "<html>CLASSIC</html>");
  write("sw.js", "/* v5 */");
  write("sw.classic.js", "/* classic */");
  write("assets/index-AbCdEf12.js", `const k="${jwt({ iss: "supabase", role: "anon" })}";`);
  write("assets/exceljs.min-BzoLa1-K.js", 'l=["-----BEGIN "+t.label+"-----"];a=/^-----BEGIN ((?:.*? KEY)|CERTIFICATE)-----/m');
  write(".well-known/security.txt", "Contact: mailto:security@example.com");
  write("lp/v1/index.html", "<html>lp</html>");
}

const run = () => prepareAssets({ from, out, headersConfig: config, allowedRoot: cfRoot });

function expectRefusal(pattern: RegExp) {
  let error: unknown;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(PrepareError);
  expect((error as Error).message).toMatch(pattern);
  // Nada é publicado de uma build recusada.
  expect(fs.existsSync(out)).toBe(false);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-prepare-"));
  cfRoot = path.join(tmp, "cf");
  from = path.join(tmp, "dist");
  out = path.join(cfRoot, ".assets");
  fs.mkdirSync(from);
  fs.mkdirSync(path.join(cfRoot, "src"), { recursive: true });
  for (const file of sentinels()) fs.writeFileSync(file, SENTINEL);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("caminho feliz", () => {
  it("copia a build, tira os .map e gera _headers e .assetsignore", () => {
    dualBuild();
    write("assets/index-AbCdEf12.js.map", '{"version":3,"sources":["src/main.tsx"],"mappings":""}');
    write("sw.js.map", '{"version":3,"mappings":""}');
    write(".DS_Store", "finder");

    const result = run();

    expect(result.mapsRemoved).toBe(2);
    const published = (dir: string, prefix = ""): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? published(path.join(dir, entry.name), rel) : [rel];
      });
    const files = published(out).sort();
    expect(files.filter((f) => f.endsWith(".map"))).toEqual([]);
    expect(files).not.toContain(".DS_Store");
    expect(files).toEqual(
      [
        ".assetsignore",
        ".well-known/security.txt",
        "_headers",
        "assets/exceljs.min-BzoLa1-K.js",
        "assets/index-AbCdEf12.js",
        "index.classic.html",
        "index.html",
        "lp/v1/index.html",
        "sw.classic.js",
        "sw.js",
      ].sort(),
    );
    const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    for (const name of ["index.html", "index.classic.html", "sw.js", "sw.classic.js"]) {
      expect(sha(path.join(out, name))).toBe(sha(path.join(from, name)));
    }
    expect(fs.readFileSync(path.join(out, "_headers"), "utf8")).toContain("/assets/*\n");
    expect(fs.readFileSync(path.join(out, ".assetsignore"), "utf8")).toContain("*.map\n");
  });

  it("limpa a saída anterior antes de copiar", () => {
    dualBuild();
    fs.mkdirSync(path.join(out, "assets"), { recursive: true });
    fs.writeFileSync(path.join(out, "assets/velho-12345678.js"), "stale");
    run();
    expect(fs.existsSync(path.join(out, "assets/velho-12345678.js"))).toBe(false);
  });
});

describe("recusa de propósito", () => {
  it("sem --from", () => {
    expect(() => prepareAssets({ from: undefined, out, headersConfig: config, allowedRoot: cfRoot })).toThrow(/--from é obrigatório/);
  });

  it.each([
    ["o pai da raiz permitida (o repositório, na vida real)", () => tmp],
    ["a raiz permitida (cloudflare/)", () => cfRoot],
    ["cloudflare/src", () => path.join(cfRoot, "src")],
    ["pasta visível dentro da raiz", () => path.join(cfRoot, "out")],
    ["pasta oculta fora da raiz", () => path.join(tmp, ".fora")],
  ])("destino que seria apagado sem ser nosso: %s — recusa e não apaga nada", (_name, target) => {
    dualBuild();
    expect(() => prepareAssets({ from, out: target(), headersConfig: config, allowedRoot: cfRoot })).toThrow(/destino recusado/);
    for (const file of sentinels()) expect(fs.readFileSync(file, "utf8"), file).toBe(SENTINEL);
    expect(fs.existsSync(path.join(from, "index.html"))).toBe(true);
  });

  it("build que não é a dual", () => {
    dualBuild();
    fs.rmSync(path.join(from, "index.classic.html"));
    expectRefusal(/index\.classic\.html ausente/);
  });

  it.each([
    [".env", /arquivo \.env/],
    [".env.production", /arquivo \.env/],
    ["assets/.env.local", /arquivo \.env/],
    ["certs/server.pem", /\.pem/],
    ["server.key", /\.key/],
    [".git/config", /\.git/],
    [".dev.vars", /\.dev\.vars/],
    [".npmrc", /\.npmrc/],
    [".htaccess", /dotfile/],
    ["assets/.hidden.js", /dotfile/],
    ["_redirects", /configuração do servidor de assets/],
    ["_headers", /configuração do servidor de assets/],
    ["_worker.js", /configuração do servidor de assets/],
  ])("arquivo pelo nome: %s", (rel, pattern) => {
    dualBuild();
    write(rel);
    expectRefusal(pattern);
  });

  it.each([
    ["chave secreta do Supabase", "assets/a-12345678.js", 'const k="sb_secret_AbCdEfGh123456";', /sb_secret_/],
    ["chave privada PEM", "assets/b-12345678.js", "-----BEGIN RSA PRIVATE KEY-----\nMIIE", /chave privada/],
    ["chave privada PKCS8", "api/key.txt", "-----BEGIN PRIVATE KEY-----\nMIIE", /chave privada/],
    ["chave privada PGP", "api/pgp.txt", "-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOY", /chave privada/],
    ["token de org do Sentry", "assets/g-12345678.js", 'const t="sntrys_eyJpYXQiOjE3MDAwMDAwMDAuMCwidXJsIjoiaHR0cHM6Ly9zZW50cnkuaW8ifQ_abcDEF";', /Sentry \(sntrys_\)/],
    ["token de usuário do Sentry", "assets/h-12345678.js", `t="sntryu_${"a1".repeat(32)}"`, /Sentry \(sntryu_\)/],
    // Montadas em runtime, como as de baixo: o literal inteiro no fonte é
    // barrado pelo push protection do GitHub (detector de chave do Stripe).
    ["chave do Stripe", "assets/i-12345678.js", `t="sk_live_${"Ab12".repeat(6)}"`, /Stripe \(sk_live_\)/],
    ["chave restrita do Stripe", "assets/j-12345678.js", `t="rk_live_${"Ab12".repeat(6)}"`, /Stripe \(rk_live_\)/],
    ["token clássico do GitHub", "assets/k-12345678.js", `t="ghp_${"A".repeat(36)}"`, /GitHub \(ghp_\)/],
    ["token fine-grained do GitHub", "assets/l-12345678.js", `t="github_pat_${"B".repeat(22)}_${"c".repeat(59)}"`, /GitHub \(github_pat_\)/],
    ["chave da OpenAI", "assets/m-12345678.js", `t="sk-proj-${"x".repeat(48)}"`, /OpenAI \(sk-proj-\)/],
    ["chave da Anthropic", "assets/n-12345678.js", `t="sk-ant-api03-${"y".repeat(40)}"`, /Anthropic \(sk-ant-\)/],
    ["JWT de service_role", "assets/c-12345678.js", `x="${jwt({ iss: "supabase", role: "service_role" })}"`, /service_role/],
    ["source map com outro nome", "assets/d-12345678.json", '{"version":3,"sources":["a.ts"],"mappings":"AAAA"}', /source map com outro nome/],
    ["source map embutido", "assets/e-12345678.js", "x()\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==", /source map embutido/],
    ["segredo dentro de um .map", "assets/f-12345678.js.map", '{"version":3,"sourcesContent":["sb_secret_AbCdEfGh123456"]}', /sb_secret_/],
  ])("conteúdo: %s", (_name, rel, content, pattern) => {
    dualBuild();
    write(rel, content);
    expectRefusal(pattern);
  });

  it("link simbólico", () => {
    dualBuild();
    fs.symlinkSync(os.homedir(), path.join(from, "assets", "home"));
    expectRefusal(/link simbólico/);
  });

  it("arquivo acima de 25 MiB", () => {
    dualBuild();
    const big = path.join(from, "assets", "big-12345678.png");
    fs.writeFileSync(big, "");
    fs.truncateSync(big, 25 * 1024 * 1024 + 1);
    expectRefusal(/acima do limite de 25 MiB/);
  });

  it("origem dentro da saída (o rm -rf da saída levaria a origem junto)", () => {
    const inner = path.join(out, "dist");
    fs.mkdirSync(inner, { recursive: true });
    for (const name of ["index.html", "index.classic.html", "sw.js", "sw.classic.js"]) fs.writeFileSync(path.join(inner, name), "x");
    expect(() => prepareAssets({ from: inner, out, headersConfig: config, allowedRoot: cfRoot })).toThrow(/um dentro do outro/);
    expect(fs.existsSync(path.join(inner, "index.html"))).toBe(true);
  });
});

describe("varredura de conteúdo", () => {
  it("o que existe no bundle de produção não dispara alarme", () => {
    expect(scanContent("assets/index.js", Buffer.from(`k="${jwt({ role: "anon" })}"`))).toEqual([]);
    expect(scanContent("assets/exceljs.js", Buffer.from('"-----BEGIN "+t.label+"-----"'))).toEqual([]);
    expect(scanContent("api/openapi.json", Buffer.from('{"openapi":"3.1.0","info":{"version":"1"}}'))).toEqual([]);
    expect(scanContent("assets/svc.js", Buffer.from('role === "service_role"'))).toEqual([]);
    // Prefixo sem o corpo do token: o que código minificado e docs carregam.
    expect(scanContent("assets/p.js", Buffer.from('if(t.startsWith("ghp_")||t.startsWith("sk_live_")||t.startsWith("sk-ant-"))'))).toEqual([]);
    expect(scanContent("assets/q.js", Buffer.from('"-----BEGIN PGP PUBLIC KEY BLOCK-----"'))).toEqual([]);
  });
});
