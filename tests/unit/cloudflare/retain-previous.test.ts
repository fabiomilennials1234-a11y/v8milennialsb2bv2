// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MANIFEST_FILE,
  isSafeName,
  parseManifest,
  planRetention,
  reachableAssets,
  retainPrevious,
} from "../../../scripts/cloudflare/retain-previous.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

describe("isSafeName / parseManifest — nada vindo da rede vira caminho sem validar", () => {
  it("aceita só nome hashado de um segmento", () => {
    expect(isSafeName("Leads-DnfD5tIH.js")).toBe(true);
    expect(isSafeName("index-Cu9B4ZgX.css")).toBe(true);
    for (const bad of ["../x-AbCdEf12.js", "a/b-AbCdEf12.js", "a\\b-AbCdEf12.js", "%2e%2e-AbCdEf12.js", "..-AbCdEf12.js", "sem-hash.js", "x-AbCdEf12.html", "x-AbCdEf12.map", "", null, 5]) {
      expect(isSafeName(bad as string), String(bad)).toBe(false);
    }
  });

  it("descarta forma inválida, build sem id válido e arquivo de build desconhecida", () => {
    expect(parseManifest("não é json")).toBeNull();
    expect(parseManifest("<!doctype html>")).toBeNull();
    expect(parseManifest(JSON.stringify({ v: 2, builds: [], files: {} }))).toBeNull();
    const parsed = parseManifest(
      JSON.stringify({
        v: 1,
        builds: [{ id: "a1", at: iso(1) }, { id: "../x", at: iso(1) }, { id: "b2", at: "ontem" }],
        files: {
          "Ok-AbCdEf12.js": "a1",
          "../Evil-AbCdEf12.js": "a1",
          "Orfao-AbCdEf12.js": "zz",
        },
      }),
    );
    expect(parsed).toEqual({ v: 1, builds: [{ id: "a1", at: iso(1) }], files: { "Ok-AbCdEf12.js": "a1" } });
  });
});

describe("planRetention", () => {
  const previous = {
    v: 1,
    builds: [
      { id: "b3", at: iso(1) },
      { id: "b2", at: iso(3) },
      { id: "b1", at: iso(20) },
    ],
    files: {
      "A-AaaaaaaA.js": "b3",
      "B-BbbbbbbB.js": "b2",
      "C-CccccccC.js": "b1",
    },
  };
  const base = { previous, currentId: "b4", currentFiles: ["A-AaaaaaaA.js", "D-DddddddD.js"], now: NOW };

  it("mantém builds dentro do prazo, solta as velhas e re-etiqueta o que a nova ainda usa", () => {
    const plan = planRetention(base);
    expect(plan.manifest.builds.map((b: { id: string }) => b.id)).toEqual(["b4", "b3", "b2"]);
    expect(plan.manifest.files).toEqual({
      "A-AaaaaaaA.js": "b4",
      "B-BbbbbbbB.js": "b2",
      "D-DddddddD.js": "b4",
    });
    expect(plan.toFetch).toEqual(["B-BbbbbbbB.js"]);
    expect(plan.dropped).toEqual(["b1"]);
  });

  it("a build que está no ar fica mesmo passado o prazo", () => {
    const old = { ...previous, builds: [{ id: "b3", at: iso(40) }, { id: "b2", at: iso(41) }] };
    const plan = planRetention({ ...base, previous: old });
    expect(plan.manifest.builds.map((b: { id: string }) => b.id)).toEqual(["b4", "b3"]);
  });

  it("respeita o teto de builds e o de arquivos (solta a mais velha primeiro)", () => {
    expect(planRetention({ ...base, maxBuilds: 2 }).manifest.builds.map((b: { id: string }) => b.id)).toEqual(["b4", "b3"]);
    const capped = planRetention({ ...base, maxFiles: 2 });
    expect(capped.manifest.builds.map((b: { id: string }) => b.id)).toEqual(["b4", "b3"]);
    expect(Object.keys(capped.manifest.files).length).toBeLessThanOrEqual(2);
  });

  it("rodar de novo o mesmo commit substitui a entrada, sem duplicar", () => {
    const plan = planRetention({ ...base, currentId: "b3" });
    expect(plan.manifest.builds.filter((b: { id: string }) => b.id === "b3")).toHaveLength(1);
  });

  it("sem manifest anterior só a build atual entra", () => {
    const plan = planRetention({ ...base, previous: null });
    expect(plan.toFetch).toEqual([]);
    expect(plan.manifest.builds).toHaveLength(1);
  });

  it("ignora nome inseguro mesmo vindo da build atual", () => {
    const plan = planRetention({ ...base, currentFiles: ["../x-AbCdEf12.js", "D-DddddddD.js"] });
    expect(Object.keys(plan.manifest.files)).not.toContain("../x-AbCdEf12.js");
  });
});

describe("reachableAssets", () => {
  it("segue o grafo de index/sw e ignora o que não é hashado", async () => {
    const files: Record<string, string> = {
      "index.html": '<script src="/assets/index-AAAAAAAA.js"></script>',
      "sw.js": "precache:[]",
      "index-AAAAAAAA.js": 'import("./Leads-BBBBBBBB.js");"../../evil-CCCCCCCC.js"',
      "Leads-BBBBBBBB.js": "export{}",
    };
    const names = await reachableAssets(async (rel: string) => files[rel] ?? null);
    expect(names).toEqual(["Leads-BBBBBBBB.js", "index-AAAAAAAA.js", "evil-CCCCCCCC.js"].sort());
  });
});

describe("retainPrevious", () => {
  let dist: string;
  const logs: string[] = [];
  const warnings: string[] = [];

  beforeEach(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), "retain-"));
    fs.mkdirSync(path.join(dist, "assets"));
    fs.writeFileSync(path.join(dist, "index.html"), '<script src="/assets/index-NEWNEWNE.js"></script>');
    fs.writeFileSync(path.join(dist, "sw.js"), "//");
    fs.writeFileSync(path.join(dist, "assets", "index-NEWNEWNE.js"), "console.log(1)");
    logs.length = 0;
    warnings.length = 0;
  });
  afterEach(() => fs.rmSync(dist, { recursive: true, force: true }));

  /** Prod falso: caminho → [status, corpo]. */
  const prod = (routes: Record<string, [number, string]>) =>
    (async (input: URL | string) => {
      const hit = routes[new URL(input).pathname];
      if (!hit) return new Response("nf", { status: 404 });
      return new Response(hit[1], { status: hit[0] });
    }) as unknown as typeof fetch;

  const run = (fetchImpl: typeof fetch) =>
    retainPrevious({ dist, sha: "newsha1", origin: "https://prod.test", now: NOW, fetchImpl, log: (l: string) => logs.push(l), warn: (w: string) => warnings.push(w) });

  const liveManifest = {
    v: 1,
    builds: [{ id: "oldsha", at: iso(1) }],
    files: { "Leads-OLDOLDOL.js": "oldsha", "Evil..-OLDOLDOL.js": "oldsha" },
  };

  it("baixa as builds anteriores, grava o torque-builds.json e não toca no que já existe", async () => {
    const result = await run(
      prod({
        [`/${MANIFEST_FILE}`]: [200, JSON.stringify(liveManifest)],
        "/assets/Leads-OLDOLDOL.js": [200, "export const old=1"],
      }),
    );
    expect(fs.readFileSync(path.join(dist, "assets", "Leads-OLDOLDOL.js"), "utf8")).toBe("export const old=1");
    expect(fs.readFileSync(path.join(dist, "assets", "index-NEWNEWNE.js"), "utf8")).toBe("console.log(1)");
    const written = JSON.parse(fs.readFileSync(path.join(dist, MANIFEST_FILE), "utf8"));
    expect(written.builds.map((b: { id: string }) => b.id)).toEqual(["newsha1", "oldsha"]);
    expect(written.files["Leads-OLDOLDOL.js"]).toBe("oldsha");
    expect(written.files["index-NEWNEWNE.js"]).toBe("newsha1");
    expect(result.carried).toBe(1);
    expect(warnings).toEqual([]);
  });

  it("arquivo que volta HTML (fallback do SPA) ou 404 não entra, e sai do manifest", async () => {
    const result = await run(
      prod({
        [`/${MANIFEST_FILE}`]: [200, JSON.stringify({ ...liveManifest, files: { "Leads-OLDOLDOL.js": "oldsha", "Gone-OLDOLDOL.js": "oldsha" } })],
        "/assets/Leads-OLDOLDOL.js": [200, "<!doctype html><title>spa</title>"],
      }),
    );
    expect(fs.existsSync(path.join(dist, "assets", "Leads-OLDOLDOL.js"))).toBe(false);
    expect(fs.existsSync(path.join(dist, "assets", "Gone-OLDOLDOL.js"))).toBe(false);
    const written = JSON.parse(fs.readFileSync(path.join(dist, MANIFEST_FILE), "utf8"));
    expect(Object.keys(written.files)).toEqual(["index-NEWNEWNE.js"]);
    expect(result.failed.sort()).toEqual(["Gone-OLDOLDOL.js", "Leads-OLDOLDOL.js"]);
    expect(warnings.join("\n")).toContain("2 arquivo(s)");
  });

  it("prod fora do ar não derruba o deploy: avisa e publica só a build atual", async () => {
    const result = await run((async () => new Response("x", { status: 503 })) as unknown as typeof fetch);
    expect(warnings.join("\n")).toContain("não respondeu");
    expect(result.carried).toBe(0);
    const written = JSON.parse(fs.readFileSync(path.join(dist, MANIFEST_FILE), "utf8"));
    expect(written.builds).toHaveLength(1);
  });

  it("primeiro deploy (sem manifest no ar): semeia com a build viva do prod", async () => {
    const result = await run(
      prod({
        [`/${MANIFEST_FILE}`]: [200, '<!doctype html><div id="root"></div>'],
        "/index.html": [200, '<script src="/assets/index-LIVELIVE.js"></script>'],
        "/sw.js": [200, "//"],
        "/assets/index-LIVELIVE.js": [200, 'import("./Leads-LIVELIVE.js")'],
        "/assets/Leads-LIVELIVE.js": [200, "export{}"],
      }),
    );
    expect(result.carried).toBe(2);
    expect(fs.existsSync(path.join(dist, "assets", "Leads-LIVELIVE.js"))).toBe(true);
    expect(fs.existsSync(path.join(dist, "assets", "index-LIVELIVE.js"))).toBe(true);
  });

  it("recusa diretório que não é a build do front", async () => {
    fs.rmSync(path.join(dist, "sw.js"));
    await expect(run(prod({}))).rejects.toThrow(/não é a build do front/);
  });
});
