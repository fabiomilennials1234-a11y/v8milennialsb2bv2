/**
 * oraculo-turno — um turno de conversa com o Oráculo Comercial.
 *
 * Substitui o `mode: "chat"` de `oraculo-comercial`, que montava um dump fixo
 * de seis consultas e mandava `[system, user]` sem histórico. Aqui a leitura é
 * sob demanda, por ferramenta, com Escopo resolvido do JWT — e a conversa
 * lembra do que foi dito.
 *
 * A função antiga continua no ar até a Onda 5 (SCRUM-606): remover antes de o
 * substituto estar em produção deixaria buraco na tela de quem usa.
 *
 * ADR-0032: o raciocínio nunca escreve. O catálogo é somente-leitura.
 */

import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AuthError,
  authErrorResponse,
  requireAuth,
  resolvePermission,
} from "../_shared/user-auth.ts";
import { ACTION_TO_FEATURE } from "../_shared/permission-actions.ts";
import { handleTurn } from "../_shared/oraculo/turn-handler.ts";
import { createOpenRouterLlm } from "../_shared/oraculo/openrouter.ts";
import { createTurnStore, TurnConflictError } from "../_shared/oraculo/store.ts";
import { criarFerramentas, TOOL_SCHEMAS } from "../_shared/oraculo/catalogo.ts";
import { DEFAULT_MAX_TOOL_CALLS } from "../_shared/oraculo/loop.ts";
import {
  assertPlanFeature,
  planDeniedResponse,
  PlanFeatureDeniedError,
} from "../_shared/plan-gate.ts";

const SYSTEM_PROMPT = `Você é o Oráculo Comercial do Torque CRM: um analista da operação de vendas.

Regras que não se negociam:
- Você NÃO escreve nada no CRM. Para mover etapa, criar follow-up, atribuir responsável ou adicionar tag, consulte os dados e use propor_acao. A proposta apenas prevê e vira um botão; a execução ocorre depois, em outra requisição, pelo clique da pessoa.
- Você só afirma o que os números sustentam. Sem dado, diga o que falta e a partir de quando será possível dizer.
- Consulte as ferramentas antes de responder qualquer coisa quantitativa. Não estime, não invente número.
- Responda em português do Brasil, direto, sem preâmbulo. Números em reais quando forem dinheiro.
- Você tem no máximo ${DEFAULT_MAX_TOOL_CALLS} consultas por resposta. Escolha bem.`;

Deno.serve(withErrorBoundary("oraculo-turno", async (req) => {
  const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin") ?? undefined));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    return await handleTurn(
      req,
      {
        // `requireOrganization` é obrigatório: o fallback "primeiro team_member
        // ativo" avaliaria um usuário multi-org contra a organização errada.
        auth: async (r, body) => {
          const ctx = await requireAuth(r, { body, requireOrganization: true });
          await assertPlanFeature(db, ctx.organizationId, "oraculo");
          return {
            userId: ctx.userId,
            teamMemberId: ctx.teamMemberId,
            organizationId: ctx.organizationId,
            role: ctx.role,
            isMaster: ctx.isMaster,
            isAdmin: ctx.isAdmin,
          };
        },
        perms: async (actor) => ({
          viewOrgMetrics: await resolvePermission(
            actor.userId,
            actor.organizationId,
            ACTION_TO_FEATURE.view_org_metrics,
          ),
        }),
        llm: createOpenRouterLlm({
          apiKey: Deno.env.get("OPENROUTER_API_KEY")!,
          model: Deno.env.get("ORACULO_MODEL") || undefined,
          systemPrompt: SYSTEM_PROMPT,
          toolSchemas: TOOL_SCHEMAS,
        }),
        // Catálogo e executores vêm do mesmo módulo: um teste garante que os
        // dois lados batem, senão o modelo pede uma ferramenta que ninguém
        // executa e a chamada é rejeitada em silêncio.
        tools: criarFerramentas(db),
        store: createTurnStore(db),
      },
      cors,
    );
  } catch (err) {
    if (err instanceof TurnConflictError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 409,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (err instanceof AuthError) return authErrorResponse(err, cors);
    if (err instanceof PlanFeatureDeniedError) return planDeniedResponse(err, cors);
    throw err;
  }
}));
