/**
 * Supabase-backed TituloStore — DB adapter behind upsertCanonicalTitulo — and
 * TituloReconcileStore, behind reconcileMissingTitulos.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TituloStore } from "./upsert-titulo.ts";
import { OpenTitulo, TituloReconcileStore } from "./reconcile-titulos.ts";

/**
 * Página da leitura de abertos. 🔴 O PostgREST corta em 1.000 linhas por
 * resposta em silêncio; ler abertos sem paginar esconderia títulos do cálculo
 * da trava (o denominador encolheria) — paginar mantém a conta honesta.
 */
const OPEN_PAGE = 1000;
/**
 * Ids por UPDATE. Uma escrita por lote é a regra; o corte existe só porque
 * `.in("id", …)` vai na URL, e 200 UUIDs (~7,5 KB) ficam longe do limite do
 * gateway. Num lote real fecham-se poucos títulos — isto é uma volta só.
 */
const PAID_CHUNK = 200;

export function supabaseTituloReconcileStore(admin: SupabaseClient): TituloReconcileStore {
  return {
    async listOpenTitulosForClients(organizationId, source, clientIds) {
      const out: OpenTitulo[] = [];
      let after: string | null = null;
      for (;;) {
        let query = admin
          .from("titulos_receber")
          .select("id, external_id, client_id, vencimento")
          .eq("organization_id", organizationId)
          .eq("external_source", source)
          .in("status", ["aberto", "atrasado"])
          .in("client_id", clientIds)
          .order("id", { ascending: true })
          .limit(OPEN_PAGE);
        if (after) query = query.gt("id", after);

        const { data, error } = await query;
        if (error) throw new Error(`listOpenTitulosForClients: ${error.message}`);
        const rows = (data ?? []) as Array<{
          id: string;
          external_id: string | null;
          client_id: string;
          vencimento: string | null;
        }>;
        for (const r of rows) {
          // Sem external_id não há como comparar com a resposta — nunca fecha.
          if (!r.external_id) continue;
          out.push({
            id: r.id,
            externalId: r.external_id,
            clientId: r.client_id,
            vencimento: r.vencimento,
          });
        }
        if (rows.length < OPEN_PAGE) return out;
        after = rows[rows.length - 1].id;
      }
    },

    async markTitulosPaid(organizationId, ids) {
      let changed = 0;
      for (let i = 0; i < ids.length; i += PAID_CHUNK) {
        // O filtro de status repete a condição da leitura, para não reescrever
        // (nem recontar) título que já saiu de aberto entre ler e escrever. E
        // `.select("id")` conta o que mudou de fato — UPDATE sem linha volta 200.
        const { data, error } = await admin
          .from("titulos_receber")
          .update({ status: "pago", pago_em: null })
          .eq("organization_id", organizationId)
          .in("status", ["aberto", "atrasado"])
          .in("id", ids.slice(i, i + PAID_CHUNK))
          .select("id");
        if (error) throw new Error(`markTitulosPaid: ${error.message}`);
        changed += data?.length ?? 0;
      }
      return changed;
    },
  };
}

export function supabaseTituloStore(admin: SupabaseClient): TituloStore {
  return {
    async findOrderIdByExternalId(organizationId, source, orderExternalId) {
      const { data } = await admin
        .from("upsell_orders")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("external_source", source)
        .eq("external_id", orderExternalId)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },

    async findClientIdByExternalId(organizationId, source, clientExternalId) {
      const { data } = await admin
        .from("upsell_clients")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("external_source", source)
        .eq("external_id", clientExternalId)
        .maybeSingle();
      return (data?.id as string | undefined) ?? null;
    },

    async findTituloByExternalId(organizationId, source, externalId) {
      const { data } = await admin
        .from("titulos_receber")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("external_source", source)
        .eq("external_id", externalId)
        .maybeSingle();
      return data ? { id: data.id as string } : null;
    },

    async updateTitulo(id, patch) {
      const { error } = await admin.from("titulos_receber").update(patch).eq("id", id);
      if (error) throw new Error(`updateTitulo: ${error.message}`);
    },

    async createTitulo(row) {
      const { data, error } = await admin
        .from("titulos_receber")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(`createTitulo: ${error.message}`);
      return data.id as string;
    },
  };
}
