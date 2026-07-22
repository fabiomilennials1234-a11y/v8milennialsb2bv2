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
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { assertOrgFeature, FeatureLockedError } from "../_shared/assert-org-feature.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  withErrorBoundary("cadastro-externo-push", async (req) => {
    const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const respond = (body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    let organizationId: string | undefined;

    try {
      // ── Auth ──────────────────────────────────────────────
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return respond({ error: "Não autorizado" });

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
      if (authError || !user) return respond({ error: "Usuário não autenticado" });

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      // ── Parse body ────────────────────────────────────────
      // Lido ANTES de resolver a org: a org vem da proposta, não do usuário.
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
        return respond({ error: "Campos obrigatórios ausentes (pipe_proposta_id, nome_cliente, cnpj)" });
      }

      // ── Resolve org ID ────────────────────────────────────
      // A org vem da PROPOSTA, não do usuário. Derivar de team_members por
      // user_id assume "1 usuário = 1 org", o que é falso para master e para
      // qualquer conta multi-org: `.maybeSingle()` com N linhas devolve erro e
      // data null, o organizationId virava undefined e a chamada morria no 403
      // de feature_locked — sem log, porque o 403 retorna antes de logRuntime.
      // Derivar do recurso também impede que o cliente escolha a org.
      const { data: proposta, error: propostaError } = await supabaseAdmin
        .from("pipe_propostas")
        .select("organization_id")
        .eq("id", pipe_proposta_id)
        .maybeSingle();

      if (propostaError) {
        throw new Error(
          `Falha ao resolver a proposta (${propostaError.code ?? "sem code"}): ${propostaError.message}`,
        );
      }
      if (!proposta?.organization_id) {
        return respond({ error: "Proposta não encontrada" });
      }
      // `organizationId` é o `let` do escopo externo (usado pelo catch para
      // logar); a const local carrega o tipo estreitado para as chamadas abaixo.
      const orgId: string = proposta.organization_id;
      organizationId = orgId;

      // O usuário precisa ser membro da org DONA da proposta — sem isto, a
      // resolução acima viraria um IDOR: qualquer usuário autenticado poderia
      // empurrar cadastros usando o id de proposta de outra organização.
      const { data: membership, error: membershipError } = await supabaseAdmin
        .from("team_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        throw new Error(
          `Falha ao validar acesso (${membershipError.code ?? "sem code"}): ${membershipError.message}`,
        );
      }
      if (!membership) {
        return new Response(
          JSON.stringify({ error: "forbidden", message: "Sem acesso a esta organização" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ── External API config ───────────────────────────────
      const apiKey = Deno.env.get("CADASTRO_EXTERNO_API_KEY");
      const apiUrl = Deno.env.get("CADASTRO_EXTERNO_URL");
      if (!apiKey || !apiUrl) {
        return respond({ error: "Integração não configurada (env vars ausentes)" });
      }

      // Feature gate — org must have external_cadastro on their plan
      try {
        await assertOrgFeature(supabaseAdmin, orgId, "external_cadastro");
      } catch (e) {
        if (e instanceof FeatureLockedError) {
          return new Response(
            JSON.stringify({ error: "feature_locked", feature: "external_cadastro" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw e;
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
            module: "lead",
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
            module: "lead",
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
          module: "lead",
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
        });
      }

      // ── 3. Success ────────────────────────────────────────
      await logRuntime({
        organizationId,
        module: "lead",
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
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro interno";
      await logRuntime({
        organizationId,
        module: "lead",
        action: "push_client",
        status: "error",
        errorMessage: msg,
      });
      return respond({ error: msg });
    }
  })
);
