/**
 * Espelhamento do avatar do interlocutor para o nosso storage.
 *
 * ─── POR QUE ESPELHAR ───────────────────────────────────────────────────────
 *
 *   A URL que a Meta manda em `message.visitor.picture` é ASSINADA E TEMPORÁRIA.
 *   Medido no primeiro payload real (2026-08-17): `oe=6A890279` — expira em ~104
 *   horas. Guardar a URL não é guardar a foto: em quatro dias todo avatar do
 *   inbox vira ícone quebrado, e o sintoma não aponta para lugar nenhum. Quem
 *   olhasse o banco veria a coluna preenchida e concluiria que está tudo certo.
 *
 * ─── E POR QUE ISTO NUNCA PODE DERRUBAR O INBOUND ───────────────────────────
 *
 *   Avatar é decoração; a mensagem é o produto. Toda decisão aqui é enviesada
 *   para "na dúvida, passa sem foto": timeout curto, teto de tamanho, tipo
 *   conferido, e QUALQUER falha devolve `null` — o chamador segue com a URL
 *   original da Meta, que ao menos funciona pelos próximos dias.
 *
 *   Um webhook que falha por causa de uma imagem perde a MENSAGEM. É a mesma
 *   assimetria de custo que governa `notificame-inbound.ts`.
 */

/** Avatar de perfil tem alguns KB. 2 MB é folga generosa, não expectativa. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** Depois disto, a foto é re-baixada — o perfil pode ter mudado. */
export const AVATAR_MAX_AGE_DAYS = 14;

/** Corta o download que passar do teto, mesmo sem `content-length` declarado. */
const DOWNLOAD_TIMEOUT_MS = 6_000;

/**
 * Caminho determinístico do avatar no bucket.
 *
 * Determinístico é o que permite REUSAR o objeto: sem isso, cada mensagem
 * recebida acumularia um arquivo novo do mesmo rosto.
 *
 * ⚠️ O id vem do fornecedor e é dado de terceiro. `..` e `/` são neutralizados
 * porque um id malicioso escreveria fora do prefixo da org — o bucket é
 * compartilhado por todos os tenants.
 */
export function avatarStoragePath(
  organizationId: string,
  channelType: string,
  externalUserId: string,
): string {
  const seguro = externalUserId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "sem_id";
  const canal = channelType.replace(/[^a-z]/gi, "").toLowerCase() || "social";
  return `notificame/avatars/${organizationId}/${canal}_${seguro}.jpg`;
}

/** O que veio do CDN vale a pena guardar? */
export function isAcceptableAvatar(
  contentType: string | null,
  contentLength: number | null,
): boolean {
  if (!contentType || !contentType.toLowerCase().startsWith("image/")) return false;
  // `null` = o CDN não declarou. Aceita e deixa o teto ser aplicado na leitura:
  // recusar aqui perderia avatar por omissão de cabeçalho.
  if (contentLength !== null && contentLength > AVATAR_MAX_BYTES) return false;
  return true;
}

/** Já temos cópia boa, ou vale re-baixar? */
export function shouldRefreshAvatar(
  espelhadoEm: Date | null,
  agora: Date,
  maxAgeDays: number = AVATAR_MAX_AGE_DAYS,
): boolean {
  if (!espelhadoEm || Number.isNaN(espelhadoEm.getTime())) return true;
  const idadeDias = (agora.getTime() - espelhadoEm.getTime()) / 86_400_000;
  return idadeDias >= maxAgeDays;
}

interface StorageLike {
  storage: {
    from(bucket: string): {
      list(
        prefix: string,
        options: { search: string; limit: number },
      ): Promise<{ data: { name: string; updated_at?: string }[] | null; error: unknown }>;
      upload(
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ): Promise<{ error: unknown }>;
      getPublicUrl(path: string): { data: { publicUrl: string } | null };
    };
  };
}

/**
 * Baixa o avatar e devolve a URL PERMANENTE no nosso storage — ou `null`.
 *
 * `null` NUNCA é erro do chamador: significa "siga com o que você já tinha".
 */
export async function mirrorContactAvatar(params: {
  supabase: StorageLike;
  organizationId: string;
  channelType: string;
  externalUserId: string;
  sourceUrl: string | null;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const { supabase, organizationId, channelType, externalUserId, sourceUrl } = params;
  if (!sourceUrl?.trim()) return null;

  const fetchImpl = params.fetchImpl ?? fetch;
  const agora = params.now ?? new Date();
  const path = avatarStoragePath(organizationId, channelType, externalUserId);
  const bucket = supabase.storage.from("media");

  try {
    // Já temos cópia recente? Uma listagem é mais barata que um download, e o
    // avatar muda raramente.
    const pasta = path.slice(0, path.lastIndexOf("/"));
    const arquivo = path.slice(path.lastIndexOf("/") + 1);
    const { data: existentes } = await bucket.list(pasta, { search: arquivo, limit: 1 });
    const existente = existentes?.find((o) => o.name === arquivo);

    if (existente) {
      const espelhadoEm = existente.updated_at ? new Date(existente.updated_at) : null;
      if (!shouldRefreshAvatar(espelhadoEm, agora)) {
        return bucket.getPublicUrl(path).data?.publicUrl ?? null;
      }
    }

    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), DOWNLOAD_TIMEOUT_MS);
    let resposta: Response;
    try {
      resposta = await fetchImpl(sourceUrl, { signal: controle.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!resposta.ok) return null;

    const contentType = resposta.headers.get("content-type");
    const declarado = resposta.headers.get("content-length");
    if (!isAcceptableAvatar(contentType, declarado ? Number(declarado) : null)) return null;

    const bytes = new Uint8Array(await resposta.arrayBuffer());
    // O teto de novo, agora sobre o que REALMENTE veio: `content-length` é
    // declaração do servidor, não fato.
    if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_MAX_BYTES) return null;

    const { error } = await bucket.upload(path, bytes, {
      contentType: contentType ?? "image/jpeg",
      upsert: true,
    });
    if (error) return null;

    return bucket.getPublicUrl(path).data?.publicUrl ?? null;
  } catch {
    // Rede, timeout, storage fora do ar, id esquisito: nada disso pode custar a
    // mensagem. O chamador segue com a URL da Meta.
    return null;
  }
}
