#!/usr/bin/env node
/**
 * Gera `src/modules/platform/lib/feature-catalog.generated.ts` a partir da tabela
 * `public.feature_catalog`.
 *
 * A tabela é a fonte de verdade do catálogo de features (decisão de #1386). Este script
 * existe para que o TypeScript continue tendo a união literal `FeatureKey` — e portanto
 * checagem em tempo de compilação nos ~12 arquivos que consomem — sem que ninguém precise
 * manter a lista à mão em dois lugares.
 *
 * Mesmo padrão de `src/integrations/supabase/types.ts`: gerado do banco e commitado.
 *
 * Uso:
 *   node scripts/gen-feature-catalog.mjs                  # lê do banco e escreve o arquivo
 *   node scripts/gen-feature-catalog.mjs --check          # falha se o arquivo estiver defasado
 *   node scripts/gen-feature-catalog.mjs --from-json f.js # gera de um dump, sem banco
 *
 * Variáveis: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_ANON_KEY — a leitura do
 * catálogo é liberada para authenticated).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/modules/platform/lib/feature-catalog.generated.ts');

/**
 * Filtros transitórios — viram no-op assim que as migrations da fatia 2 rodarem.
 *
 * Enquanto `20270805000001` não for aplicada, o banco ainda tem as quatro chaves que
 * nenhum código consulta; enquanto `20270805000000` não for aplicada, ainda não existe a
 * coluna `is_sellable`. Os dois blocos abaixo deixam a geração determinística nos dois
 * estados. Depois das migrations, remover.
 */
const TRANSITIONAL_DROPPED = ['custom_reports', 'gamification', 'multi_pipeline', 'whatsapp_integration'];
const TRANSITIONAL_NON_SELLABLE = [
  'unified_message_gateway',
  'user_write_instance_strict',
  'portfolio_alerts_whatsapp',
  'merged_opportunity_funnel',
];

const COLUMNS = 'key,name,display_name,description,icon,category,sidebar_path,feature_type,position,default_enabled';

async function fetchFromDatabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_ANON_KEY) são obrigatórias, ' +
        'ou use --from-json.',
    );
  }

  // Tenta a tabela nova; cai para a antiga enquanto a migration de rename não rodou.
  for (const [table, cols] of [
    ['feature_catalog', `${COLUMNS},is_sellable`],
    ['feature_flags', COLUMNS],
  ]) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${cols}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.ok) return await res.json();
  }

  throw new Error('não foi possível ler feature_catalog nem feature_flags');
}

function normalise(rows) {
  return rows
    .filter((r) => !TRANSITIONAL_DROPPED.includes(r.key))
    .map((r) => ({
      key: r.key,
      label: r.display_name || r.name || r.key,
      description: r.description || '',
      icon: r.icon || null,
      category: r.category || 'modules',
      sidebarPath: r.sidebar_path || null,
      featureType: r.feature_type || 'boolean',
      position: r.position ?? 0,
      defaultEnabled: Boolean(r.default_enabled),
      isSellable:
        typeof r.is_sellable === 'boolean'
          ? r.is_sellable
          : !TRANSITIONAL_NON_SELLABLE.includes(r.key),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

const lit = (v) => (v === null ? 'null' : JSON.stringify(v));

function render(features) {
  const keys = features.map((f) => `  | ${JSON.stringify(f.key)}`).join('\n');
  const entries = features
    .map(
      (f) => `  {
    key: ${lit(f.key)},
    label: ${lit(f.label)},
    description: ${lit(f.description)},
    icon: ${lit(f.icon)},
    category: ${lit(f.category)},
    sidebarPath: ${lit(f.sidebarPath)},
    featureType: ${lit(f.featureType)},
    position: ${f.position},
    defaultEnabled: ${f.defaultEnabled},
    isSellable: ${f.isSellable},
  },`,
    )
    .join('\n');
  const sellable = features
    .filter((f) => f.isSellable)
    .map((f) => `  ${JSON.stringify(f.key)},`)
    .join('\n');

  return `/**
 * GERADO AUTOMATICAMENTE — NÃO EDITE À MÃO.
 *
 * Fonte: tabela \`public.feature_catalog\`.
 * Regerar: \`node scripts/gen-feature-catalog.mjs\`
 *
 * Editar este arquivo não muda o comportamento do produto: a resolução de features em
 * runtime lê o banco, não daqui. Uma edição manual só cria divergência, que o teste de
 * paridade em \`tests/integration/feature-catalog-parity.test.ts\` reprova.
 */

export type FeatureKey =
${keys};

export type FeatureCategory = string;

export interface FeatureMeta {
  key: FeatureKey;
  label: string;
  description: string;
  /** Nome do ícone Lucide, quando a feature aparece em superfície visual. */
  icon: string | null;
  category: FeatureCategory;
  sidebarPath: string | null;
  featureType: string;
  position: number;
  defaultEnabled: boolean;
  /** true = comercial: oferecível no link de pagamento e congelada no snapshot. */
  isSellable: boolean;
}

export const FEATURES: FeatureMeta[] = [
${entries}
];

/** Chaves que o montador do link pode vender. Ver decisão de #1386. */
export const SELLABLE_FEATURE_KEYS: FeatureKey[] = [
${sellable}
];
`;
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const check = args.includes('--check');
const jsonFlag = args.indexOf('--from-json');

const rows =
  jsonFlag !== -1
    ? JSON.parse(readFileSync(resolve(process.cwd(), args[jsonFlag + 1]), 'utf8'))
    : await fetchFromDatabase();

const output = render(normalise(rows));

if (check) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== output) {
    console.error(
      'feature-catalog.generated.ts está defasado em relação ao banco.\n' +
        'Rode: node scripts/gen-feature-catalog.mjs',
    );
    process.exit(1);
  }
  console.log('feature-catalog.generated.ts em dia.');
} else {
  writeFileSync(OUT, output);
  console.log(`escrito ${OUT}`);
}
