import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cachedClientStore } from "../../supabase/functions/_shared/erp/sync/cached-client-store";
import { supabaseClientStore } from "../../supabase/functions/_shared/erp/sync/client-store";
import { deferredEnrichStore } from "../../supabase/functions/_shared/erp/sync/deferred-enrich-store";
import { upsertCanonicalClient } from "../../supabase/functions/_shared/erp/sync/upsert-client";
import type { CanonicalClient } from "../../supabase/functions/_shared/erp/types";

const org = "org-1";
const client: CanonicalClient = {
  externalId: "42", externalRef: null, name: "Cliente de teste", company: null,
  cnpj: "12345678000199", phone: null, email: null, ownerExternalId: "rep-1",
};

// Model the database projection: omitted columns must NOT magically appear in
// the result. A static mocked row hides the missing responsible_id regression.
function database(responsible: string | null) {
  const row: Record<string, unknown> = {
    id: "client-1", organization_id: org, external_source: "toth",
    external_id: client.externalId, external_ref: null, name: client.name,
    company: null, cnpj: client.cnpj, phone: null, email: null,
    erp_owner_external_id: "rep-1", responsible_id: responsible,
  };
  const writes = vi.fn((patch: Record<string, unknown>) => Object.assign(row, patch));
  const admin = {
    from: () => {
      let columns: string[] = [];
      const filters: Array<[string, unknown]> = [];
      const projected = () => filters.every(([k, v]) => row[k] === v)
        ? Object.fromEntries(columns.map(k => [k, row[k] ?? null])) : null;
      const query = {
        select: (value: string) => { columns = value.split(",").map(k => k.trim()); return query; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        order: () => query,
        limit: () => query,
        range: async () => ({ data: projected() ? [projected()] : [], error: null }),
        maybeSingle: async () => ({ data: projected(), error: null }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_key: string, id: string) => {
            if (id === row.id) writes(patch);
            return { error: null };
          },
        }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { admin, writes };
}

describe.each(["cached", "direct"] as const)("%s ERP store — persisted owner reconciliation", kind => {
  async function sync(db: ReturnType<typeof database>, ownerMap: Map<string, string | null>) {
    const direct = supabaseClientStore(db.admin, "toth");
    const inner = kind === "cached" ? await cachedClientStore(db.admin, org, "toth", direct) : direct;
    const deferred = deferredEnrichStore(inner);
    const result = await upsertCanonicalClient(deferred.store, {
      organizationId: org, source: "toth", client, syncMode: "canonical", ownerMap,
    });
    await deferred.flush();
    return result;
  }

  it.each(["member-1", null])("does not rewrite an unchanged mapped owner (%s)", async owner => {
    const db = database(owner);
    expect(await sync(db, new Map([["rep-1", owner]]))).toEqual({ action: "skipped", reason: "no_changes" });
    expect(db.writes).not.toHaveBeenCalled();
  });

  it("applies a changed owner once and skips it on the next invocation", async () => {
    const db = database("member-old");
    const map = new Map([["rep-1", "member-new"]]);
    expect((await sync(db, map)).action).toBe("enriched");
    expect(await sync(db, map)).toEqual({ action: "skipped", reason: "no_changes" });
    expect(db.writes).toHaveBeenCalledExactlyOnceWith({ responsible_id: "member-new" });
  });

  it("does not change an unmapped owner", async () => {
    const db = database("member-curated");
    expect((await sync(db, new Map())).action).toBe("skipped");
    expect(db.writes).not.toHaveBeenCalled();
  });
});
