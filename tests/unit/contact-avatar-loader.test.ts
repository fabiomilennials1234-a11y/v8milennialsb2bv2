/**
 * contactAvatarLoader — 1 RPC + 1 createSignedUrls por janela, nunca por linha.
 *
 * O dublê é uma CLASSE cujos métodos dependem de `this` (como o supabase-js):
 * se o loader soltasse `client.rpc` ou `storage.from(...).createSignedUrls`
 * numa variável, a chamada quebraria aqui do mesmo jeito que quebra em prod.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  CONTACT_AVATAR_BUCKET,
  CONTACT_AVATAR_URL_CACHE_MS,
  createContactAvatarLoader,
  type ContactAvatarClient,
} from "@/modules/communication/lib/contactAvatarLoader";

type Row = { phone: string; storage_path: string; content_sha256: string };

class FakeBucket {
  calls: Array<{ bucket: string; paths: string[]; expiresIn: number }> = [];
  constructor(private readonly owner: FakeSupabase, private readonly bucket: string) {}
  async createSignedUrls(paths: string[], expiresIn: number) {
    if (!(this instanceof FakeBucket)) throw new TypeError("this perdido");
    this.owner.signCalls.push({ bucket: this.bucket, paths, expiresIn });
    if (this.owner.signError) return { data: null, error: { message: "boom" } };
    return {
      data: paths.map((path) =>
        this.owner.unsignable.has(path)
          ? { path, signedUrl: null, error: "Either the object does not exist or you do not have access to it" }
          : { path, signedUrl: `https://proj.supabase.co/storage/v1/object/sign/${CONTACT_AVATAR_BUCKET}/${path}?token=t${this.owner.signCalls.length}`, error: null }),
      error: null,
    };
  }
}

class FakeSupabase {
  rpcCalls: Array<{ fn: string; args: { p_org: string; p_phones: string[] } }> = [];
  signCalls: Array<{ bucket: string; paths: string[]; expiresIn: number }> = [];
  rows: Record<string, Row[]> = {};
  rpcError: { code?: string; message?: string } | null = null;
  signError = false;
  unsignable = new Set<string>();
  readonly storage = { from: (bucket: string) => new FakeBucket(this, bucket) };

  async rpc(fn: string, args: { p_org: string; p_phones: string[] }) {
    if (!(this instanceof FakeSupabase)) throw new TypeError("this perdido");
    this.rpcCalls.push({ fn, args });
    if (this.rpcError) return { data: null, error: this.rpcError };
    const rows = (this.rows[args.p_org] ?? []).filter((r) => args.p_phones.includes(r.phone));
    return { data: rows, error: null };
  }
}

const ORG = "org-1";
const sha = (c: string) => c.repeat(64);
const path = (n: number) => `${ORG}/avatars/00000000-0000-4000-8000-00000000000${n}.jpg`;

let db: FakeSupabase;
let clock: number;
let loader: ReturnType<typeof createContactAvatarLoader>;

beforeEach(() => {
  vi.useFakeTimers();
  db = new FakeSupabase();
  clock = Date.UTC(2026, 10, 24, 12);
  db.rows[ORG] = [
    { phone: "5511999990001", storage_path: path(1), content_sha256: sha("a") },
    { phone: "5511999990002", storage_path: path(2), content_sha256: sha("b") },
  ];
  loader = createContactAvatarLoader(db as unknown as ContactAvatarClient, { now: () => clock });
});

afterEach(() => {
  vi.useRealTimers();
});

async function flush<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(20);
  return p;
}

describe("contactAvatarLoader", () => {
  it("junta as linhas do mesmo frame: 1 RPC + 1 assinatura", async () => {
    const all = Promise.all(["5511999990001", "5511999990002", "5511999990003", "5511999990001"].map((p) => loader.load(ORG, p)));
    const [a, b, c, a2] = await flush(all);
    expect(db.rpcCalls).toEqual([{ fn: "avatares_das_conversas", args: { p_org: ORG, p_phones: ["5511999990001", "5511999990002", "5511999990003"] } }]);
    expect(db.signCalls).toEqual([{ bucket: "contact-avatars", paths: [path(1), path(2)], expiresIn: 3600 }]);
    expect(a).toMatch(/\/contact-avatars\/org-1\/avatars\/.*1\.jpg\?token=/);
    expect(b).toMatch(/2\.jpg\?token=/);
    expect(c).toBeNull();
    expect(a2).toBe(a);
  });

  it("path@sha assinado fica em cache 55 min; sha novo assina de novo", async () => {
    const first = await flush(loader.load(ORG, "5511999990001"));
    const again = await flush(loader.load(ORG, "5511999990001"));
    expect(again).toBe(first);
    expect(db.rpcCalls).toHaveLength(2); // a RPC é a autorização: sempre roda
    expect(db.signCalls).toHaveLength(1);

    db.rows[ORG][0].content_sha256 = sha("c");
    const changed = await flush(loader.load(ORG, "5511999990001"));
    expect(db.signCalls).toHaveLength(2);
    expect(changed).not.toBe(first);

    clock += CONTACT_AVATAR_URL_CACHE_MS + 1;
    await flush(loader.load(ORG, "5511999990001"));
    expect(db.signCalls).toHaveLength(3);
  });

  it("mais de 500 telefones: RPC em lotes de 500, assinatura única", async () => {
    const phones = Array.from({ length: 501 }, (_, i) => `55119${String(i).padStart(8, "0")}`);
    db.rows[ORG] = [{ phone: phones[500], storage_path: path(3), content_sha256: sha("d") }];
    await flush(Promise.all(phones.map((p) => loader.load(ORG, p))));
    expect(db.rpcCalls.map((c) => c.args.p_phones.length)).toEqual([500, 1]);
    expect(db.signCalls).toHaveLength(1);
  });

  it("duas orgs no mesmo frame: uma RPC por org, uma assinatura", async () => {
    db.rows["org-2"] = [{ phone: "5511999990009", storage_path: "org-2/avatars/x.jpg", content_sha256: sha("e") }];
    const [a, b] = await flush(Promise.all([loader.load(ORG, "5511999990001"), loader.load("org-2", "5511999990009")]));
    expect(db.rpcCalls.map((c) => c.args.p_org)).toEqual([ORG, "org-2"]);
    expect(db.signCalls).toEqual([{ bucket: "contact-avatars", paths: [path(1), "org-2/avatars/x.jpg"], expiresIn: 3600 }]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it("RPC ausente (PGRST202): null e o loader desliga até recarregar", async () => {
    db.rpcError = { code: "PGRST202", message: "Could not find the function" };
    expect(await flush(loader.load(ORG, "5511999990001"))).toBeNull();
    expect(await flush(loader.load(ORG, "5511999990002"))).toBeNull();
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.signCalls).toEqual([]);
  });

  it("42501 (outra org) ou erro de assinatura: null sem desligar", async () => {
    db.rpcError = { code: "42501", message: "forbidden" };
    expect(await flush(loader.load(ORG, "5511999990001"))).toBeNull();
    db.rpcError = null;
    db.signError = true;
    expect(await flush(loader.load(ORG, "5511999990001"))).toBeNull();
    expect(db.rpcCalls).toHaveLength(2);
  });

  it("objeto que o Storage recusa assinar: só aquela linha fica sem foto", async () => {
    db.unsignable.add(path(2));
    const [a, b] = await flush(Promise.all([loader.load(ORG, "5511999990001"), loader.load(ORG, "5511999990002")]));
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it("sem org ou telefone não consulta", async () => {
    expect(await flush(loader.load("", "5511999990001"))).toBeNull();
    expect(await flush(loader.load(ORG, ""))).toBeNull();
    expect(db.rpcCalls).toEqual([]);
  });
});
