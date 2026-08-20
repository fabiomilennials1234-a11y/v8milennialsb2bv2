/**
 * Backfill de `channel_messages.metadata` a partir do `raw_payload`.
 *
 * ─── POR QUE DÁ PARA RECUPERAR O PASSADO ────────────────────────────────────
 *
 * O corpo integral do fornecedor está gravado desde sempre em `raw_payload`.
 * Nada precisa ser pedido a ele: a leitura que faltava é NOSSA, e o dado bruto
 * nunca saiu do lugar.
 *
 * ─── POR QUE DENO, E NÃO UM SCRIPT NODE ─────────────────────────────────────
 *
 * Ele importa `normalizarConteudo` — a MESMA função do webhook. Um script Node
 * teria de reimplementar a regra em JavaScript, e aí passado e futuro passariam
 * a ser lidos por dois códigos diferentes que ninguém garante iguais. A conversa
 * ficaria com dois regimes, que é exatamente o que este backfill existe para
 * evitar.
 *
 * ─── O QUE ELE NÃO FAZ ──────────────────────────────────────────────────────
 *
 * Não espelha mídia antiga. `metadata.midia.url` recebe a URL DO FORNECEDOR, que
 * é assinada e temporária — medido em 2026-08-19: os links de meses atrás ainda
 * respondem HTTP 206. A mídia antiga volta a aparecer, e vai quebrar quando o
 * link vencer. Espelhar retroativamente é uma decisão à parte, com custo de
 * chamadas e de armazenamento, e não se toma dentro de um backfill.
 *
 * Uso:
 *   deno run --allow-env --allow-net --allow-run scripts/backfill-notificame-metadata.ts [--aplicar]
 *
 * Sem `--aplicar` é ENSAIO: lê, normaliza, conta e não escreve nada.
 */

import { normalizarConteudo } from "../supabase/functions/_shared/notificame-content.ts";

const PROJECT_REF = "jsjsmuncfkbsbzqzqhfq";
const LOTE = 200;
const APLICAR = Deno.args.includes("--aplicar");

function token(): string {
  const p = new Deno.Command("security", {
    args: ["find-generic-password", "-s", "Supabase CLI", "-w"],
  }).outputSync();
  let t = new TextDecoder().decode(p.stdout).trim();
  if (t.startsWith("go-keyring-base64:")) {
    t = atob(t.slice("go-keyring-base64:".length)).trim();
  }
  return t;
}

const TOKEN = token();

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    },
  );
  const texto = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${texto.slice(0, 400)}`);
  return JSON.parse(texto) as T[];
}

/** Escapa para literal SQL. O `raw_payload` é do fornecedor: texto hostil. */
function lit(v: string): string {
  return `'${v.replaceAll("'", "''")}'`;
}

const alvo = `
  from public.channel_messages
 where direction = 'incoming'
   and metadata is null
   and raw_payload is not null
   and (messaging_channel_id is not null or instance_id in (
         select id from public.whatsapp_instances where provider = 'notificame'))
`;

const [{ n }] = await sql<{ n: number }>(`select count(*)::int as n ${alvo}`);
console.log(`${n} linha(s) para normalizar${APLICAR ? "" : "  (ENSAIO — nada será escrito)"}`);

let feitas = 0;
const porTipo: Record<string, number> = {};

for (let offset = 0; offset < n; offset += LOTE) {
  const linhas = await sql<{ id: string; raw_payload: unknown }>(
    `select id, raw_payload ${alvo} order by timestamp limit ${LOTE} offset ${APLICAR ? 0 : offset}`,
  );
  if (linhas.length === 0) break;

  const valores: string[] = [];
  for (const linha of linhas) {
    const c = normalizarConteudo(linha.raw_payload);
    porTipo[c.metadata.tipo] = (porTipo[c.metadata.tipo] ?? 0) + 1;
    valores.push(
      `(${lit(linha.id)}::uuid, ${lit(JSON.stringify(c.metadata))}::jsonb, ` +
        `${c.content === null ? "null" : lit(c.content)}, ` +
        `${c.mediaUrl === null ? "null" : lit(c.mediaUrl)})`,
    );
  }

  if (APLICAR) {
    // `coalesce` no content e na mídia: o backfill ACRESCENTA, nunca apaga. Se
    // uma linha antiga já tem texto, ele fica — a leitura nova só preenche o que
    // estava vazio.
    await sql(`
      update public.channel_messages as m
         set metadata  = v.metadata,
             content   = coalesce(m.content, v.content),
             media_url = coalesce(m.media_url, v.media_url)
        from (values ${valores.join(",")}) as v(id, metadata, content, media_url)
       where m.id = v.id
    `);
  }

  feitas += linhas.length;
  console.log(`  ${feitas}/${n}`);
  if (!APLICAR && feitas >= n) break;
}

console.log("\nPor tipo:");
for (const [tipo, qtd] of Object.entries(porTipo).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tipo.padEnd(12)} ${qtd}`);
}
