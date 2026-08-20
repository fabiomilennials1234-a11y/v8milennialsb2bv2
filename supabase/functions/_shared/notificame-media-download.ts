/**
 * notificame-media-download — baixa o arquivo que só o fornecedor alcança.
 *
 * ─── O DEFEITO QUE ISTO FECHA ───────────────────────────────────────────────
 *
 * O CDN do Instagram entrega aberto: `GET ig_messaging_cdn/?asset_id=…` devolve
 * 206 sem credencial nenhuma, e foi com ele que o espelhamento nasceu.
 *
 * O do WhatsApp oficial NÃO. Medido em 2026-08-20, no primeiro áudio real
 * recebido na Chique:
 *
 *   GET lookaside.fbsbx.com/whatsapp_business/attachments/?mid=… → 401
 *
 * Sem este caminho, a mídia recebida no canal oficial fica com a URL original,
 * que o navegador também não consegue abrir — e a conversa mostra
 * "Não foi possível reproduzir o áudio" e um retângulo cinza no lugar da foto.
 *
 * A doc do fornecedor chama isto de "Fazer download de um arquivo criptografado".
 *
 * ⚠️ A FORMA DA RESPOSTA NÃO FOI MEDIDA — a doc mostra uma IMAGEM dela, não o
 * corpo. Por isso aceita os dois desfechos plausíveis: binário direto, ou JSON
 * com o conteúdo em base64. O que não for reconhecido devolve `null`, e o
 * chamador fica com a URL original em vez de um arquivo inventado.
 */

/** A rota do download autenticado. `v1`, e não `v2` como o resto do canal. */
const CAMINHO = "/v1/channels/whatsapp/media";

export interface DownloadDeps {
  baseUrl: string;
  subaccountToken: string;
  /** O id do canal no fornecedor — o mesmo `from` das mensagens. */
  channelId: string;
  fetchImpl?: typeof fetch;
}

/** Extrai bytes de um corpo em base64, aceitando `data:` URI. */
function bytesDeBase64(valor: string): Uint8Array | null {
  const limpo = valor.includes(",") && valor.startsWith("data:")
    ? valor.slice(valor.indexOf(",") + 1)
    : valor;
  try {
    const bin = atob(limpo.trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.byteLength > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Baixa pelo fornecedor. Devolve uma `Response` pronta para quem espelha, ou
 * `null` quando não deu — nunca lança: mídia não pode custar a mensagem.
 */
export async function baixarMidiaPeloFornecedor(
  url: string,
  mimeDeclarado: string | null,
  deps: DownloadDeps,
): Promise<Response | null> {
  const buscar = deps.fetchImpl ?? fetch;

  try {
    const r = await buscar(`${deps.baseUrl}${CAMINHO}`, {
      method: "POST",
      headers: {
        "X-Api-Token": deps.subaccountToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: deps.channelId,
        // ⚠️ `"whatsapp"` LITERAL, e não o telefone de ninguém. É o único
        // envelope do contrato em que `to` não é destinatário — aqui ele nomeia
        // o CANAL de onde o arquivo veio. Ver a doc, seção do download.
        to: "whatsapp",
        contents: [
          {
            type: "file",
            fileUrl: url,
            ...(mimeDeclarado ? { fileMimeType: mimeDeclarado } : {}),
          },
        ],
      }),
    });

    if (!r.ok) return null;

    const tipo = (r.headers.get("content-type") ?? "").toLowerCase();

    // Caminho A: binário direto. É o que a imagem da doc sugere.
    if (!tipo.includes("json")) {
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength === 0) return null;
      return new Response(bytes.buffer as ArrayBuffer, {
        status: 200,
        headers: { "content-type": tipo || mimeDeclarado || "application/octet-stream" },
      });
    }

    // Caminho B: JSON com base64. Os nomes de campo são tentativa — o contrato
    // não foi medido, e um campo desconhecido devolve `null` em vez de lixo.
    const corpo = await r.json().catch(() => null) as Record<string, unknown> | null;
    if (!corpo) return null;

    const candidato = ["base64", "data", "file", "content", "media"]
      .map((k) => corpo[k])
      .find((v) => typeof v === "string" && v.length > 32) as string | undefined;
    if (!candidato) return null;

    const bytes = bytesDeBase64(candidato);
    if (!bytes) return null;

    const mime = typeof corpo.mimeType === "string"
      ? corpo.mimeType
      : typeof corpo.fileMimeType === "string"
      ? corpo.fileMimeType
      : mimeDeclarado ?? "application/octet-stream";

    return new Response(bytes.buffer as ArrayBuffer, {
      status: 200,
      headers: { "content-type": mime },
    });
  } catch {
    return null;
  }
}
