/**
 * Paridade entre a tabela `feature_catalog` e o arquivo gerado dela.
 *
 * A tabela é a fonte de verdade (#1386) e o TypeScript é derivado. Sem este teste, alguém
 * cadastra uma feature no Master, o arquivo gerado não é regerado, e o produto passa a ter
 * uma feature que o montador do link de pagamento não consegue oferecer — exatamente o
 * drift que a decisão de fonte única existe para impedir.
 *
 * Requer Supabase local (`supabase start`). Pulado quando não há instância.
 */

import { describe, it, expect } from 'vitest';
import { supabase } from './setup';
import { FEATURES, SELLABLE_FEATURE_KEYS } from '@/modules/platform/lib/feature-catalog.generated';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

interface CatalogRow {
  key: string;
  is_sellable: boolean;
}

describe.skipIf(shouldSkip)('feature_catalog ↔ arquivo gerado', () => {
  it('o conjunto de chaves é idêntico', async () => {
    const { data, error } = await supabase
      .from('feature_catalog')
      .select('key,is_sellable')
      .returns<CatalogRow[]>();

    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const noBanco = (data ?? []).map((r) => r.key).sort();
    const noArquivo = FEATURES.map((f) => f.key).sort();

    // Diferença nos dois sentidos, para que a mensagem diga o que fazer.
    const soNoBanco = noBanco.filter((k) => !noArquivo.includes(k));
    const soNoArquivo = noArquivo.filter((k) => !noBanco.includes(k));

    expect(
      { soNoBanco, soNoArquivo },
      'rode `node scripts/gen-feature-catalog.mjs` para regerar o catálogo',
    ).toEqual({ soNoBanco: [], soNoArquivo: [] });
  });

  it('is_sellable bate chave a chave', async () => {
    const { data } = await supabase
      .from('feature_catalog')
      .select('key,is_sellable')
      .returns<CatalogRow[]>();

    const vendaveisNoBanco = (data ?? [])
      .filter((r) => r.is_sellable)
      .map((r) => r.key)
      .sort();

    expect(vendaveisNoBanco).toEqual([...SELLABLE_FEATURE_KEYS].sort());
  });

  it('a view de compatibilidade feature_flags ainda responde', async () => {
    // A fase contract da fatia 2 remove esta view. Enquanto ela existir, os leitores
    // antigos — 5 edge functions e 2 hooks do front — dependem dela.
    const { error } = await supabase.from('feature_flags').select('key').limit(1);
    expect(error).toBeNull();
  });
});
