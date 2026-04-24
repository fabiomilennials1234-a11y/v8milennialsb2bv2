#!/usr/bin/env node
/**
 * Read-only drift checker — pipe_* vs leads para qualquer ambiente.
 *
 * Usa REST + service_role (nunca cliente anon). Não altera estado.
 *
 * Uso:
 *   DEV (padrão — lê de .env.development):
 *     node tools/check-pipe-drift.mjs
 *
 *   PROD (apenas sob autorização; senha/chave entregues no ambiente):
 *     SUPABASE_URL="https://jsjsmuncfkbsbzqzqhfq.supabase.co" \
 *     SERVICE_ROLE_KEY="<key>" \
 *       node tools/check-pipe-drift.mjs
 *
 * Imprime por tabela + coluna quantas linhas estão fora de sync com leads.
 * Em regime pós-migration 20260423120000, tudo deve ser 0.
 */

import { readFileSync, existsSync } from "node:fs";

function loadDotenvDev() {
  const path = ".env.development";
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const dotenv = loadDotenvDev();

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  dotenv.SUPABASE_URL ||
  dotenv.VITE_SUPABASE_URL;

const SERVICE_KEY =
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  dotenv.SUPABASE_SERVICE_ROLE_KEY ||
  dotenv.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "ERROR: defina SUPABASE_URL + SERVICE_ROLE_KEY (ou VITE_SUPABASE_URL/VITE_SUPABASE_SERVICE_ROLE_KEY em .env.development).",
  );
  process.exit(2);
}

/**
 * Execute one REST query with service_role. We fetch each pipe row joining
 * leads via PostgREST embed, and compare the two copies of the column
 * client-side. Paginates in chunks of 1000.
 */
async function drift({ table, pipeCol, leadCol = pipeCol }) {
  let offset = 0;
  let driftCount = 0;
  let totalScanned = 0;
  const pageSize = 1000;

  while (true) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set(
      "select",
      `id,organization_id,lead_id,${pipeCol},lead:leads!${table}_lead_id_fkey(${leadCol})`,
    );
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Accept-Profile": "public",
      },
    });

    if (!res.ok) {
      // fallback: some installs don't expose the FK name; try bare embed
      const altUrl = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
      altUrl.searchParams.set(
        "select",
        `id,organization_id,lead_id,${pipeCol},lead:leads(${leadCol})`,
      );
      altUrl.searchParams.set("limit", String(pageSize));
      altUrl.searchParams.set("offset", String(offset));
      const altRes = await fetch(altUrl, {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Accept-Profile": "public",
        },
      });
      if (!altRes.ok) {
        console.error(
          `  [${table}.${pipeCol}] HTTP ${altRes.status}: ${await altRes.text()}`,
        );
        return { driftCount: -1, totalScanned };
      }
      const altRows = await altRes.json();
      totalScanned += altRows.length;
      for (const row of altRows) {
        const pipeVal = row[pipeCol];
        const leadVal = row.lead?.[leadCol];
        if (pipeVal !== leadVal) driftCount++;
      }
      if (altRows.length < pageSize) break;
      offset += pageSize;
      continue;
    }

    const rows = await res.json();
    totalScanned += rows.length;
    for (const row of rows) {
      const pipeVal = row[pipeCol];
      const leadVal = row.lead?.[leadCol];
      if (pipeVal !== leadVal) driftCount++;
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return { driftCount, totalScanned };
}

const checks = [
  { table: "pipe_propostas", pipeCol: "closer_id" },
  { table: "pipe_propostas", pipeCol: "responsible_id" },
  { table: "pipe_confirmacao", pipeCol: "closer_id" },
  { table: "pipe_confirmacao", pipeCol: "sdr_id" },
  { table: "pipe_confirmacao", pipeCol: "responsible_id" },
  { table: "pipe_whatsapp", pipeCol: "sdr_id" },
  { table: "pipe_whatsapp", pipeCol: "responsible_id" },
];

console.log(`host = ${new URL(SUPABASE_URL).host}`);
console.log("────────────────────────────────────────────────────");

let anyDrift = 0;
for (const c of checks) {
  const label = `${c.table}.${c.pipeCol}`.padEnd(34);
  try {
    const { driftCount, totalScanned } = await drift(c);
    if (driftCount < 0) {
      console.log(`${label} ERROR — não consegui consultar`);
      continue;
    }
    anyDrift += driftCount;
    const status = driftCount === 0 ? "OK" : `DRIFT ×${driftCount}`;
    console.log(
      `${label} ${status.padEnd(14)} (${totalScanned.toLocaleString()} rows scanned)`,
    );
  } catch (err) {
    console.log(`${label} ERROR — ${err.message}`);
  }
}
console.log("────────────────────────────────────────────────────");
console.log(
  anyDrift === 0
    ? "RESULTADO: sem drift (✓). Invariante pipe_* ≡ leads.* mantido."
    : `RESULTADO: ${anyDrift} linha(s) em drift total. Precisa backfill (migration 20260423120000).`,
);
process.exit(anyDrift === 0 ? 0 : 1);
