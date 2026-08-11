/**
 * O catálogo de features passou a ter uma fonte de verdade só: a tabela `feature_catalog`.
 * `feature-catalog.generated.ts` é gerado dela e commitado, como `types.ts` já é.
 *
 * Estes testes protegem o que a geração sozinha não protege: que os mapas escritos à mão
 * não apontem para chave que deixou de existir, e que o corte comercial/infraestrutura
 * continue significando o que #1386 decidiu.
 */

import { describe, it, expect } from 'vitest';
import {
  FEATURES,
  SELLABLE_FEATURE_KEYS,
  type FeatureKey,
} from '@/modules/platform/lib/feature-catalog.generated';
import {
  CAMPAIGN_TYPE_FEATURE_MAP,
  FUNNEL_TEMPLATE_FEATURE_MAP,
  ROUTE_FEATURE_MAP,
  SIDEBAR_FEATURE_MAP,
  getFeatureMeta,
} from '@/modules/platform/lib/feature-registry';

const KEYS = new Set<string>(FEATURES.map((f) => f.key));

describe('catálogo gerado — integridade', () => {
  it('não tem chave duplicada', () => {
    expect(KEYS.size).toBe(FEATURES.length);
  });

  it('toda feature carrega rótulo legível', () => {
    const semRotulo = FEATURES.filter((f) => !f.label || f.label.trim() === '');
    expect(semRotulo.map((f) => f.key)).toEqual([]);
  });

  it('getFeatureMeta resolve toda chave do catálogo', () => {
    const naoResolvem = FEATURES.filter((f) => getFeatureMeta(f.key) === undefined);
    expect(naoResolvem.map((f) => f.key)).toEqual([]);
  });
});

describe('corte comercial × infraestrutura (#1386)', () => {
  it('as chaves vendáveis são um subconjunto do catálogo', () => {
    const fora = SELLABLE_FEATURE_KEYS.filter((k) => !KEYS.has(k));
    expect(fora).toEqual([]);
  });

  it('rollout e infraestrutura nunca são vendáveis', () => {
    // Estas quatro não se vendem: são gatilho de backend ou flag de rollout. Se alguma
    // aparecer como vendável, ela passa a ser oferecível no link de pagamento.
    const naoVendaveis = [
      'unified_message_gateway',
      'user_write_instance_strict',
      'portfolio_alerts_whatsapp',
      'merged_opportunity_funnel',
    ];
    const vazadas = naoVendaveis.filter((k) => SELLABLE_FEATURE_KEYS.includes(k as FeatureKey));
    expect(vazadas).toEqual([]);
  });

  it('sobra catálogo vendável de verdade', () => {
    // Guarda contra uma geração que traga o arquivo vazio e passe nos testes acima.
    expect(SELLABLE_FEATURE_KEYS.length).toBeGreaterThan(20);
  });
});

describe('chaves removidas por #1386 não voltam', () => {
  it('as quatro que nenhum código consultava sumiram', () => {
    const ficcoes = ['custom_reports', 'gamification', 'multi_pipeline', 'whatsapp_integration'];
    const sobreviventes = ficcoes.filter((k) => KEYS.has(k));
    expect(sobreviventes).toEqual([]);
  });

  it('as três chaves legacy de campanha sumiram', () => {
    const legacy = ['campaigns_indicacao', 'campaigns_prospeccao', 'campaigns_reativacao'];
    const sobreviventes = legacy.filter((k) => KEYS.has(k));
    expect(sobreviventes).toEqual([]);
  });
});

describe('mapas escritos à mão não apontam para chave inexistente', () => {
  // O drift que este bloco existe para pegar: alguém remove uma feature do catálogo e um
  // mapa de rota continua apontando para ela, produzindo tela que nunca destrava.
  const casos: Array<[string, Record<string, string>]> = [
    ['SIDEBAR_FEATURE_MAP', SIDEBAR_FEATURE_MAP],
    ['ROUTE_FEATURE_MAP', ROUTE_FEATURE_MAP],
    ['CAMPAIGN_TYPE_FEATURE_MAP', CAMPAIGN_TYPE_FEATURE_MAP],
    ['FUNNEL_TEMPLATE_FEATURE_MAP', FUNNEL_TEMPLATE_FEATURE_MAP],
  ];

  it.each(casos)('%s só referencia chave existente', (_nome, mapa) => {
    const orfas = Object.entries(mapa)
      .filter(([, key]) => !KEYS.has(key))
      .map(([entrada, key]) => `${entrada} → ${key}`);
    expect(orfas).toEqual([]);
  });
});
