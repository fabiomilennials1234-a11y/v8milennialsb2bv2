/**
 * `contactAvatarLoader` — foto de perfil do contato WhatsApp, em LOTE.
 *
 * A lista de conversas monta dezenas de linhas no mesmo frame, e cada uma pede
 * a sua foto. Uma ida por linha seria N RPCs + N assinaturas no Storage. O
 * loader junta os pedidos de uma janela (~16 ms, um frame) e faz:
 *
 *   1 RPC `avatares_das_conversas` por org (≤ 500 telefones por chamada) +
 *   1 `createSignedUrls` para todos os paths que ainda não estão assinados.
 *
 * A autorização é do servidor: a RPC só devolve path de quem o chamador pode
 * ver (org + caixa legível) e o Storage só assina o que a policy deixa ler.
 * Path assinado fica em cache por `path@sha` durante 55 min (a URL vale 60):
 * foto trocada muda o sha e invalida sozinha.
 *
 * Falha nunca vira erro de tela: a foto é acessório e o gradiente com a inicial
 * já está desenhado embaixo. RPC ausente (migration não aplicada) desliga o
 * loader até recarregar a página — sem martelar o PostgREST a cada linha.
 */
import { supabase } from "@/integrations/supabase/client";
import { isRpcAbsentError } from "@/lib/rpc-errors";

export const CONTACT_AVATAR_BUCKET = "contact-avatars";
export const CONTACT_AVATAR_BATCH_WINDOW_MS = 16;
export const CONTACT_AVATAR_MAX_PHONES = 500;
export const CONTACT_AVATAR_SIGN_SECONDS = 3600;
export const CONTACT_AVATAR_URL_CACHE_MS = 55 * 60 * 1000;

type RpcError = { code?: string; message?: string } | null;

/**
 * O mínimo do cliente Supabase que o loader usa. As RPCs novas não estão nos
 * tipos gerados (regen fora do escopo), então a forma é declarada aqui.
 * Métodos são chamados SEMPRE pelo objeto (`client.rpc(...)`), nunca soltos:
 * o supabase-js depende do `this`.
 */
export interface ContactAvatarClient {
  rpc(fn: "avatares_das_conversas", args: { p_org: string; p_phones: string[] }): PromiseLike<{
    data: Array<{ phone: string; storage_path: string; content_sha256: string }> | null;
    error: RpcError;
  }>;
  storage: {
    from(bucket: string): {
      createSignedUrls(paths: string[], expiresIn: number): PromiseLike<{
        data: Array<{ path: string | null; signedUrl: string | null; error: string | null }> | null;
        error: RpcError;
      }>;
    };
  };
}

interface Waiter {
  resolve(url: string | null): void;
}

export interface ContactAvatarLoader {
  load(organizationId: string, phone: string): Promise<string | null>;
  /** Só para teste. */
  reset(): void;
}

export function createContactAvatarLoader(
  client: ContactAvatarClient,
  opts: { now?: () => number; windowMs?: number } = {},
): ContactAvatarLoader {
  const now = opts.now ?? (() => Date.now());
  const windowMs = opts.windowMs ?? CONTACT_AVATAR_BATCH_WINDOW_MS;
  let pending = new Map<string, Map<string, Waiter[]>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disabled = false;
  const signed = new Map<string, { url: string; expiresAt: number }>();

  function schedule() {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      const batch = pending;
      pending = new Map();
      void flush(batch);
    }, windowMs);
  }

  async function flush(batch: Map<string, Map<string, Waiter[]>>) {
    const resolved = new Map<string, Map<string, string | null>>();
    const toSign = new Set<string>();
    const pathOf = new Map<string, string>(); // cacheKey → path

    for (const [org, phones] of batch) {
      const out = new Map<string, string | null>();
      resolved.set(org, out);
      const list = [...phones.keys()];
      for (let i = 0; i < list.length; i += CONTACT_AVATAR_MAX_PHONES) {
        const chunk = list.slice(i, i + CONTACT_AVATAR_MAX_PHONES);
        if (disabled) break;
        let rows: Array<{ phone: string; storage_path: string; content_sha256: string }> = [];
        try {
          const { data, error } = await client.rpc("avatares_das_conversas", { p_org: org, p_phones: chunk });
          if (error) {
            if (isRpcAbsentError(error)) disabled = true;
          } else {
            rows = data ?? [];
          }
        } catch {
          rows = [];
        }
        for (const row of rows) {
          if (!row.storage_path) continue;
          const key = `${row.storage_path}@${row.content_sha256}`;
          const hit = signed.get(key);
          if (hit && hit.expiresAt > now()) {
            out.set(row.phone, hit.url);
          } else {
            out.set(row.phone, key);
            pathOf.set(key, row.storage_path);
            toSign.add(key);
          }
        }
      }
    }

    if (toSign.size > 0) {
      const keys = [...toSign];
      const paths = [...new Set(keys.map((k) => pathOf.get(k)!))];
      const urlByPath = new Map<string, string>();
      try {
        const { data, error } = await client.storage
          .from(CONTACT_AVATAR_BUCKET)
          .createSignedUrls(paths, CONTACT_AVATAR_SIGN_SECONDS);
        if (!error) {
          for (const item of data ?? []) {
            if (item.path && item.signedUrl && !item.error) urlByPath.set(item.path, item.signedUrl);
          }
        }
      } catch {
        // sem assinatura = sem foto; o gradiente fica
      }
      const expiresAt = now() + CONTACT_AVATAR_URL_CACHE_MS;
      for (const key of keys) {
        const url = urlByPath.get(pathOf.get(key)!);
        if (url) signed.set(key, { url, expiresAt });
      }
      for (const out of resolved.values()) {
        for (const [phone, value] of out) {
          if (value && toSign.has(value)) out.set(phone, signed.get(value)?.url ?? null);
        }
      }
    }

    for (const [org, phones] of batch) {
      const out = resolved.get(org);
      for (const [phone, waiters] of phones) {
        const url = out?.get(phone) ?? null;
        for (const w of waiters) w.resolve(url);
      }
    }
  }

  return {
    load(organizationId, phone) {
      if (disabled || !organizationId || !phone) return Promise.resolve(null);
      return new Promise<string | null>((resolve) => {
        let phones = pending.get(organizationId);
        if (!phones) {
          phones = new Map();
          pending.set(organizationId, phones);
        }
        const waiters = phones.get(phone) ?? [];
        waiters.push({ resolve });
        phones.set(phone, waiters);
        schedule();
      });
    },
    reset() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = new Map();
      disabled = false;
      signed.clear();
    },
  };
}

/** O loader do app: uma instância, compartilhada por todas as superfícies. */
export const contactAvatarLoader = createContactAvatarLoader(supabase as unknown as ContactAvatarClient);
