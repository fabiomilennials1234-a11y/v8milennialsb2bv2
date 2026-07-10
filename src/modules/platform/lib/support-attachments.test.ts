import { describe, it, expect } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME_TYPES,
  SUPPORT_ATTACHMENTS_BUCKET,
  attachmentPath,
  ticketIdFromPath,
  validateAttachment,
} from "./support-attachments";

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) =>
  ({ name: "print.png", type: "image/png", size: 1024, ...over }) as File;

describe("validateAttachment", () => {
  it("aceita um png pequeno", () => {
    expect(validateAttachment(file())).toEqual({ ok: true });
  });

  it("aceita os tipos permitidos", () => {
    for (const type of ATTACHMENT_MIME_TYPES) {
      expect(validateAttachment(file({ type }))).toEqual({ ok: true });
    }
  });

  // Um anexo executável num bucket de suporte é um vetor, não uma evidência.
  it("recusa um tipo fora da lista", () => {
    expect(validateAttachment(file({ type: "application/x-msdownload" }))).toMatchObject({
      ok: false,
    });
    expect(validateAttachment(file({ type: "text/html" }))).toMatchObject({ ok: false });
  });

  it("recusa arquivo grande demais", () => {
    expect(validateAttachment(file({ size: ATTACHMENT_MAX_BYTES + 1 }))).toMatchObject({
      ok: false,
    });
  });

  it("aceita exatamente no limite", () => {
    expect(validateAttachment(file({ size: ATTACHMENT_MAX_BYTES }))).toEqual({ ok: true });
  });

  it("recusa arquivo vazio", () => {
    expect(validateAttachment(file({ size: 0 }))).toMatchObject({ ok: false });
  });

  it("a mensagem de erro diz o que fazer", () => {
    const r = validateAttachment(file({ size: ATTACHMENT_MAX_BYTES + 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/MB/);
  });
});

describe("attachmentPath", () => {
  const TID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

  // O primeiro segmento é o chamado: é dele que a policy do Storage deriva quem
  // pode ler. Sem isso, a autorização não teria em que se apoiar.
  it("começa pelo id do chamado", () => {
    expect(attachmentPath(TID, "print.png").startsWith(`${TID}/`)).toBe(true);
  });

  it("preserva a extensão", () => {
    expect(attachmentPath(TID, "print.PNG")).toMatch(/\.png$/);
  });

  // O nome do arquivo do usuário pode ser `Proposta Fulano da Silva.png` — PII
  // no caminho, que aparece na URL assinada e nos logs do Storage.
  it("descarta o nome original do arquivo", () => {
    const path = attachmentPath(TID, "Proposta Fulano da Silva.png");
    expect(path).not.toContain("Fulano");
    expect(path).not.toContain(" ");
  });

  it("dois uploads do mesmo arquivo não colidem", () => {
    expect(attachmentPath(TID, "print.png")).not.toBe(attachmentPath(TID, "print.png"));
  });

  it("um arquivo sem extensão não vira caminho com ponto solto", () => {
    expect(attachmentPath(TID, "captura")).not.toMatch(/\.$/);
  });
});

describe("ticketIdFromPath", () => {
  it("extrai o chamado do caminho", () => {
    expect(ticketIdFromPath("abc/def.png")).toBe("abc");
  });

  it("devolve null para caminho sem pasta", () => {
    expect(ticketIdFromPath("solto.png")).toBeNull();
    expect(ticketIdFromPath("")).toBeNull();
  });
});

describe("SUPPORT_ATTACHMENTS_BUCKET", () => {
  // `help-media` é público: um link eterno e irrevogável. Um print de tela do
  // CRM contém PII dos leads do nosso cliente.
  it("não é o bucket público da central de ajuda", () => {
    expect(SUPPORT_ATTACHMENTS_BUCKET).toBe("support-attachments");
    expect(SUPPORT_ATTACHMENTS_BUCKET).not.toBe("help-media");
  });
});
