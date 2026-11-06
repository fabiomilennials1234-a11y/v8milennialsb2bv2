// @vitest-environment node
/**
 * Atribuição enviada ao Cal.com (public/lp/_shared/cal-metadata.js). O script é clássico, servido sem bundler; aqui
 * ele roda num contexto isolado, como o navegador o recebe. O n8n lê esses campos de `payload.metadata`. O teto de 500
 * caracteres por valor é o da API v2 do Cal, mantido como defesa; dado pessoal na query de `pagina` iria parar no Cal.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Meta = Record<string, string>;
type Api = {
  MAX_VALUE: number;
  build(input: Record<string, string | undefined>): Meta;
  toConfig(meta: Meta): Record<string, string>;
  toQuery(meta: Meta): string;
  withQuery(base: string, meta: Meta): string;
};

const source = fs.readFileSync(path.resolve(__dirname, "../../public/lp/_shared/cal-metadata.js"), "utf8");
const context = vm.createContext({ URL, encodeURIComponent });
vm.runInContext(source, context);
const api = (context as unknown as { TorqueCalMetadata: Api }).TorqueCalMetadata;
/** Objetos do contexto isolado têm outro protótipo; o JSON os traz para cá. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const build = (input: Record<string, string | undefined>) => plain(api.build(input));

const PAGE = "https://torquecrm.com.br/lp/crm-b2b/";

describe("build", () => {
  it("monta só os campos lidos pelo n8n, com a UTM da URL", () => {
    expect(
      build({
        lp: "crm-b2b",
        url: `${PAGE}?utm_source=meta&utm_medium=cpc&utm_campaign=c1&utm_content=a&utm_term=t#agendar`,
        referrer: "https://www.google.com/search?q=crm",
        fbp: "fb.1.1.2",
        fbc: "fb.1.1.ABC",
      }),
    ).toEqual({
      lp: "crm-b2b",
      pagina: `${PAGE}?utm_source=meta&utm_medium=cpc&utm_campaign=c1&utm_content=a&utm_term=t`,
      referrer: "https://www.google.com/search",
      utm_source: "meta",
      utm_medium: "cpc",
      utm_campaign: "c1",
      utm_content: "a",
      utm_term: "t",
      fbp: "fb.1.1.2",
      fbc: "fb.1.1.ABC",
    });
  });

  it.each(["", "   ", undefined])("nunca envia valor vazio (%j)", (empty) => {
    const meta = build({ lp: "x", url: `${PAGE}?utm_source=&utm_term=%20`, referrer: empty, fbp: empty, fbc: empty });
    expect(Object.keys(meta).sort()).toEqual(["lp", "pagina"]);
  });

  it("não leva dado pessoal da URL nem do referrer", () => {
    const meta = build({
      lp: "x",
      url: `${PAGE}?email=ana@x.test&nome=Ana&telefone=48984334050&utm_source=meta&fbclid=ABC`,
      referrer: "https://site.test/form?email=ana@x.test",
    });
    expect(meta.pagina).toBe(`${PAGE}?utm_source=meta&fbclid=ABC`);
    expect(meta.referrer).toBe("https://site.test/form");
    expect(JSON.stringify(meta)).not.toMatch(/ana|48984334050/i);
  });

  it("URL inválida não derruba: fica sem pagina e sem referrer", () => {
    expect(build({ lp: "x", url: "não é url", referrer: "android-app://x y" })).toEqual({ lp: "x" });
  });

  it.each(["android-app://com.google.android.gm/", "android-app://com.facebook.katana/", "about:blank", "file:///a/b"])(
    "referrer que não é http fica de fora, sem virar lixo (%s)",
    (referrer) => {
      expect(build({ lp: "x", url: PAGE, referrer }).referrer).toBeUndefined();
    },
  );
});

describe("limite de 500 caracteres por valor", () => {
  it("corta a query de pagina inteira por parâmetro, sem quebrar o caminho", () => {
    const fbclid = "A".repeat(600);
    const meta = build({ lp: "x", url: `${PAGE}?utm_source=meta&fbclid=${fbclid}` });
    expect(meta.pagina).toBe(`${PAGE}?utm_source=meta`);
  });

  it("caminho longo demais é cortado numa barra", () => {
    const segment = "b".repeat(90);
    const url = `https://torquecrm.com.br/${Array.from({ length: 8 }, () => segment).join("/")}/fim`;
    const pagina = build({ lp: "x", url }).pagina!;
    expect(pagina.length).toBeLessThanOrEqual(api.MAX_VALUE);
    expect(url.startsWith(pagina)).toBe(true);
    expect(pagina.endsWith("/")).toBe(true);
  });

  it("identificador longo sai inteiro ou não sai: pedaço de fbc não casa na Meta", () => {
    const meta = build({ lp: "x", fbp: "f".repeat(501), fbc: "c".repeat(500) });
    expect(meta).toEqual({ lp: "x", fbc: "c".repeat(500) });
  });

  it("UTM longa é cortada no limite", () => {
    expect(build({ lp: "x", url: `${PAGE}?utm_campaign=${"c".repeat(700)}` }).utm_campaign).toHaveLength(api.MAX_VALUE);
  });

  it("corte no limite não parte emoji: o link segue codificável", () => {
    const utm = `${"c".repeat(499)}😀`;
    const meta = build({ lp: "x", url: `${PAGE}?utm_campaign=${encodeURIComponent(utm)}` });
    expect(meta.utm_campaign).toBe("c".repeat(499));
    expect(() => api.withQuery("https://cal.com/gabriel/30min", meta)).not.toThrow();
  });

  it("nenhum valor passa do limite", () => {
    const long = "z".repeat(900);
    const meta = build({ lp: long, url: `${PAGE}?utm_source=${long}&gclid=${long}`, referrer: `https://a.test/${long}`, fbp: long, fbc: long });
    for (const value of Object.values(meta)) expect(value.length).toBeLessThanOrEqual(api.MAX_VALUE);
  });
});

describe("formatos para o Cal", () => {
  const meta = { lp: "crm-b2b", pagina: `${PAGE}?utm_source=a&b=ç` };

  it("config do embed", () => {
    expect(plain(api.toConfig(meta))).toEqual({ "metadata[lp]": "crm-b2b", "metadata[pagina]": meta.pagina });
  });

  it("query do link direto, com o valor codificado", () => {
    expect(api.toQuery(meta)).toBe(`metadata[lp]=crm-b2b&metadata[pagina]=${encodeURIComponent(meta.pagina)}`);
  });

  it("link direto volta aos mesmos valores no leitor de URL", () => {
    const url = new URL(api.withQuery("https://cal.com/gabriel/30min", meta));
    expect(url.pathname).toBe("/gabriel/30min");
    expect(url.searchParams.get("metadata[pagina]")).toBe(meta.pagina);
  });

  it("sem campo, o link fica limpo", () => {
    expect(api.withQuery("https://cal.com/gabriel/30min", plain({}))).toBe("https://cal.com/gabriel/30min");
  });
});
