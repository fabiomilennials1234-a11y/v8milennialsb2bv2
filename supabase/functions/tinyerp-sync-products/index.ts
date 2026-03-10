/**
 * tinyerp-sync-products
 *
 * Importa/sincroniza produtos do TinyERP para a tabela products do CRM.
 * Pagina pela API de pesquisa de produtos e faz upsert via tinyerp_product_mappings.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getOrgTinyToken, callTinyApi, logTinyOp, getTinyErrorMessage, isTinyNoRecordsError } from "../_shared/tinyerp-utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface TinyProduct {
  id: string;
  nome: string;
  codigo: string;
  preco: number;
  preco_promocional?: number;
  unidade?: string;
  ncm?: string;
  gtin?: string;
  descricao_complementar?: string;
  situacao?: string;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Não autorizado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Usuário não autenticado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: teamMember } = await supabaseAdmin
      .from("team_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!teamMember?.organization_id) {
      return new Response(
        JSON.stringify({ error: "Usuário não vinculado a uma organização" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const orgId = teamMember.organization_id;

    const tokenData = await getOrgTinyToken(supabaseAdmin, orgId);
    if (!tokenData) {
      return new Response(
        JSON.stringify({ error: "TinyERP não conectado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[TinyERP Sync] Starting product sync for org:", orgId);

    let page = 1;
    let hasMore = true;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let itemsFailed = 0;
    let itemsProcessed = 0;
    const maxPages = 50; // Safety limit

    while (hasMore && page <= maxPages) {
      const result = await callTinyApi(tokenData.token, "produtos.pesquisa.php", {
        pesquisa: "",
        pagina: page,
      });

      // TinyERP API v2 returns status_processamento "3" even on success (with status "OK" and data).
      // We check for actual data presence rather than relying on status_processamento.
      const produtos = (result.retorno.produtos as Array<{ produto: TinyProduct }>) || [];
      const hasData = produtos.length > 0;

      if (page === 1) {
        console.log("[TinyERP Sync] Page 1 response:", {
          status: result.retorno.status,
          status_processamento: result.retorno.status_processamento,
          numero_paginas: result.retorno.numero_paginas,
          produtos_count: produtos.length,
        });
      }
      const isStatusOk = result.retorno.status === "OK" || result.retorno.status === "Sucesso";

      if (!hasData && !isStatusOk) {
        // No data and not OK — real error or end of pages
        if (page === 1 && !isTinyNoRecordsError(result)) {
          const errorMsg = getTinyErrorMessage(result) || "Erro ao buscar produtos";
          await logTinyOp(supabaseAdmin, {
            organization_id: orgId,
            operation: "product_import",
            status: "failed",
            error_message: errorMsg,
            initiated_by: "user",
          });
          return new Response(
            JSON.stringify({ error: errorMsg }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        break;
      }

      if (!hasData) {
        // Status OK but no products on this page — we've passed the last page
        hasMore = false;
        break;
      }

      for (const item of produtos) {
        const produto: TinyProduct = item.produto;
        itemsProcessed++;

        try {
          // Check if mapping exists
          const { data: existingMapping } = await supabaseAdmin
            .from("tinyerp_product_mappings")
            .select("id, product_id")
            .eq("organization_id", orgId)
            .eq("tiny_product_id", String(produto.id))
            .maybeSingle();

          const productData = {
            name: produto.nome,
            sku: produto.codigo || null,
            ticket: produto.preco || 0,
            base_unit: produto.unidade || "un",
            type: "unitario" as const,
            organization_id: orgId,
          };

          if (existingMapping) {
            // Update existing product
            await supabaseAdmin
              .from("products")
              .update({
                name: productData.name,
                sku: productData.sku,
                ticket: productData.ticket,
                base_unit: productData.base_unit,
              })
              .eq("id", existingMapping.product_id);

            await supabaseAdmin
              .from("tinyerp_product_mappings")
              .update({ last_synced_at: new Date().toISOString(), tiny_sku: produto.codigo })
              .eq("id", existingMapping.id);

            itemsUpdated++;
          } else {
            // Create new product
            const { data: newProduct, error: insertError } = await supabaseAdmin
              .from("products")
              .insert(productData)
              .select("id")
              .single();

            if (insertError || !newProduct) {
              console.error("[TinyERP Sync] Failed to create product:", insertError);
              itemsFailed++;
              continue;
            }

            // Create mapping
            await supabaseAdmin
              .from("tinyerp_product_mappings")
              .insert({
                organization_id: orgId,
                product_id: newProduct.id,
                tiny_product_id: String(produto.id),
                tiny_sku: produto.codigo || null,
                sync_direction: "from_tiny",
              });

            itemsCreated++;
          }
        } catch (err) {
          console.error("[TinyERP Sync] Error processing product:", produto.id, err);
          itemsFailed++;
        }
      }

      // Check if there are more pages using numero_paginas from API response
      const totalPages = Number(result.retorno.numero_paginas) || 1;
      if (page >= totalPages || produtos.length < 20) {
        hasMore = false;
      } else {
        page++;
        // Rate limit: ~30 req/min → wait 2s between pages
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Update last sync timestamp
    await supabaseAdmin
      .from("tinyerp_connections")
      .update({ last_product_sync_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    // Log the operation
    const status = itemsFailed > 0 && (itemsCreated > 0 || itemsUpdated > 0) ? "partial" : itemsFailed > 0 ? "failed" : "success";

    await logTinyOp(supabaseAdmin, {
      organization_id: orgId,
      operation: "product_import",
      status,
      items_processed: itemsProcessed,
      items_created: itemsCreated,
      items_updated: itemsUpdated,
      items_failed: itemsFailed,
      initiated_by: "user",
    });

    console.log("[TinyERP Sync] Done:", { itemsProcessed, itemsCreated, itemsUpdated, itemsFailed });

    return new Response(
      JSON.stringify({
        success: true,
        items_processed: itemsProcessed,
        items_created: itemsCreated,
        items_updated: itemsUpdated,
        items_failed: itemsFailed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[TinyERP Sync] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro desconhecido" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
