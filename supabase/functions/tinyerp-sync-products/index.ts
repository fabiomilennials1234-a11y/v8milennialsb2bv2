/**
 * tinyerp-sync-products
 *
 * Importa/sincroniza produtos do TinyERP para a tabela products do CRM.
 * Pagina pela API de pesquisa de produtos e faz upsert via tinyerp_product_mappings.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { getOrgTinyToken, callTinyApi, logTinyOp } from "../_shared/tinyerp-utils.ts";

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

      if (result.retorno.status_processamento === "3") {
        // No more products or error
        if (page === 1) {
          const errorMsg = result.retorno.erros?.[0]?.erro || "Erro ao buscar produtos";
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

      const produtos = result.retorno.produtos || [];
      if (produtos.length === 0) {
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

      // TinyERP returns max 20 per page
      if (produtos.length < 20) {
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
