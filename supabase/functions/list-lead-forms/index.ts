/**
 * list-lead-forms
 *
 * Lista formularios de Lead Ads e/ou campos de um formulario especifico.
 *
 * Body (POST):
 *   { pageId: string }                    -> lista formularios da pagina
 *   { pageId: string, formId: string }    -> lista campos do formulario
 *
 * Response (formularios): [{ id, name, status }]
 * Response (campos):      [{ key, label, type }]
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { listLeadForms, getLeadFormFields } from "../_shared/meta-api.ts";
import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(withSentry('list-lead-forms', async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { pageId, formId } = await req.json();

    if (!pageId) {
      return new Response(
        JSON.stringify({ error: "pageId e obrigatorio" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Buscar pagina pelo UUID interno
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

    // Se formId fornecido, buscar campos do formulario
    if (formId) {
      const fields = await getLeadFormFields(formId, page.page_access_token);
      await logRuntime({
        module: "lead",
        action: "list_forms",
        status: "success",
        payloadSnapshot: { pageId, formId, fieldsCount: fields.length },
      });
      return new Response(
        JSON.stringify(fields),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Senao, listar formularios da pagina
    const forms = await listLeadForms(page.page_id, page.page_access_token);
    await logRuntime({
      module: "lead",
      action: "list_forms",
      status: "success",
      payloadSnapshot: { pageId, formsCount: forms.length },
    });
    return new Response(
      JSON.stringify(forms),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[list-lead-forms] Error:", errorMessage);
    await logRuntime({
      module: "lead",
      action: "list_forms",
      status: "error",
      errorMessage,
    });
    return new Response(
      JSON.stringify({ error: errorMessage, detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
