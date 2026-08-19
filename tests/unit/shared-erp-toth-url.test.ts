/**
 * Tests for _shared/erp/toth-url.ts — guarda anti-SSRF da base_url do ERP
 * on-premise. Esta é a superfície de risco nova que Omie e Tiny não têm: a URL
 * de destino vem do usuário. Cada caso abaixo é um alvo que a Edge Function não
 * pode ser convencida a chamar.
 */
import { describe, it, expect } from "vitest";
import { assertSafeErpBaseUrl, UnsafeErpUrlError } from "../../supabase/functions/_shared/erp/toth-url";

const reject = (url: string) => () => assertSafeErpBaseUrl(url);

describe("assertSafeErpBaseUrl — alvos internos", () => {
  it("recusa loopback por nome e por IP", () => {
    expect(reject("https://localhost:8080/toth/services")).toThrow(UnsafeErpUrlError);
    expect(reject("https://127.0.0.1/toth/services")).toThrow(UnsafeErpUrlError);
    expect(reject("https://127.1.2.3/toth")).toThrow(UnsafeErpUrlError);
  });

  it("recusa o endpoint de metadata da nuvem", () => {
    // O alvo clássico de SSRF: devolve credencial de instância.
    expect(reject("https://169.254.169.254/latest/meta-data/")).toThrow(UnsafeErpUrlError);
    expect(reject("https://metadata.google.internal/")).toThrow(UnsafeErpUrlError);
  });

  it("recusa as três faixas privadas de IPv4", () => {
    expect(reject("https://10.0.0.5/toth")).toThrow(UnsafeErpUrlError);
    expect(reject("https://172.16.4.1/toth")).toThrow(UnsafeErpUrlError);
    expect(reject("https://172.31.255.254/toth")).toThrow(UnsafeErpUrlError);
    expect(reject("https://192.168.1.10/toth")).toThrow(UnsafeErpUrlError);
  });

  it("aceita 172.15 e 172.32 — vizinhos de fora da faixa 172.16/12", () => {
    expect(() => assertSafeErpBaseUrl("https://172.15.0.1/toth")).not.toThrow();
    expect(() => assertSafeErpBaseUrl("https://172.32.0.1/toth")).not.toThrow();
  });

  it("recusa loopback IPv6, inclusive na forma mapeada de IPv4", () => {
    expect(reject("https://[::1]/toth")).toThrow(UnsafeErpUrlError);
    expect(reject("https://[fd00::1]/toth")).toThrow(UnsafeErpUrlError);
    expect(reject("https://[fe80::1]/toth")).toThrow(UnsafeErpUrlError);
    // Sem desembrulhar o ::ffff:, este passaria pela checagem v6. E o parser de
    // URL reescreve a forma decimal em hexadecimal, então as duas grafias
    // precisam ser recusadas.
    expect(reject("https://[::ffff:127.0.0.1]/toth")).toThrow(UnsafeErpUrlError);
    expect(reject("https://[::ffff:7f00:1]/toth")).toThrow(UnsafeErpUrlError);
    expect(reject("https://[::ffff:c0a8:1]/toth")).toThrow(UnsafeErpUrlError); // 192.168.0.1
  });

  it("recusa sufixos que só existem dentro de uma rede", () => {
    expect(reject("https://erp.local/toth")).toThrow(UnsafeErpUrlError);
    expect(reject("https://erp.internal/toth")).toThrow(UnsafeErpUrlError);
  });
});

describe("assertSafeErpBaseUrl — protocolo e credencial", () => {
  it("recusa http:// por padrão", () => {
    expect(reject("http://erp.exemplo.com.br/toth/services")).toThrow(/https:\/\//);
  });

  it("recusa usuário e senha embutidos na URL", () => {
    expect(reject("https://user:pass@erp.exemplo.com.br/toth")).toThrow(UnsafeErpUrlError);
  });

  it("recusa string vazia e URL sem esquema", () => {
    expect(reject("")).toThrow(UnsafeErpUrlError);
    expect(reject("erp.exemplo.com.br/toth")).toThrow(UnsafeErpUrlError);
  });
});

describe("assertSafeErpBaseUrl — normalização", () => {
  it("aceita host público com https e remove barra final", () => {
    const url = assertSafeErpBaseUrl("https://erp.cafejurere.com.br/toth/services/");
    expect(url.toString()).toBe("https://erp.cafejurere.com.br/toth/services");
  });

  it("descarta query e fragmento — o client monta os seus", () => {
    const url = assertSafeErpBaseUrl("https://erp.exemplo.com.br/toth?token=vazado#x");
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  it("preserva porta não padrão", () => {
    const url = assertSafeErpBaseUrl("https://erp.exemplo.com.br:8443/toth/services");
    expect(url.port).toBe("8443");
  });
});

describe("assertSafeErpBaseUrl — as duas permissões são independentes", () => {
  // É o caso REAL da Café Jurerê: host público de DDNS, sem TLS. Ceder o
  // transporte não pode ceder a rede junto.
  it("allowHttp aceita http em host público", () => {
    const url = assertSafeErpBaseUrl("http://cafejurere.ddns.net:8080/toth/services", {
      allowHttp: true,
    });
    expect(url.toString()).toBe("http://cafejurere.ddns.net:8080/toth/services");
  });

  it("allowHttp NÃO abre host interno — a guarda de SSRF continua fechada", () => {
    const insecure = { allowHttp: true };
    expect(() => assertSafeErpBaseUrl("http://169.254.169.254/", insecure)).toThrow(
      UnsafeErpUrlError,
    );
    expect(() => assertSafeErpBaseUrl("http://10.0.0.5/toth", insecure)).toThrow(
      UnsafeErpUrlError,
    );
    expect(() => assertSafeErpBaseUrl("http://localhost:8080/toth", insecure)).toThrow(
      UnsafeErpUrlError,
    );
  });

  it("allowPrivateHosts sozinho NÃO libera http", () => {
    expect(() =>
      assertSafeErpBaseUrl("http://localhost:8080/toth", { allowPrivateHosts: true }),
    ).toThrow(/https:\/\//);
  });

  it("as duas juntas cobrem o desenvolvimento local", () => {
    const url = assertSafeErpBaseUrl("http://localhost:8080/toth/services", {
      allowHttp: true,
      allowPrivateHosts: true,
    });
    expect(url.toString()).toBe("http://localhost:8080/toth/services");
  });
});
