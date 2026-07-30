#!/usr/bin/env node
/**
 * Recusa `npm run dev` apontado para PRODUÇÃO.
 *
 * Por que existe: em 2026-07-30 dois servidores de dev estavam de pé nesta
 * máquina havia dois dias, ambos servindo o Supabase de produção. Ler era
 * inofensivo; qualquer clique que salvasse escrevia em prod. A proteção não
 * pode depender de alguém lembrar qual `.env` está valendo.
 *
 * Espelha a precedência do Vite para `mode=development` (o último vence):
 *   .env  <  .env.local  <  .env.development  <  .env.development.local
 *
 * Escape deliberado: `ALLOW_PROD_DEV=1 npm run dev`. Existe para não virar
 * obstáculo quando apontar pra prod é mesmo a intenção — mas exige dizer isso
 * em voz alta, que é o ponto.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PROD_REF = "jsjsmuncfkbsbzqzqhfq";
const DEV_APOSENTADO_REF = "bcfadphgsibjzivtbjvc";

// Ordem do Vite em modo development — o último a definir a chave vence.
const ARQUIVOS = [".env", ".env.local", ".env.development", ".env.development.local"];

const vermelho = (s) => `\x1b[1;31m${s}\x1b[0m`;
const amarelo = (s) => `\x1b[1;33m${s}\x1b[0m`;
const verde = (s) => `\x1b[1;32m${s}\x1b[0m`;

function lerEnv(caminho) {
  if (!existsSync(caminho)) return {};
  const out = {};
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const resolvido = {};
const origem = {};
for (const nome of ARQUIVOS) {
  const vals = lerEnv(resolve(RAIZ, nome));
  for (const [k, v] of Object.entries(vals)) {
    resolvido[k] = v;
    origem[k] = nome;
  }
}

const url = resolvido.VITE_SUPABASE_URL ?? "";
const arquivo = origem.VITE_SUPABASE_URL ?? "(nenhum)";

if (!url) {
  console.error(vermelho("\n✖ VITE_SUPABASE_URL não está definida em nenhum .env."));
  console.error("  Rode: npm run dev:branch  (aponta para a branch efêmera)\n");
  process.exit(1);
}

if (url.includes(PROD_REF)) {
  if (process.env.ALLOW_PROD_DEV === "1") {
    console.warn(amarelo(`\n⚠ dev apontado para PRODUÇÃO (${PROD_REF}), liberado por ALLOW_PROD_DEV=1.`));
    console.warn(amarelo(`  Definido em ${arquivo}. Todo salvamento na tela escreve em prod.\n`));
    process.exit(0);
  }
  console.error(vermelho(`\n✖ RECUSADO: o dev está apontado para PRODUÇÃO (${PROD_REF}).`));
  console.error(`  VITE_SUPABASE_URL vem de ${amarelo(arquivo)}.`);
  console.error("\n  Qualquer clique que salve na tela escreve no banco dos clientes.");
  console.error("\n  Saídas:");
  console.error("    npm run dev:branch            aponta para a branch efêmera (recomendado)");
  console.error("    ALLOW_PROD_DEV=1 npm run dev  se apontar pra prod é mesmo a intenção\n");
  process.exit(1);
}

if (url.includes(DEV_APOSENTADO_REF)) {
  console.error(vermelho(`\n✖ RECUSADO: alvo é o projeto de dev APOSENTADO (${DEV_APOSENTADO_REF}).`));
  console.error(`  Vem de ${amarelo(arquivo)}. Esse projeto está fora de uso e centenas de`);
  console.error("  migrations atrás — a tela mentiria sobre o schema.");
  console.error("\n  Rode: npm run dev:branch\n");
  process.exit(1);
}

const ref = url.match(/https:\/\/([a-z]{20})\.supabase\.co/)?.[1] ?? url;
console.log(verde(`✓ dev apontado para ${ref} (via ${arquivo}) — não é prod.`));
