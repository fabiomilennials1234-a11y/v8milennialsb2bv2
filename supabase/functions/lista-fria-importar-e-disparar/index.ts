/**
 * lista-fria-importar-e-disparar — importa os contatos selecionados de uma busca
 * da Lista fria, abre um negócio de cada um num funil e etapa escolhidos e
 * dispara uma mensagem cadenciada (ADR-0048).
 *
 * Ordem (cada fase só roda se a anterior fechou):
 *   0. valida o pedido e a janela de horário — antes de escrever qualquer coisa;
 *   1. lista_fria_disparo_preparar (RPC, como o usuário): flag, permissão, busca,
 *      funil, etapa, chips, cadência, teto. Abre o pedido (um ativo por busca);
 *   2. importa com lista_fria_importar (a RPC de sempre, em lotes);
 *   3. abre o negócio de cada lead importado com abrir_negocio;
 *   4. cria o plano de disparo (blast-plan-create) SÓ com os leads que ganharam
 *      negócio: teto diário da org e do chip, intervalo, lotes e anti-ban são os
 *      do motor de disparo, não reimplementados aqui.
 *
 * Tudo que toca dado do cliente roda COM O JWT DO USUÁRIO (RPCs e o
 * blast-plan-create), então RLS e permissão valem como na tela. O service_role
 * só lê/atualiza o registro do pedido e lê os resultados da busca.
 *
 * Falha no meio não desfaz o que já entrou: leads importados ficam na Lista fria,
 * negócios criados ficam no funil. O pedido guarda a fase e o erro.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { dentroDaJanela, textoDaJanela, variaveisDesconhecidas } from "../_shared/lista-fria-disparo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LOTE_DA_IMPORTACAO = 200;
const VOLTAS_DA_IMPORTACAO = 5; // teto de 500 contatos por pedido (a RPC de preparo já barra)
const NEGOCIOS_EM_PARALELO = 5;

/** As RPCs desta função não estão no catálogo de tipos gerado: chamada tipada à mão. */
interface ErroDeRpc {
  code?: string;
  message?: string;
  details?: string | null;
}
interface ClienteComRpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: ErroDeRpc | null }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/** PostgREST devolve o ERRCODE PTxxx como `code` e o motivo em `details`. */
function recusaDoBanco(error: ErroDeRpc) {
  const status = /^PT(\d{3})$/.test(error.code ?? "") ? Number(error.code!.slice(2)) : error.code === "42501" ? 403 : 500;
  return { status, body: { error: error.details ?? "erro", message: error.message ?? "Erro inesperado." } };
}

/** Roda `fn` sobre `itens` com no máximo `n` em voo. */
async function emParalelo<T>(itens: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) {
      const atual = itens[i++];
      await fn(atual);
    }
  });
  await Promise.all(trabalhadores);
}

Deno.serve(
  withErrorBoundary("lista-fria-importar-e-disparar", async (req: Request) => {
    const origin = req.headers.get("Origin") ?? undefined;
    const cors = withSecurityHeaders(
      (await import("../_shared/cors.ts")).getCorsHeaders(origin) as Record<string, string>,
    );
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Missing auth" }, cors);
    const jwt = authHeader.slice(7);

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const rpcDoUsuario = supabaseUser as unknown as ClienteComRpc;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser(jwt);
    if (userErr || !userData?.user) return json(401, { error: "Invalid token" }, cors);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json(400, { error: "Invalid JSON" }, cors);

    const buscaId = body.busca_id;
    const pipelineId = body.pipeline_id;
    const stageId = body.stage_id;
    const mensagem = typeof body.mensagem === "string" ? body.mensagem : "";
    const instanceIds = body.instance_ids;
    const delayMin = body.delay_min_ms;
    const delayMax = body.delay_max_ms;

    if (
      typeof buscaId !== "string" || !UUID.test(buscaId) ||
      typeof pipelineId !== "string" || !UUID.test(pipelineId) ||
      typeof stageId !== "string" || !UUID.test(stageId) ||
      !Array.isArray(instanceIds) || instanceIds.length === 0 ||
      !instanceIds.every((x) => typeof x === "string" && UUID.test(x)) ||
      !Number.isInteger(delayMin) || !Number.isInteger(delayMax)
    ) {
      return json(400, { error: "pedido_invalido", message: "Faltam dados do disparo." }, cors);
    }

    // ── 0. Validações que não precisam de banco ──────────────────────────────
    const desconhecidas = variaveisDesconhecidas(mensagem);
    if (desconhecidas.length > 0) {
      return json(
        422,
        {
          error: "variavel_desconhecida",
          variaveis: desconhecidas,
          message: `A mensagem usa ${desconhecidas.map((v) => `{{${v}}}`).join(", ")}, que o disparo não preenche e sairiam vazias.`,
        },
        cors,
      );
    }
    if (!dentroDaJanela(new Date())) {
      return json(
        422,
        {
          error: "fora_da_janela",
          message: `Disparo para contato frio só sai ${textoDaJanela()}. Volte nesse horário.`,
        },
        cors,
      );
    }

    // ── 1. Preparo: valida tudo no banco e abre o pedido ─────────────────────
    const { data: preparo, error: preparoErr } = await rpcDoUsuario.rpc("lista_fria_disparo_preparar", {
      p_busca: buscaId,
      p_pipeline: pipelineId,
      p_stage: stageId,
      p_mensagem: mensagem,
      p_instance_ids: instanceIds,
      p_delay_min_ms: delayMin,
      p_delay_max_ms: delayMax,
    });
    if (preparoErr) {
      const r = recusaDoBanco(preparoErr);
      return json(r.status, r.body, cors);
    }
    const { disparo_id: disparoId, organization_id: orgId } = preparo as { disparo_id: string; organization_id: string };

    const registrar = (campos: Record<string, unknown>) =>
      admin
        .from("lista_fria_disparos")
        .update({ ...campos, ultimo_sinal_em: new Date().toISOString() })
        .eq("id", disparoId);

    const falhar = async (fase: string, erro: string, extra: Record<string, unknown> = {}) => {
      await registrar({ status: "falhou", erro: `${fase}: ${erro}`.slice(0, 500), finished_at: new Date().toISOString() });
      await logRuntime({
        organizationId: orgId,
        module: "campaign",
        action: "disparo_falhou",
        status: "error",
        entityType: "lista_fria_disparos",
        entityId: disparoId,
        errorMessage: `${fase}: ${erro}`,
      });
      return json(500, { error: "disparo_falhou", fase, message: erro, disparo_id: disparoId, ...extra }, cors);
    };

    try {
      // ── 2. Importa ─────────────────────────────────────────────────────────
      let importados = 0;
      for (let volta = 0; volta < VOLTAS_DA_IMPORTACAO; volta++) {
        const { data, error } = await rpcDoUsuario.rpc("lista_fria_importar", {
          p_busca: buscaId,
          p_limite: LOTE_DA_IMPORTACAO,
        });
        if (error) return await falhar("importando", error.message ?? "erro", { importados });
        const r = (data ?? {}) as { importados?: number; restantes?: number };
        importados += r.importados ?? 0;
        await registrar({ importados });
        if ((r.restantes ?? 0) === 0) break;
      }

      // Os leads DESTE pedido: importados depois que ele abriu.
      const { data: pedido } = await admin
        .from("lista_fria_disparos")
        .select("created_at")
        .eq("id", disparoId)
        .single();
      const { data: linhas, error: linhasErr } = await admin
        .from("lista_fria_resultados")
        .select("lead_id")
        .eq("busca_id", buscaId)
        .eq("organization_id", orgId)
        .not("lead_id", "is", null)
        .gte("importado_em", (pedido as { created_at: string }).created_at)
        .limit(1000);
      if (linhasErr) return await falhar("importando", linhasErr.message, { importados });
      const leadIds = Array.from(new Set(((linhas ?? []) as Array<{ lead_id: string }>).map((l) => l.lead_id)));

      if (leadIds.length === 0) {
        await registrar({ status: "concluido", finished_at: new Date().toISOString(), erro: "nada_importado" });
        return json(200, { ok: true, disparo_id: disparoId, importados: 0, negocios: 0, enviados: 0 }, cors);
      }

      // ── 3. Negócios ────────────────────────────────────────────────────────
      await registrar({ status: "negocios" });
      const comNegocio: string[] = [];
      const semNegocio: { lead_id: string; motivo: string }[] = [];
      await emParalelo(leadIds, NEGOCIOS_EM_PARALELO, async (leadId) => {
        const { error } = await rpcDoUsuario.rpc("abrir_negocio", {
          p_lead_id: leadId,
          p_pipe: pipelineId,
          p_stage: stageId,
          p_source: "import",
        });
        if (error) semNegocio.push({ lead_id: leadId, motivo: error.message ?? "erro" });
        else comNegocio.push(leadId);
      });
      await registrar({ negocios: comNegocio.length });

      // Sem negócio não há disparo: a mensagem só sai para quem já está no funil.
      if (comNegocio.length === 0) {
        return await falhar("negocios", semNegocio[0]?.motivo ?? "nenhum negócio aberto", {
          importados,
          sem_negocio: semNegocio.length,
        });
      }

      // ── 4. Disparo cadenciado ──────────────────────────────────────────────
      await registrar({ status: "disparando" });
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/blast-plan-create`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instance_ids: instanceIds,
          lead_ids: comNegocio,
          message: mensagem,
          delay_min_ms: delayMin,
          delay_max_ms: delayMax,
          source: { kind: "lista_fria", busca_id: buscaId, disparo_id: disparoId, pipelineId },
        }),
      });
      const plano = await resp.json().catch(() => ({}));
      if (!resp.ok || !plano?.plan_id) {
        // O blast-plan-create grava o plano ANTES de disparar o primeiro lote: se o
        // disparo errar depois, o plano existe (ativo, com destinatários pendentes)
        // e o pedido precisa apontar para ele, senão fica um plano sem dono.
        const { data: orfao } = await admin
          .from("blast_plans")
          .select("id")
          .eq("organization_id", orgId)
          .eq("source->>disparo_id", disparoId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const planoCriado = (orfao as { id?: string } | null)?.id ?? null;
        if (planoCriado) await registrar({ plan_id: planoCriado });
        return await falhar("disparando", plano?.error ?? `blast-plan-create ${resp.status}`, {
          importados,
          negocios: comNegocio.length,
          plan_id: planoCriado,
        });
      }

      await registrar({ status: "concluido", plan_id: plano.plan_id, finished_at: new Date().toISOString() });
      await logRuntime({
        organizationId: orgId,
        module: "campaign",
        action: "disparo_criado",
        status: "success",
        entityType: "lista_fria_disparos",
        entityId: disparoId,
        payloadSnapshot: {
          importados,
          negocios: comNegocio.length,
          sem_negocio: semNegocio.length,
          plan_id: plano.plan_id,
          total_recipients: plano.total_recipients,
          lots_total: plano.lots_total,
        },
      });

      return json(
        200,
        {
          ok: true,
          disparo_id: disparoId,
          plan_id: plano.plan_id,
          importados,
          negocios: comNegocio.length,
          sem_negocio: semNegocio.length,
          destinatarios: plano.total_recipients,
          lotes: plano.lots_total,
        },
        cors,
      );
    } catch (e) {
      return await falhar("inesperado", (e as Error).message ?? "erro");
    }
  }),
);
