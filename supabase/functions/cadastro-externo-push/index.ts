/**
 * cadastro-externo-push
 *
 * Receives client data from the CRM modal and pushes it to the external
 * Sistema Millennials API for automatic client registration.
 *
 * Env vars:
 *   CADASTRO_EXTERNO_API_KEY — Bearer token for the external API
 *   CADASTRO_EXTERNO_URL     — Base URL (e.g. https://xxx.supabase.co/functions/v1/api-v1)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Product name mapping: CRM product name → external API slug
const PRODUCT_SLUG_MAP: Record<string, string> = {
  "millennials growth": "millennials-growth",
  "millennials outbound": "millennials-outbound",
  "millennials paddock": "millennials-paddock",
  "torque crm": "torque-crm",
  "millennials hunting": "millennials-hunting",
};

function mapProductNameToSlug(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  // Exact match first
  if (PRODUCT_SLUG_MAP[normalized]) return PRODUCT_SLUG_MAP[normalized];
  // Partial match
  for (const [key, slug] of Object.entries(PRODUCT_SLUG_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) return slug;
  }
  return null;
}

interface PushPayload {
  pipe_proposta_id: string;
  nome_cliente: string;
  razao_social: string;
  cnpj: string;
  cpf?: string;
  nicho: string;
  observacoes_gestor: string;
  investimento_previsto: number;
  comissao_vendas_percent: number;
  data_entrada: string;
  duracao_contrato_meses: number;
  dia_vencimento: number;
  produtos_contratados: string[];
  valores_produtos: Record<string, number>;
}

Deno.serve(
  withSentry("cadastro-externo-push", async (req) => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const respond = (body: Record<string, unknown>, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    let organizationId: string | undefined;

    try {
      // ── Auth ──────────────────────────────────────────────
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return respond({ error: "Não autorizado" }, 401);

      const supabaseUser = createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        {
          auth: { persistSession: false },
          global: { headers: { Authorization: authHeader } },
        }
      );

      const {
        data: { user },
        error: authError,
      } = await supabaseUser.auth.getUser();
      if (authError || !user) return respond({ error: "Usuário não autenticado" }, 401);

      // ── Resolve org ID ────────────────────────────────────
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      const { data: memberRow } = await supabaseAdmin
        .from("team_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .maybeSingle();

      organizationId = memberRow?.organization_id ?? undefined;

      // ── External API config ───────────────────────────────
      const apiKey = Deno.env.get("CADASTRO_EXTERNO_API_KEY");
      const apiUrl = Deno.env.get("CADASTRO_EXTERNO_URL");
      if (!apiKey || !apiUrl) {
        return respond({ error: "Integração não configurada (env vars ausentes)" }, 500);
      }

      // ── Parse body ────────────────────────────────────────
      const body: PushPayload = await req.json();
      const {
        pipe_proposta_id,
        nome_cliente,
        razao_social,
        cnpj,
        cpf,
        nicho,
        observacoes_gestor,
        investimento_previsto,
        comissao_vendas_percent,
        data_entrada,
        duracao_contrato_meses,
        dia_vencimento,
        produtos_contratados,
        valores_produtos,
      } = body;

      if (!pipe_proposta_id || !nome_cliente || !cnpj) {
        return respond({ error: "Campos obrigatórios ausentes (pipe_proposta_id, nome_cliente, cnpj)" }, 400);
      }

      // ── 1. Search for existing client by CNPJ ────────────
      const searchUrl = `${apiUrl}?action=search_client&cnpj=${encodeURIComponent(cnpj)}`;
      const searchRes = await fetch(searchUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.found) {
          await logRuntime({
            organizationId,
            module: "cadastro-externo",
            action: "push_client",
            status: "skipped",
            payloadSnapshot: { cnpj, existing_id: searchData.cliente_id },
            entityType: "pipe_proposta",
            entityId: pipe_proposta_id,
            triggeredBy: user.id,
          });
          return respond({
            success: true,
            already_exists: true,
            cliente_id: searchData.cliente_id,
            message: "Cliente já existe no sistema externo",
          });
        }
      }

      // ── 2. Create client ──────────────────────────────────
      const createPayload: Record<string, unknown> = {
        nome_cliente,
        razao_social,
        cnpj,
        nicho,
        observacoes_gestor,
        investimento_previsto,
        comissao_vendas_percent,
        data_entrada,
        duracao_contrato_meses,
        dia_vencimento,
      };
      if (cpf) createPayload.cpf = cpf;
      if (produtos_contratados?.length > 0) {
        createPayload.produtos_contratados = produtos_contratados;
        createPayload.valores_produtos = valores_produtos;
      }

      const createRes = await fetch(`${apiUrl}?action=create_client`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(createPayload),
      });

      const createData = await createRes.json();

      if (!createRes.ok || !createData.success) {
        // Handle 409 DUPLICATE gracefully
        if (createRes.status === 409 && createData.cliente_id) {
          await logRuntime({
            organizationId,
            module: "cadastro-externo",
            action: "push_client",
            status: "skipped",
            payloadSnapshot: { cnpj, existing_id: createData.cliente_id },
            errorMessage: "CNPJ duplicado",
            entityType: "pipe_proposta",
            entityId: pipe_proposta_id,
            triggeredBy: user.id,
          });
          return respond({
            success: true,
            already_exists: true,
            cliente_id: createData.cliente_id,
            message: "Cliente já existe no sistema externo",
          });
        }

        const errorMsg = createData.error || "Erro ao cadastrar cliente no sistema externo";
        await logRuntime({
          organizationId,
          module: "cadastro-externo",
          action: "push_client",
          status: "error",
          payloadSnapshot: { cnpj, nome_cliente },
          errorMessage: errorMsg,
          entityType: "pipe_proposta",
          entityId: pipe_proposta_id,
          triggeredBy: user.id,
        });
        return respond({
          error: errorMsg,
          code: createData.code,
          details: createData.details,
        }, 400);
      }

      // ── 3. Success ────────────────────────────────────────
      await logRuntime({
        organizationId,
        module: "cadastro-externo",
        action: "push_client",
        status: "success",
        payloadSnapshot: { cnpj, nome_cliente, cliente_id: createData.cliente_id },
        entityType: "pipe_proposta",
        entityId: pipe_proposta_id,
        triggeredBy: user.id,
      });

      return respond({
        success: true,
        cliente_id: createData.cliente_id,
        message: createData.message || "Cliente cadastrado com sucesso",
        produtos_criados: createData.produtos_criados,
      }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro interno";
      await logRuntime({
        organizationId,
        module: "cadastro-externo",
        action: "push_client",
        status: "error",
        errorMessage: msg,
      });
      return respond({ error: msg }, 500);
    }
  })
);
