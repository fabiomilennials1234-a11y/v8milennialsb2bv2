import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fireTrigger } from "../../supabase/functions/_shared/workflow-trigger.ts";

const sb = createClient(Deno.env.get("BRANCH_URL")!, Deno.env.get("BRANCH_KEY")!, { auth: { persistSession: false } });
const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const WF = "77777777-7777-4777-8777-777777777777";

let falhas = 0;
const checar = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "ok  " : "FALHA"} ${n}${d ? " — " + d : ""}`); if (!ok) falhas++; };
const limpar = () => sb.from("workflow_executions").delete().eq("organization_id", ORG);
const config = (c: Record<string, unknown>) => sb.from("workflows").update({ trigger_config: c }).eq("id", WF);
const fogo = (ctx: Record<string, unknown>) =>
  // deno-lint-ignore no-explicit-any
  fireTrigger({ supabase: sb as any, organizationId: ORG, triggerType: "lead_replied", leadId: LEAD, context: ctx });
/** Fecha as execuções abertas para tirar do caminho a guarda de "já ativa". */
const fecharAbertas = () =>
  sb.from("workflow_executions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("organization_id", ORG);
const chaves = async () => {
  const { data } = await sb.from("workflow_executions").select("trigger_dedup_key").eq("organization_id", ORG);
  return (data ?? []).map((r) => String(r.trigger_dedup_key));
};
const balde = (k: string) => Number(k.split(":").at(-1));

const ctx = { trigger: "lead_replied", channel: "whatsapp" };

// ── O DEDUP, isolado da guarda de execução ativa ────────────────────────────
await config({ cooldown_minutes: 60 });
await limpar();
{
  const a = await fogo(ctx);
  await fecharAbertas();                 // a guarda de "já ativa" sai de cena
  const b = await fogo(ctx);             // mesma janela: só o dedup pode barrar
  const ks = await chaves();
  // O retorno do fireTrigger é a contagem TENTADA (o módulo documenta isso na
  // linha do upsert); a garantia é o índice único. Por isso a asserção é sobre
  // a LINHA, não sobre o número devolvido.
  checar("dedup de 60min barra a segunda resposta (execução anterior JÁ FECHADA)",
    a === 1 && ks.length === 1, `a=${a} b=${b} linhas=${ks.length}`);
  checar("nota: o retorno é tentativa, não criação — b=1 com 1 linha só",
    b === 1 && ks.length === 1, `b=${b}`);
}

// ── Controle positivo do dedup: janela curta deixa passar ───────────────────
// cooldown_minutes: 1 muda o balde de 3600s para 60s. Se o valor da config NÃO
// chegasse à chave, este disparo seria barrado igual ao de cima.
await config({ cooldown_minutes: 1 });
await limpar();
{
  const a = await fogo(ctx);
  const k1 = (await chaves())[0];
  await fecharAbertas();
  const esperado60 = Math.floor(Date.now() / 1000 / 60);
  checar("controle positivo: cooldown de 1min produz balde de 60s, não de 3600s",
    balde(k1) === esperado60, `balde=${balde(k1)} esperado=${esperado60}`);
  checar("controle positivo: o balde de 1min é DIFERENTE do de 60min",
    balde(k1) !== Math.floor(Date.now() / 1000 / 3600), `a=${a}`);
}

// ── O padrão (config sem cooldown) é 60min, não os 60s do resto do motor ────
await config({});
await limpar();
{
  await fogo(ctx);
  const k = (await chaves())[0];
  checar("sem cooldown na config: balde padrão de 60min",
    balde(k) === Math.floor(Date.now() / 1000 / 3600), `balde=${balde(k)}`);
}

await limpar();
console.log(falhas === 0 ? "\nTODAS AS PROVAS PASSARAM" : `\n${falhas} PROVA(S) FALHARAM`);
Deno.exit(falhas === 0 ? 0 : 1);
