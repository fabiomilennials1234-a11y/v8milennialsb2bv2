import { describe, it, expect } from "vitest";
import { validateExternalUrl } from "../../supabase/functions/_shared/url-validator.ts";

/**
 * Guarda de SSRF do `webhook_call` e do nó HTTPS das automações. O alvo é sempre
 * escrito por um membro da org, então o que este arquivo protege é a rede interna
 * do runtime — não o usuário de si mesmo.
 */
describe("validateExternalUrl", () => {
  const blocked = (raw: string) => {
    const r = validateExternalUrl(raw);
    return r.valid === false ? r.reason : `PASSOU (não deveria): ${raw}`;
  };

  it("libera um host público normal", () => {
    const r = validateExternalUrl("https://api.exemplo.com/webhook?x=1");
    expect(r.valid).toBe(true);
  });

  it("bloqueia protocolo que não é http(s)", () => {
    expect(blocked("file:///etc/passwd")).toMatch(/protocol/i);
    expect(blocked("gopher://exemplo.com/")).toMatch(/protocol/i);
  });

  it("bloqueia loopback e host nomeado", () => {
    expect(blocked("http://localhost/")).toMatch(/host/i);
    expect(blocked("http://127.0.0.1/")).toMatch(/host|Private/i);
    expect(blocked("http://metadata.google.internal/")).toMatch(/host/i);
  });

  it("bloqueia as faixas privadas em IPv4", () => {
    for (const ip of ["10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254", "0.0.0.1"]) {
      expect(blocked(`https://${ip}/`)).toMatch(/Private|host/i);
    }
  });

  // ── Regressões: tudo abaixo PASSAVA antes do conserto ──────────────────────

  it("bloqueia loopback em IPv6 — o Set guardava `[::1]`, mas o host chega sem colchetes", () => {
    expect(blocked("https://[::1]/")).toMatch(/host|Private/i);
    expect(blocked("https://[::1]:8443/")).toMatch(/host|Private/i);
  });

  it("bloqueia o endpoint de metadados via IPv4 mapeado em IPv6", () => {
    expect(blocked("https://[::ffff:169.254.169.254]/")).toMatch(/Private/i);
    expect(blocked("https://[::ffff:a9fe:a9fe]/")).toMatch(/Private/i);
  });

  it("bloqueia rede privada via IPv4 mapeado em IPv6", () => {
    expect(blocked("https://[::ffff:10.0.0.1]/")).toMatch(/Private/i);
    expect(blocked("https://[::ffff:192.168.0.1]/")).toMatch(/Private/i);
  });

  it("bloqueia link-local e unique-local em IPv6", () => {
    expect(blocked("https://[fe80::1]/")).toMatch(/Private/i);
    expect(blocked("https://[fd00::1]/")).toMatch(/Private/i);
    expect(blocked("https://[fc00::1]/")).toMatch(/Private/i);
  });

  it("recusa IPv6 com zone id", () => {
    // O próprio parser de `URL` rejeita a sintaxe, então nem chega ao teste de faixa.
    // Bloqueio é bloqueio — o `isPrivateIpv6` limpa o zone id de qualquer forma, para
    // o caso de um runtime mais permissivo deixar passar.
    expect(validateExternalUrl("https://[fe80::1%25eth0]/").valid).toBe(false);
  });

  it("não confunde um host IPv6 público com um privado", () => {
    expect(validateExternalUrl("https://[2606:4700:4700::1111]/").valid).toBe(true);
  });
});
