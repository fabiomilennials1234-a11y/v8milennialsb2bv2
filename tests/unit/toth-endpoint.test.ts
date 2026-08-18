/**
 * Tests for modules/integrations/lib/toth-endpoint.ts — a leitura do endereço na
 * tela de conexão do Toth.
 *
 * Isto é UX, não a fronteira de segurança (essa é `_shared/erp/toth-url.ts`, no
 * servidor). O que se trava aqui é a regra da tela: endereço sem TLS não passa
 * sem aceite explícito, e trocar o endereço não pode herdar o aceite anterior.
 */
import { describe, it, expect } from "vitest";
import {
  readTothEndpoint,
  canSubmitTothConnection,
} from "../../src/modules/integrations/lib/toth-endpoint";

describe("readTothEndpoint", () => {
  it("aceita https em host público", () => {
    const r = readTothEndpoint("https://erp.exemplo.com.br/toth/services");
    expect(r.verdict).toBe("ok");
    expect(r.insecure).toBe(false);
    expect(r.host).toBe("erp.exemplo.com.br");
    expect(r.message).toBe("");
  });

  it("marca http como inseguro, mas não como inválido — é o caso real", () => {
    // cafejurere.ddns.net:8080 é o endereço que o cliente tem hoje.
    const r = readTothEndpoint("http://cafejurere.ddns.net:8080/toth/services");
    expect(r.verdict).toBe("inseguro");
    expect(r.insecure).toBe(true);
    expect(r.message).toMatch(/texto claro/);
  });

  it("recusa host que só existe dentro da rede", () => {
    for (const url of [
      "http://localhost:8080/toth/services",
      "https://192.168.0.10/toth",
      "https://10.1.2.3/toth",
      "https://172.16.0.1/toth",
      "https://169.254.169.254/",
      "https://erp.local/toth",
    ]) {
      expect(readTothEndpoint(url).verdict, url).toBe("invalido");
    }
  });

  it("não confunde 172.15 e 172.32 com a faixa privada", () => {
    expect(readTothEndpoint("https://172.15.0.1/toth").verdict).toBe("ok");
    expect(readTothEndpoint("https://172.32.0.1/toth").verdict).toBe("ok");
  });

  it("trata vazio como estado neutro, sem mensagem de erro", () => {
    // Campo intocado não deve gritar com o usuário.
    const r = readTothEndpoint("   ");
    expect(r.verdict).toBe("vazio");
    expect(r.message).toBe("");
  });

  it("recusa texto que não é URL e esquema não-http", () => {
    expect(readTothEndpoint("erp.exemplo.com.br").verdict).toBe("invalido");
    expect(readTothEndpoint("ftp://erp.exemplo.com.br").verdict).toBe("invalido");
  });
});

describe("canSubmitTothConnection", () => {
  const base = { user: "integracao", password: "s3nh4", acceptedInsecure: false };

  it("libera com https e credenciais preenchidas", () => {
    expect(
      canSubmitTothConnection({ ...base, endpoint: "https://erp.exemplo.com.br/toth" }),
    ).toBe(true);
  });

  it("🔒 bloqueia http enquanto o risco não for aceito", () => {
    const endpoint = "http://cafejurere.ddns.net:8080/toth/services";
    expect(canSubmitTothConnection({ ...base, endpoint })).toBe(false);
    expect(canSubmitTothConnection({ ...base, endpoint, acceptedInsecure: true })).toBe(true);
  });

  it("aceite NÃO resgata endereço de rede interna", () => {
    // Consentir com falta de criptografia não é consentir com host inalcançável.
    expect(
      canSubmitTothConnection({
        ...base,
        endpoint: "http://localhost:8080/toth",
        acceptedInsecure: true,
      }),
    ).toBe(false);
  });

  it("exige usuário e senha", () => {
    const endpoint = "https://erp.exemplo.com.br/toth";
    expect(canSubmitTothConnection({ ...base, endpoint, user: "  " })).toBe(false);
    expect(canSubmitTothConnection({ ...base, endpoint, password: "" })).toBe(false);
  });

  it("endereço vazio nunca envia", () => {
    expect(canSubmitTothConnection({ ...base, endpoint: "" })).toBe(false);
  });
});
