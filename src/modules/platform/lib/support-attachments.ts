/**
 * support-attachments — o print que o cliente anexa a um Chamado.
 *
 * O anexo típico é uma captura da tela do CRM. Nela aparecem nome, telefone,
 * empresa e CNPJ dos **leads do nosso cliente** — dado dos clientes dele, do
 * qual somos operadores de LGPD.
 *
 * Por isso o bucket é privado e a leitura sai por URL assinada de vida curta,
 * autorizada no servidor. O `help-media` é público: um link eterno e
 * irrevogável. Não se reusa um bucket público por conveniência (ADR-0018).
 *
 * O caminho começa pelo id do Chamado — é dele que a policy do Storage deriva
 * quem pode ler. E o nome original do arquivo é descartado: `Proposta Fulano da
 * Silva.png` colocaria PII na URL assinada e nos logs do Storage.
 */

export const SUPPORT_ATTACHMENTS_BUCKET = "support-attachments";

/** Uma captura de tela cabe folgada. Um vídeo não é evidência, é um problema. */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Só imagem. Um anexo executável num bucket de suporte é um vetor, não uma
 * evidência — e `text/html` num bucket servido por URL assinada é XSS.
 */
export const ATTACHMENT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type AttachmentCheck = { ok: true } | { ok: false; reason: string };

export function validateAttachment(file: File): AttachmentCheck {
  if (file.size === 0) {
    return { ok: false, reason: "O arquivo está vazio." };
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    const mb = Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024));
    return { ok: false, reason: `O arquivo passa de ${mb} MB.` };
  }
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "Anexe uma imagem (PNG, JPG, WEBP ou GIF)." };
  }
  return { ok: true };
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * `<ticketId>/<uuid>.<ext>`. O primeiro segmento sustenta a autorização; o resto
 * não carrega nada do usuário.
 */
export function attachmentPath(ticketId: string, filename: string): string {
  const ext = extensionOf(filename);
  const name = crypto.randomUUID();
  return ext ? `${ticketId}/${name}.${ext}` : `${ticketId}/${name}`;
}

export function ticketIdFromPath(path: string): string | null {
  const [first, ...rest] = path.split("/");
  return rest.length > 0 && first ? first : null;
}

/** A URL assinada morre em cinco minutos. Se vazar depois disso, é link morto. */
export const SIGNED_URL_TTL_SECONDS = 300;
