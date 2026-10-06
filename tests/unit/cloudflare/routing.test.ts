// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SECRET_PATH_SEGMENTS,
  decodePath,
  encodePath,
  hasDotSegment,
  logPath,
  readCookie,
  redactPath,
  resolveRoute,
  uiFromCookie,
  type Route,
} from "../../../cloudflare/src/routing";
import cookieCases from "../../../scripts/cloudflare/cookie-cases.json";

// Concatenado, não `new URL(path, base)`: "//sobre" viraria host, e na linha de
// requisição HTTP ele é caminho.
const route = (path: string, method = "GET", cookie: string | null = null): Route =>
  resolveRoute(new URL(`https://torque-front.example.workers.dev${path}`), method, cookie);

describe("cookie torque_ui — o que o Worker escolhe, frente ao que o nginx escolhe (medido em 2026-10-06)", () => {
  // Fonte única com a paridade: scripts/cloudflare/cookie-cases.json. `prod` foi
  // medido com curl contra o index.html (V5) e o index.classic.html de produção.
  it.each(cookieCases.cases.map((c) => [c.cookie, c.worker, c.prod, c.div ?? ""] as const))(
    "%s → Worker %s (prod %s) %s",
    (cookie, worker, prod, div) => {
      expect(uiFromCookie(cookie)).toBe(worker);
      // Só diverge do nginx onde há divergência declarada.
      if (worker !== prod) expect(div).toMatch(/^Div\d+$/);
    },
  );

  it("headers Cookie repetidos, que o workerd junta com `, `, nas duas ordens → V5 (Div12)", () => {
    // O workerd junta headers repetidos com ", " (medido pelo QA no wrangler dev);
    // o undici do Node junta Cookie com "; ". As duas formas têm de dar V5.
    for (const sep of [", ", "; "]) {
      expect(uiFromCookie(["a=1", "torque_ui=v5"].join(sep))).toBe("v5");
      expect(uiFromCookie(["torque_ui=v5", "a=1"].join(sep))).toBe("v5");
      expect(uiFromCookie(["sb-a=1; sb-b=2", "torque_ui=v5; x=1"].join(sep))).toBe("v5");
      expect(uiFromCookie(["torque_ui=classic", "torque_ui=v5"].join(sep))).toBe("classic");
    }
  });

  it("lê o valor até `;` ou `,`, sem aparar o fim", () => {
    expect(readCookie("torque_ui=v5 ; x=1", "torque_ui")).toBe("v5 ");
    expect(readCookie("x=1;  torque_ui=  v5", "torque_ui")).toBe("v5");
    expect(readCookie("torque_ui=v5, x=1", "torque_ui")).toBe("v5");
    expect(readCookie("", "torque_ui")).toBeNull();
    expect(readCookie("torque_ui", "torque_ui")).toBeNull();
    expect(readCookie("torque_uiv5", "torque_ui")).toBeNull();
  });
});

describe("redactPath — o que o log pode gravar do caminho", () => {
  it("troca o token de redefinição de senha por marcador", () => {
    expect(redactPath("/reset-password/abc123")).toBe("/reset-password/:token");
    expect(redactPath("/reset-password/abc123/")).toBe("/reset-password/:token/");
    expect(redactPath("/RESET-PASSWORD/abc123")).toBe("/reset-password/:token");
    expect(redactPath("/reset-password%2Fabc123")).toBe("/reset-password/:token");
    expect(redactPath("//reset-password/abc123")).toBe("/reset-password/:token");
    expect(redactPath("/reset-password")).toBe("/reset-password");
  });

  it("troca o caminho de objeto do Storage, fica o bucket", () => {
    expect(redactPath("/storage/v1/object/public/media/org/lead/contrato.pdf")).toBe("/storage/v1/object/public/media/:path");
  });

  it("caminho comum passa como veio (decodificado)", () => {
    expect(redactPath("/leads")).toBe("/leads");
    expect(redactPath("/landing/Paleta%20de%20Cor_Milennials.png")).toBe("/landing/Paleta de Cor_Milennials.png");
  });

  it("troca o token do link de pagamento por marcador (defesa em profundidade)", () => {
    expect(redactPath("/checkout/a1b2c3TOK")).toBe("/checkout/:token");
    expect(redactPath("/CHECKOUT/a1b2c3TOK")).toBe("/checkout/:token");
    expect(redactPath("/checkout%2Fa1b2c3TOK")).toBe("/checkout/:token");
    expect(redactPath("//checkout/a1b2c3TOK")).toBe("/checkout/:token");
    expect(redactPath("/api/v1/checkout/a1b2c3TOK")).toBe("/api/v1/checkout/:token");
  });

  it("CONTÉM a lista do Sentry (src/shared/errors/sentry-event.ts), aqui sem diferenciar maiúscula", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../../src/shared/errors/sentry-event.ts"), "utf8");
    const block = source.slice(source.indexOf("const SECRET_PATH_SEGMENTS"), source.indexOf("];", source.indexOf("const SECRET_PATH_SEGMENTS")));
    const sentry = [...block.matchAll(/\[\/(.+?)\/([a-z]*), "(.+?)"\]/g)].map((m) => ({ source: m[1]!, flags: m[2]!, replacement: m[3]! }));
    expect(sentry.length).toBeGreaterThan(0);
    for (const rule of sentry) {
      const mine = SECRET_PATH_SEGMENTS.find(([pattern, replacement]) => pattern.source === rule.source && replacement === rule.replacement);
      expect(mine, `regra do Sentry ausente no Worker: /${rule.source}/`).toBeDefined();
      for (const flag of rule.flags) expect(mine![0].flags).toContain(flag);
    }
    for (const [pattern] of SECRET_PATH_SEGMENTS) expect(pattern.flags).toContain("i");
  });
});

describe("logPath — negar por padrão: caminho cortado fora das rotas de estrutura conhecida", () => {
  const TOK = "9f".repeat(32);

  it.each([
    ["/", "/"],
    ["/leads", "/leads"],
    ["/leads/", "/leads"],
    ["/Leads", "/leads"],
    ["/configuracoes/usuarios", "/configuracoes/*"],
    ["/checkout/a1b2c3TOK", "/checkout/*"],
    ["/CHECKOUT/a1b2c3TOK", "/checkout/*"],
    ["/checkout%2Fa1b2c3TOK", "/checkout/*"],
    ["//checkout/a1b2c3TOK", "/checkout/*"],
    ["/reset-password/a1b2c3TOK", "/reset-password/*"],
    ["/qualquer/token/que-ninguem/listou", "/qualquer/*"],
    // Primeiro segmento sem cara de rota: vira :seg inteiro.
    [`/${TOK}`, "/:seg"],
    [`/${TOK}/x`, "/:seg/*"],
    [`/checkout;${TOK}`, "/:seg"],
    ["/" + "a".repeat(33), "/:seg"],
    ["/" + "a".repeat(32), "/" + "a".repeat(32)],
    ["/.env", "/:seg"],
    ["/foo_bar", "/:seg"],
  ])("%s → %s", (pathname, expected) => {
    for (const route of ["spa", "error", "method-not-allowed", "not-found"] as const) {
      expect(logPath(route, pathname), route).toBe(expected);
    }
  });

  it("os casos do QA: 405, not-found, token no 1º segmento e `;`", () => {
    expect(logPath("method-not-allowed", `/convite/${TOK}`)).toBe("/convite/*");
    expect(logPath("not-found", `/convite/.${TOK}`)).toBe("/convite/*");
    expect(logPath("spa", `/${TOK}`)).toBe("/:seg");
    expect(logPath("spa", `/checkout;${TOK}`)).toBe("/:seg");
  });

  it("rotas de estrutura conhecida mantêm o caminho, sem os segredos da lista", () => {
    expect(logPath("api", "/api/v1/checkout/a1b2c3TOK")).toBe("/api/v1/checkout/:token");
    expect(logPath("api", "/api/v1/leads/123")).toBe("/api/v1/leads/123");
    expect(logPath("landing", "/lp/v1/")).toBe("/lp/v1/");
    expect(logPath("landing", "/lp/checkout/a1b2c3TOK")).toBe("/lp/checkout/:token");
    expect(logPath("page", "/sobre")).toBe("/sobre");
    expect(logPath("page", "/.well-known/security.txt")).toBe("/.well-known/security.txt");
    expect(logPath("index", "/index.html")).toBe("/index.html");
    expect(logPath("service-worker", "/sw.js")).toBe("/sw.js");
    expect(logPath("redirect", "/api/v1")).toBe("/api/v1");
  });
});

describe("caminho: decodificação como a do servidor de assets", () => {
  it("decodifica por segmento e junta barras repetidas", () => {
    expect(decodePath("/landing/Paleta%20de%20Cor_Milennials.png")).toBe("/landing/Paleta de Cor_Milennials.png");
    expect(decodePath("//sobre")).toBe("/sobre");
    expect(decodePath("/foo%2f.env")).toBe("/foo/.env");
    expect(decodePath("/bad%E0%A4")).toBe("/bad%E0%A4");
  });

  it("encodePath é a forma canônica que volta para o mesmo caminho", () => {
    for (const p of ["/landing/Paleta de Cor_Milennials.png", "/lp/v1/", "/a+b/c@d"]) {
      expect(decodePath(encodePath(p))).toBe(p);
    }
  });

  it("dotfile em qualquer segmento", () => {
    expect(hasDotSegment("/.env")).toBe(true);
    expect(hasDotSegment("/a/.git/config")).toBe(true);
    expect(hasDotSegment("/index.html")).toBe(false);
  });
});

describe("contrato de roteamento — uma linha por linha da tabela do macro", () => {
  it("1. / e /index.html → index pelo cookie", () => {
    expect(route("/")).toEqual({ kind: "index", asset: "/index.classic.html" });
    expect(route("/", "GET", "torque_ui=v5")).toEqual({ kind: "index", asset: "/index.html" });
    expect(route("/index.html")).toEqual({ kind: "index", asset: "/index.classic.html" });
    expect(route("/index.html", "HEAD", "torque_ui=v5")).toEqual({ kind: "index", asset: "/index.html" });
  });

  it("2. /sw.js → service worker da mesma build", () => {
    expect(route("/sw.js")).toEqual({ kind: "service-worker", asset: "/sw.classic.js" });
    expect(route("/sw.js", "GET", "torque_ui=v5")).toEqual({ kind: "service-worker", asset: "/sw.js" });
  });

  it("3. /sobre e /privacidade (exatos)", () => {
    expect(route("/sobre")).toEqual({ kind: "page", asset: "/sobre.html" });
    expect(route("/privacidade")).toEqual({ kind: "page", asset: "/privacidade.html" });
    expect(route("/sobre/")).toEqual({ kind: "spa", path: "/sobre/", fallback: "/index.classic.html" });
  });

  it("4. /api/v1 sem barra → 301 relativo, com a query (Div4)", () => {
    expect(route("/api/v1")).toEqual({ kind: "redirect", location: "/api/v1/" });
    expect(route("/api/v1?x=1&y=2")).toEqual({ kind: "redirect", location: "/api/v1/?x=1&y=2" });
  });

  it("5. /api/v1/* → proxy, com qualquer método e antes da regra de dotfile", () => {
    for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
      expect(route("/api/v1/leads", method)).toEqual({ kind: "api" });
    }
    expect(route("/api/v1/.env")).toEqual({ kind: "api" });
    expect(route("/api/v1/")).toEqual({ kind: "api" });
  });

  it("6. método ≠ GET/HEAD fora da API → 405", () => {
    for (const path of ["/", "/leads", "/sobre", "/lp/v1/", "/robots.txt"]) {
      expect(route(path, "POST")).toEqual({ kind: "method-not-allowed" });
    }
    expect(route("/leads", "OPTIONS")).toEqual({ kind: "method-not-allowed" });
  });

  it("7. segmento com ponto → 404; security.txt é a exceção (Div1)", () => {
    for (const path of ["/.env", "/.git/config", "/.assetsignore", "/lp/.hidden", "/%2eenv", "/foo%2f.env", "/.well-known/other"]) {
      expect(route(path)).toEqual({ kind: "not-found" });
    }
    expect(route("/.well-known/security.txt")).toEqual({ kind: "page", asset: "/.well-known/security.txt" });
  });

  it("8. /lp/* → landing", () => {
    expect(route("/lp/v1/")).toEqual({ kind: "landing", path: "/lp/v1/" });
    expect(route("/lp/v1")).toEqual({ kind: "landing", path: "/lp/v1" });
    expect(route("/lp/")).toEqual({ kind: "landing", path: "/lp/" });
  });

  it("9. regex de /assets/ (sem diferenciar maiúscula) que chega ao Worker → 404", () => {
    expect(route("/ASSETS/x.js")).toEqual({ kind: "not-found" });
    expect(route("/assets/x.MAP")).toEqual({ kind: "not-found" });
    // Extensão fora da regex: o nginx cai no SPA; aqui também (se chegasse ao Worker).
    expect(route("/Assets/x.json")).toEqual({ kind: "spa", path: "/Assets/x.json", fallback: "/index.classic.html" });
  });

  it("10. resto → arquivo exato ou index pelo cookie", () => {
    expect(route("/leads")).toEqual({ kind: "spa", path: "/leads", fallback: "/index.classic.html" });
    expect(route("/configuracoes/usuarios?x=1", "GET", "torque_ui=v5")).toEqual({
      kind: "spa",
      path: "/configuracoes/usuarios",
      fallback: "/index.html",
    });
    expect(route("/landing/Paleta%20de%20Cor_Milennials.png")).toEqual({
      kind: "spa",
      path: "/landing/Paleta de Cor_Milennials.png",
      fallback: "/index.classic.html",
    });
  });

  it("caminho normalizado antes de casar (como o merge_slashes do nginx)", () => {
    expect(route("//sobre")).toEqual({ kind: "page", asset: "/sobre.html" });
    expect(route("/sobr%65")).toEqual({ kind: "page", asset: "/sobre.html" });
    expect(route("/api/v1/../../.env")).toEqual({ kind: "not-found" });
  });
});
