/**
 * list-lead-forms
 *
 * Lista os formularios de Lead Ads (leadgen_forms) de uma pagina Meta.
 * Recebe o UUID interno da meta_pages, busca page_id + token no banco,
 * e chama a Graph API para listar os formularios.
 *
 * Body (POST): { pageId: string }   // meta_pages.id (UUID)
 * Response:    [{ id, name, status }]
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { listLeadForms } from "../_shared/meta-api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { pageId } = await req.json();

    if (!pageId) {
      return new Response(
        JSON.stringify({ error: "pageId e obrigatorio" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Buscar pagina pelo UUID interno (meta_pages.id)
    const { data: page, error: pageError } = await supabase
      .from("meta_pages")
      .select("page_id, page_access_token")
      .eq("id", pageId)
      .eq("is_active", true)
      .single();

    if (pageError || !page) {
      return new Response(
        JSON.stringify({ error: "Pagina Meta nao encontrada ou inativa" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Chamar Graph API para listar formularios de lead
    const forms = await listLeadForms(page.page_id, page.page_access_token);

    return new Response(
      JSON.stringify(forms),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[list-lead-forms] Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
