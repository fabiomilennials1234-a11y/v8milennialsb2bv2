/**
 * Prova do que não roda local: o contexto persistido em `workflow_executions`
 * sobrevive ao round-trip e o `process-workflow-executions` revalida.
 *
 * Roda contra uma BRANCH de preview. Recusa produção.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fireTrigger,
  matchesTriggerConfig,
} from "../../supabase/functions/_shared/workflow-trigger.ts";

const URL_ = Deno.env.get("BRANCH_URL")!;
const KEY = Deno.env.get("BRANCH_KEY")!;
if (URL_.includes("jsjsmuncfkbsbzqzqhfq")) throw new Error("RECUSADO: produção");

const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

const ORG = Deno.env.get("ORG_ID")!;
const LEAD = Deno.env.get("LEAD_ID")!;
const STAGE_CERTA = Deno.env.get("STAGE_CERTA")!;
const STAGE_ERRADA = Deno.env.get("STAGE_ERRADA")!;
const INSTANCIA_CERTA = "inst-do-closer";
const INSTANCIA_ERRADA = "inst-do-sdr";

let falhas = 0;
const checar = (nome: string, ok: boolean, detalhe = "") => {
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${detalhe ? " — " + detalhe : ""}`);
  if (!ok) falhas++;
};

async function limparExecucoes() {
  await sb.from("workflow_executions").delete().eq("organization_id", ORG);
}

async function comConfig(config: Record<string, unknown>) {
  await sb.from("workflows").update({ trigger_config: config }).eq("organization_id", ORG);
}

/** Dispara e devolve as execuções criadas, com o contexto como o banco o devolveu. */
async function disparar(context: Record<string, unknown>) {
  await limparExecucoes();
  const n = await fireTrigger({
    // deno-lint-ignore no-explicit-any
    supabase: sb as any,
    organizationId: ORG,
    triggerType: "lead_replied",
    leadId: LEAD,
    context,
  });
  const { data } = await sb
    .from("workflow_executions")
    .select("id, context, status")
    .eq("organization_id", ORG);
  return { n, linhas: data ?? [] };
}

/** O que `process-workflow-executions` faz na linha 322. */
async function revalida(linha: { context: Record<string, unknown> }) {
  const { data: wf } = await sb
    .from("workflows")
    .select("trigger_type, trigger_config")
    .eq("organization_id", ORG)
    .maybeSingle();
  return matchesTriggerConfig(
    wf!.trigger_type as string,
    wf!.trigger_config as Record<string, unknown>,
    (linha.context ?? {}) as Record<string, unknown>,
  );
}

// ── 1. CONTROLE POSITIVO ────────────────────────────────────────────────────
// Sem filtro nenhum: tem de disparar. Se este falhar, todo "0 execuções"
// abaixo é verde por ausência e não prova nada.
await comConfig({});
{
  const { n, linhas } = await disparar({ trigger: "lead_replied", channel: "whatsapp" });
  checar("controle positivo: sem filtro dispara", n === 1 && linhas.length === 1, `n=${n}`);
  if (linhas[0]) checar("controle positivo: revalidação aprova", await revalida(linhas[0]));
}

// ── 2. FILTRO DE INSTÂNCIA ──────────────────────────────────────────────────
await comConfig({ source_type: "whatsapp", source_ids: [INSTANCIA_CERTA] });
{
  const { n, linhas } = await disparar({
    trigger: "lead_replied", channel: "whatsapp", instance_id: INSTANCIA_CERTA,
  });
  checar("instância certa dispara", n === 1, `n=${n}`);
  if (linhas[0]) {
    checar("instância: o context PERSISTIDO carrega instance_id",
      (linhas[0].context as Record<string, unknown>).instance_id === INSTANCIA_CERTA);
    checar("instância: revalidação do worker aprova", await revalida(linhas[0]));
  }
}
{
  const { n } = await disparar({
    trigger: "lead_replied", channel: "whatsapp", instance_id: INSTANCIA_ERRADA,
  });
  checar("instância errada NÃO dispara", n === 0, `n=${n}`);
}
{
  const { n } = await disparar({ trigger: "lead_replied", channel: "whatsapp" });
  checar("sem instância no evento NÃO dispara (fail-closed)", n === 0, `n=${n}`);
}

// ── 3. FILTRO DE ETAPA ──────────────────────────────────────────────────────
// A posição do lead NÃO vem no evento: o fireTrigger vai ao banco buscar.
await comConfig({ stage_ids: [STAGE_CERTA] });
{
  const { n, linhas } = await disparar({ trigger: "lead_replied", channel: "whatsapp" });
  checar("etapa certa dispara (posição lida do banco)", n === 1, `n=${n}`);
  if (linhas[0]) {
    const ctx = linhas[0].context as Record<string, unknown>;
    checar("etapa: o context PERSISTIDO carrega lead_stage_ids",
      Array.isArray(ctx.lead_stage_ids) && (ctx.lead_stage_ids as string[]).includes(STAGE_CERTA),
      JSON.stringify(ctx.lead_stage_ids));
    checar("etapa: revalidação do worker aprova — o filtro NÃO morre no round-trip",
      await revalida(linhas[0]));
  }
}
await comConfig({ stage_ids: [STAGE_ERRADA] });
{
  const { n } = await disparar({ trigger: "lead_replied", channel: "whatsapp" });
  checar("etapa errada NÃO dispara", n === 0, `n=${n}`);
}

// ── 4. MODO DE RESPOSTA ─────────────────────────────────────────────────────
await comConfig({ reply_mode: "after_outbound", reply_window_hours: 24 });
{
  const { n, linhas } = await disparar({ trigger: "lead_replied", channel: "whatsapp" });
  checar("after_outbound com saída recente dispara", n === 1, `n=${n}`);
  if (linhas[0]) {
    const ctx = linhas[0].context as Record<string, unknown>;
    checar("modo: o context PERSISTIDO carrega hours_since_outbound",
      typeof ctx.hours_since_outbound === "number", String(ctx.hours_since_outbound));
    checar("modo: revalidação do worker aprova com a evidência congelada",
      await revalida(linhas[0]));
  }
}
await comConfig({ reply_mode: "after_outbound", reply_window_hours: 1 });
{
  const { n } = await disparar({ trigger: "lead_replied", channel: "whatsapp" });
  checar("after_outbound fora da janela NÃO dispara", n === 0, `n=${n}`);
}

await limparExecucoes();
console.log(falhas === 0 ? "\nTODAS AS PROVAS PASSARAM" : `\n${falhas} PROVA(S) FALHARAM`);
Deno.exit(falhas === 0 ? 0 : 1);
