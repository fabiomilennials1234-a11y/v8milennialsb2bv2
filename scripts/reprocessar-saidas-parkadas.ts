/**
 * Reprocessa os eventos de SAÍDA que foram descartados.
 *
 * ─── O QUE ESTAVA ACONTECENDO ───────────────────────────────────────────────
 *
 * Entre 17 e 19/08/2026, 193 eventos entraram em `notificame_webhook_events`
 * sob o rótulo `unreadable_direction` — e o rótulo mentia: `readDirection` lê
 * `"OUT"` perfeitamente. O guard parkava tudo que não fosse `incoming`.
 *
 * Eram as respostas que o VENDEDOR deu pelo aplicativo do fornecedor. Em 51
 * conversas, o cliente aparecia falando sozinho no Torque.
 *
 * ─── POR QUE DÁ PARA RECUPERAR ──────────────────────────────────────────────
 *
 * O corpo integral foi guardado. Parkar é adiamento, não perda — e este script é
 * o resgate que o desenho previa.
 *
 * Usa os MESMOS pickers do webhook: passado e futuro lidos pela mesma regra.
 *
 * Uso:
 *   deno run --allow-env --allow-net --allow-run scripts/reprocessar-saidas-parkadas.ts [--aplicar]
 */

import {
  buildInboundChannelMessageRow,
  pickExternalId,
  pickInterlocutorDeSaida,
  pickProviderMessageId,
  pickTimestampIso,
} from "../supabase/functions/_shared/notificame-inbound.ts";
import { normalizarConteudo } from "../supabase/functions/_shared/notificame-content.ts";

const PROJECT_REF = "jsjsmuncfkbsbzqzqhfq";
const APLICAR = Deno.args.includes("--aplicar");

function token(): string {
  const p = new Deno.Command("security", {
    args: ["find-generic-password", "-s", "Supabase CLI", "-w"],
  }).outputSync();
  let t = new TextDecoder().decode(p.stdout).trim();
  if (t.startsWith("go-keyring-base64:")) t = atob(t.slice("go-keyring-base64:".length)).trim();
  return t;
}

const TOKEN = token();

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${texto.slice(0, 400)}`);
  return JSON.parse(texto) as T[];
}

const lit = (v: string) => `'${v.replaceAll("'", "''")}'`;

/**
 * A caixa de cada evento sai das mensagens JÁ GRAVADAS com o mesmo
 * `subscriptionId` — o `provider_config` da caixa não guarda o id do fornecedor,
 * e o path original do webhook não foi preservado no evento parkado.
 */
const eventos = await sql<{
  id: string;
  payload: unknown;
  organization_id: string;
  messaging_channel_id: string;
}>(`
  select e.id, e.payload, cm.organization_id, cm.messaging_channel_id
    from notificame_webhook_events e
    join lateral (
      select cm.organization_id, cm.messaging_channel_id
        from channel_messages cm
       where cm.raw_payload->>'subscriptionId' = e.payload->>'subscriptionId'
         and cm.messaging_channel_id is not null
       limit 1
    ) cm on true
   where e.reason = 'unreadable_direction'
     and e.status = 'parked'
   order by e.created_at
`);

console.log(`${eventos.length} evento(s) de saída${APLICAR ? "" : "  (ENSAIO — nada será escrito)"}`);

let gravadas = 0;
let semDados = 0;
const porTipo: Record<string, number> = {};

for (const ev of eventos) {
  const externalId = pickExternalId(ev.payload);
  const contato = pickInterlocutorDeSaida(ev.payload);
  if (!externalId || !contato) {
    semDados++;
    continue;
  }

  const conteudo = normalizarConteudo(ev.payload);
  porTipo[conteudo.metadata.tipo] = (porTipo[conteudo.metadata.tipo] ?? 0) + 1;

  const row = buildInboundChannelMessageRow({
    organizationId: ev.organization_id,
    target: { kind: "instagram", messagingChannelId: ev.messaging_channel_id },
    externalId,
    contact: contato,
    contactExternalId: contato.externalId,
    content: conteudo,
    metadata: conteudo.metadata,
    providerMessageId: pickProviderMessageId(ev.payload),
    direction: "outgoing",
    // O instante do corpo. Sem ele a mensagem entraria com a hora do backfill e
    // apareceria no FIM da conversa, fora de ordem.
    timestampIso: pickTimestampIso(ev.payload) ?? new Date().toISOString(),
    rawPayload: ev.payload,
  });

  if (APLICAR) {
    const colunas = Object.keys(row);
    const valores = colunas
      .map((c) => {
        const v = (row as Record<string, unknown>)[c];
        if (v === null || v === undefined) return "null";
        if (typeof v === "object") return `${lit(JSON.stringify(v))}::jsonb`;
        return lit(String(v));
      })
      .join(", ");

    await sql(`
      insert into public.channel_messages (${colunas.join(", ")})
      values (${valores})
      on conflict (external_id, channel, organization_id) do nothing
    `);

    await sql(`
      update public.notificame_webhook_events
         set status = 'processed', resolved_at = now()
       where id = ${lit(ev.id)}
    `);
  }

  gravadas++;
}

console.log(`\n${gravadas} gravada(s), ${semDados} sem dados suficientes`);
console.log("Por tipo:");
for (const [tipo, n] of Object.entries(porTipo).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tipo.padEnd(12)} ${n}`);
}
