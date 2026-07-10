import { describe, it, expect } from "vitest";
import { defectLabel, groupByDefect, normalizeDefectUrl } from "./defect-url";

describe("normalizeDefectUrl", () => {
  const url = "https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1005";

  it("aceita a URL de uma issue do GitHub", () => {
    expect(normalizeDefectUrl(url)).toEqual({ ok: true, url });
  });

  it("apara espaços", () => {
    expect(normalizeDefectUrl(`  ${url}  `)).toEqual({ ok: true, url });
  });

  it("descarta a âncora de um comentário", () => {
    expect(normalizeDefectUrl(`${url}#issuecomment-123`)).toEqual({ ok: true, url });
  });

  it("descarta a query string", () => {
    expect(normalizeDefectUrl(`${url}?foo=bar`)).toEqual({ ok: true, url });
  });

  // Vazio significa "desvincular", não "URL inválida".
  it("string vazia é desvincular", () => {
    expect(normalizeDefectUrl("")).toEqual({ ok: true, url: null });
    expect(normalizeDefectUrl("   ")).toEqual({ ok: true, url: null });
  });

  it("recusa uma URL que não é uma issue", () => {
    expect(normalizeDefectUrl("https://github.com/org/repo/pull/12")).toMatchObject({ ok: false });
    expect(normalizeDefectUrl("https://github.com/org/repo")).toMatchObject({ ok: false });
  });

  it("recusa outro domínio", () => {
    expect(normalizeDefectUrl("https://gitlab.com/org/repo/issues/1")).toMatchObject({ ok: false });
  });

  it("recusa lixo", () => {
    expect(normalizeDefectUrl("não é url")).toMatchObject({ ok: false });
  });

  it("recusa http sem s", () => {
    expect(
      normalizeDefectUrl("http://github.com/org/repo/issues/1"),
    ).toMatchObject({ ok: false });
  });
});

describe("defectLabel", () => {
  it("mostra a issue como #número", () => {
    expect(defectLabel("https://github.com/org/repo/issues/1005")).toBe("#1005");
  });

  it("devolve null para URL sem número", () => {
    expect(defectLabel("https://github.com/org/repo")).toBeNull();
    expect(defectLabel(null)).toBeNull();
  });
});

describe("groupByDefect", () => {
  const t = (id: string, org: string, defect: string | null) => ({
    id,
    organization_id: org,
    defect_url: defect,
  });

  // A severidade depende de quantas OUTRAS organizações foram atingidas. Sem
  // contagem por defeito, ela é chute.
  it("conta organizações distintas por defeito", () => {
    const grupos = groupByDefect([
      t("1", "org-a", "u1"),
      t("2", "org-b", "u1"),
      t("3", "org-a", "u1"),
      t("4", "org-c", "u2"),
    ]);

    expect(grupos).toEqual([
      { defectUrl: "u1", tickets: 3, organizations: 2 },
      { defectUrl: "u2", tickets: 1, organizations: 1 },
    ]);
  });

  it("ordena pelo número de organizações, depois de chamados", () => {
    const grupos = groupByDefect([
      t("1", "org-a", "poucos"),
      t("2", "org-a", "poucos"),
      t("3", "org-a", "muitos"),
      t("4", "org-b", "muitos"),
    ]);
    expect(grupos[0].defectUrl).toBe("muitos");
  });

  it("ignora chamados sem defeito", () => {
    expect(groupByDefect([t("1", "org-a", null)])).toEqual([]);
  });

  it("uma lista vazia devolve vazio", () => {
    expect(groupByDefect([])).toEqual([]);
  });
});
