/**
 * Traz para casa os arquivos recebidos que ainda apontam para o fornecedor.
 *
 * ─── POR QUE ISTO É UMA PASSADA À PARTE, E NÃO PARTE DO BACKFILL ────────────
 *
 * O backfill de `metadata` é leitura pura sobre dado que já era nosso: rápido,
 * barato e sem rede. Isto aqui BAIXA e REPUBLICA arquivo, uma chamada por linha
 * e bytes no bucket. Misturar os dois faria uma operação de leitura carregar o
 * custo e o risco de uma de escrita externa.
 *
 * ─── A PREMISSA QUE CAIU ────────────────────────────────────────────────────
 *
 * A suposição era que os links do fornecedor já teriam expirado e que a mídia
 * antiga seria irrecuperável. Medido em 2026-08-19: URLs de meses atrás ainda
 * respondem HTTP 206. Elas vão vencer algum dia — e é por isso que este script
 * existe, não apesar disso.
 *
 * Usa `espelharMidiaRecebida`, a MESMA função do webhook: o arquivo antigo passa
 * pelo caminho idêntico ao do arquivo que chega agora.
 *
 * Uso:
 *   deno run --allow-env --allow-net --allow-run --allow-read scripts/espelhar-midia-antiga.ts [--aplicar]
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { espelharMidiaRecebida } from "../supabase/functions/_shared/mirror-inbound-media.ts";

const PROJECT_REF = "jsjsmuncfkbsbzqzqhfq";
const APLICAR = Deno.args.includes("--aplicar");

function rodar(cmd: string, args: string[]): string {
  const p = new Deno.Command(cmd, { args }).outputSync();
  return new TextDecoder().decode(p.stdout).trim();
}

// A chave nunca é impressa nem gravada — sai do keychain e vive só em memória.
const SERVICE_KEY = rodar("node", ["scripts/prod-key.mjs"]);
const supabase = createClient(`https://${PROJECT_REF}.supabase.co`, SERVICE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await supabase
  .from("channel_messages")
  .select("id, organization_id, media_url, metadata")
  .eq("direction", "incoming")
  .not("metadata->midia", "is", null);

if (error) throw new Error(error.message);

type Linha = {
  id: string;
  organization_id: string;
  media_url: string | null;
  metadata: { midia?: { url?: string; especie?: string; mime?: string | null; espelhada?: boolean } };
};

const pendentes = (data as Linha[]).filter((l) => l.metadata?.midia?.url && !l.metadata.midia.espelhada);
console.log(`${pendentes.length} arquivo(s) ainda no fornecedor${APLICAR ? "" : "  (ENSAIO)"}`);

let ok = 0;
let falhou = 0;

for (const linha of pendentes) {
  const m = linha.metadata.midia!;
  if (!APLICAR) {
    // No ensaio só se confere que o link ainda responde — sem baixar o corpo
    // inteiro nem escrever nada.
    const r = await fetch(m.url!, { method: "GET", headers: { range: "bytes=0-64" } });
    console.log(`  ${r.ok ? "vivo " : "morto"} ${r.status} ${r.headers.get("content-type")} ${linha.id}`);
    r.ok ? ok++ : falhou++;
    await r.body?.cancel();
    continue;
  }

  const espelho = await espelharMidiaRecebida(m.url!, {
    organizationId: linha.organization_id,
    especie: (m.especie ?? "indefinida") as never,
    mimeDeclarado: m.mime ?? null,
    storage: supabase.storage as never,
  });

  if (!espelho.espelhada) {
    falhou++;
    console.log(`  falhou ${linha.id}`);
    continue;
  }

  const { error: erroUpdate } = await supabase
    .from("channel_messages")
    .update({
      media_url: espelho.url,
      metadata: {
        ...linha.metadata,
        midia: { ...m, url: espelho.url, mime: espelho.mime ?? m.mime, espelhada: true },
      },
    })
    .eq("id", linha.id);

  if (erroUpdate) {
    // O arquivo já subiu; só a linha não apontou para ele. Vale relatar em vez
    // de morrer: a próxima passada tenta de novo, e o custo é um órfão no bucket.
    falhou++;
    console.log(`  subiu mas não gravou ${linha.id}: ${erroUpdate.message}`);
    continue;
  }

  ok++;
  console.log(`  ok ${espelho.mime} ${linha.id}`);
}

console.log(`\n${ok} ok, ${falhou} falha(s)`);
