import { describe, it, expect } from "vitest";
import { parseVideoEmbed, resolveVideoUrlInput } from "./video-embed";

const LOOM_ID = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";

describe("parseVideoEmbed — YouTube", () => {
  it("normaliza watch?v= para o embed", () => {
    expect(parseVideoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
  });

  it("normaliza o encurtado youtu.be", () => {
    expect(parseVideoEmbed("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
  });

  it("aceita a URL de embed já pronta (idempotente)", () => {
    expect(parseVideoEmbed("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
  });

  it("normaliza um Short", () => {
    expect(parseVideoEmbed("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });
  });
});

describe("parseVideoEmbed — Loom", () => {
  it("normaliza a URL de compartilhamento", () => {
    expect(parseVideoEmbed(`https://www.loom.com/share/${LOOM_ID}`)).toEqual({
      provider: "loom",
      embedUrl: `https://www.loom.com/embed/${LOOM_ID}`,
    });
  });

  it("aceita a URL de embed já pronta (idempotente)", () => {
    expect(parseVideoEmbed(`https://www.loom.com/embed/${LOOM_ID}`)).toEqual({
      provider: "loom",
      embedUrl: `https://www.loom.com/embed/${LOOM_ID}`,
    });
  });
});

describe("parseVideoEmbed — recusa host fora da allowlist", () => {
  it("recusa Vimeo", () => {
    expect(parseVideoEmbed("https://vimeo.com/123456789")).toBeNull();
  });

  it("recusa um host arbitrário", () => {
    expect(parseVideoEmbed("https://evil.example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  // Impede que sub.youtube.com.evil.com passe como se fosse youtube.
  it("recusa um domínio que só sufixa o host permitido", () => {
    expect(parseVideoEmbed("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoEmbed("https://notloom.com/share/abc")).toBeNull();
  });
});

describe("parseVideoEmbed — entrada vazia ou lixo", () => {
  it("recusa string vazia e só espaços", () => {
    expect(parseVideoEmbed("")).toBeNull();
    expect(parseVideoEmbed("   ")).toBeNull();
  });

  it("recusa texto que não é URL", () => {
    expect(parseVideoEmbed("isto não é uma url")).toBeNull();
    expect(parseVideoEmbed("youtube")).toBeNull();
  });

  it("recusa host permitido sem id extraível", () => {
    expect(parseVideoEmbed("https://www.youtube.com/watch?v=")).toBeNull();
    expect(parseVideoEmbed("https://www.youtube.com/")).toBeNull();
    expect(parseVideoEmbed("https://www.loom.com/share/")).toBeNull();
    expect(parseVideoEmbed("https://www.loom.com/")).toBeNull();
  });

  it("recusa uma rota desconhecida do host permitido", () => {
    expect(parseVideoEmbed("https://www.youtube.com/playlist?list=PL123")).toBeNull();
    expect(parseVideoEmbed("https://www.loom.com/looks/abc")).toBeNull();
  });
});

// ADR-0019: vídeo nunca é HTML cru e nunca carrega esquema perigoso. O parser é
// a fronteira — qualquer coisa que não seja http(s) volta null, mesmo que
// "contenha" um host permitido no corpo.
describe("parseVideoEmbed — esquemas perigosos (segurança)", () => {
  it("recusa javascript:", () => {
    expect(parseVideoEmbed("javascript:alert(1)")).toBeNull();
    expect(parseVideoEmbed("javascript:alert('https://youtube.com/watch?v=x')")).toBeNull();
  });

  it("recusa data:", () => {
    expect(parseVideoEmbed("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(parseVideoEmbed("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
  });

  it("recusa outros esquemas não-http", () => {
    expect(parseVideoEmbed("vbscript:msgbox(1)")).toBeNull();
    expect(parseVideoEmbed("file:///etc/passwd")).toBeNull();
    expect(parseVideoEmbed("ftp://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("recusa esquema disfarçado com espaços/caixa", () => {
    expect(parseVideoEmbed("  javascript:alert(1)")).toBeNull();
    expect(parseVideoEmbed("JavaScript:alert(1)")).toBeNull();
  });
});

// Fatia A2: o resolvedor do campo "URL de vídeo" no form do admin.
describe("resolveVideoUrlInput — campo do form (A2)", () => {
  it("vazio ou só espaços remove o vídeo (value null, ok)", () => {
    expect(resolveVideoUrlInput("")).toEqual({ ok: true, value: null, embed: null });
    expect(resolveVideoUrlInput("   ")).toEqual({ ok: true, value: null, embed: null });
  });

  it("URL allowlisted persiste a origem trimada e expõe o provider", () => {
    expect(resolveVideoUrlInput("  https://youtu.be/dQw4w9WgXcQ  ")).toEqual({
      ok: true,
      value: "https://youtu.be/dQw4w9WgXcQ",
      embed: { provider: "youtube", embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" },
    });
    expect(resolveVideoUrlInput(`https://www.loom.com/share/${LOOM_ID}`)).toEqual({
      ok: true,
      value: `https://www.loom.com/share/${LOOM_ID}`,
      embed: { provider: "loom", embedUrl: `https://www.loom.com/embed/${LOOM_ID}` },
    });
  });

  it("host fora da allowlist recusa (ok false), não persiste", () => {
    expect(resolveVideoUrlInput("https://vimeo.com/123456789")).toEqual({ ok: false });
    expect(resolveVideoUrlInput("isto não é uma url")).toEqual({ ok: false });
    expect(resolveVideoUrlInput("javascript:alert(1)")).toEqual({ ok: false });
  });
});
