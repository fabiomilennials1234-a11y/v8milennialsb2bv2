/**
 * W4 — Realismo de entrega (Copilot v2)
 *
 * Pure, zero-dep outbound delivery: split the agent reply into natural WhatsApp
 * chunks WITHOUT ever cutting a protected token (price / number / link / spec /
 * code), plan a human latency per chunk (first reply NEVER < 1s), and feed the
 * worker a deterministic delivery plan. Clock/latency are NOT read here — this
 * layer only computes the plan; the worker executes the sleeps + typing.
 *
 * SPEC L181: a reply NEVER arrives in < 1s; the agent NEVER sends an identical
 * message twice (dedup handled at the send spine, see queue-processor).
 */

import { describe, it, expect } from 'vitest';
import {
  splitReply,
  planDelays,
  buildDeliveryPlan,
  deliveryProfileFor,
  type DeliveryProfile,
} from '../../../supabase/functions/_shared/copilot-v2/outbound-delivery.ts';

// Small maxChars to force splits in tests; independent of production profiles.
const P: DeliveryProfile = {
  maxChars: 120,
  minChars: 20,
  readMsPerChar: 15,
  typeMsPerChar: 25,
  floorMs: 1000,
  capMs: 8000,
  minGapMs: 600,
};

/** How many chunks contain `token` whole. 1 = intact & un-split; 0 = it was cut. */
const wholeOccurrences = (chunks: string[], token: string) =>
  chunks.filter((c) => c.includes(token)).length;

describe('splitReply — boundaries', () => {
  it('splits a long multi-paragraph reply into multiple chunks', () => {
    const reply = [
      'Oi João, tudo bem? Vi que você pediu um orçamento pra nossa linha industrial.',
      'A gente trabalha com entrega em todo o Brasil e prazo médio de sete dias úteis.',
      'Posso te mandar a tabela completa agora ou prefere que eu ligue mais tarde?',
    ].join('\n\n');
    const chunks = splitReply(reply, P);
    expect(chunks.length).toBeGreaterThan(1);
    // order preserved
    expect(chunks[0]).toContain('Oi João');
    expect(chunks[chunks.length - 1]).toContain('prefere que eu ligue');
  });
});

describe('splitReply — hard guard (never cut a protected token)', () => {
  it('keeps a price token intact in exactly one chunk', () => {
    const reply =
      'Perfeito! Sobre o plano que você perguntou, ele sai por R$ 1.297,00 por mês. ' +
      'Esse valor já inclui suporte dedicado e implantação. ' +
      'Quer que eu detalhe o que vem em cada módulo pra você decidir?';
    const chunks = splitReply(reply, P);
    expect(chunks.length).toBeGreaterThan(1);
    expect(wholeOccurrences(chunks, 'R$ 1.297,00')).toBe(1);
  });

  it('keeps a URL intact in exactly one chunk', () => {
    const reply =
      'Claro, segue o catálogo completo pra você conferir com calma. ' +
      'O link é https://torquecrm.com.br/catalogo/2026-industrial.pdf e fica disponível por trinta dias. ' +
      'Qualquer dúvida sobre algum item me chama aqui!';
    const chunks = splitReply(reply, P);
    expect(wholeOccurrences(chunks, 'https://torquecrm.com.br/catalogo/2026-industrial.pdf')).toBe(1);
  });

  it('keeps a spec/measurement token intact in exactly one chunk', () => {
    const reply =
      'O modelo que atende seu projeto é o X-200/5mm, feito em aço inox 304. ' +
      'Ele suporta pressão de até 16bar sem perda de vazão. ' +
      'Te interessa que eu já reserve uma unidade?';
    const chunks = splitReply(reply, P);
    expect(wholeOccurrences(chunks, 'X-200/5mm')).toBe(1);
  });

  it('never splits inside an inline code span that contains sentence punctuation', () => {
    const reply =
      'Pra rodar a migração é só usar o comando `supabase db push. agora` no terminal. ' +
      'Depois disso o schema fica sincronizado com produção. ' +
      'Me avisa se aparecer algum erro no caminho!';
    const chunks = splitReply(reply, P);
    expect(wholeOccurrences(chunks, '`supabase db push. agora`')).toBe(1);
  });

  it('never splits inside a fenced code block that contains blank lines', () => {
    const reply =
      'Segue o exemplo de payload que você me pediu pra integração:\n\n' +
      '```json\n{\n  "source": "meta_ads",\n\n  "phone": "+5511999999999"\n}\n```\n\n' +
      'É só mandar esse corpo no POST e o lead entra direto no pipe.';
    const chunks = splitReply(reply, P);
    const block = '```json\n{\n  "source": "meta_ads",\n\n  "phone": "+5511999999999"\n}\n```';
    expect(wholeOccurrences(chunks, block)).toBe(1);
  });

  it('emits an over-long atomic segment whole rather than force-cutting a protected token', () => {
    // One long sentence (no internal sentence/paragraph boundary) that far
    // exceeds maxChars and contains a price — must NOT be force-cut.
    const longSentence =
      'Olha só, considerando tudo que conversamos sobre volume mensal e prazo de entrega ' +
      'e também o desconto progressivo que combinamos para pedidos recorrentes acima da cota, ' +
      'o valor final fechado para você fica em R$ 12.480,00 já com tudo incluso';
    const chunks = splitReply(longSentence, P);
    expect(chunks).toHaveLength(1);
    expect(wholeOccurrences(chunks, 'R$ 12.480,00')).toBe(1);
  });
});

describe('splitReply — fail-safe', () => {
  it('returns a single chunk for a short atomic reply', () => {
    expect(splitReply('Beleza, combinado!', P)).toEqual(['Beleza, combinado!']);
  });

  it('returns an empty array for empty / whitespace-only input', () => {
    expect(splitReply('', P)).toEqual([]);
    expect(splitReply('   \n\n  ', P)).toEqual([]);
  });

  it('never emits an orphan chunk shorter than minChars (merges tiny fragments)', () => {
    const reply =
      'Opa! ' +
      'Esse aqui é um parágrafo bem mais longo, pensado pra ultrapassar o limite e forçar uma quebra real.';
    const chunks = splitReply(reply, { ...P, maxChars: 60 });
    const tiny = chunks.filter((c) => c.length < P.minChars);
    expect(tiny).toEqual([]);
  });

  it('is deterministic — same input yields the same chunks', () => {
    const reply =
      'Primeira ideia aqui pra gente alinhar. ' +
      'Segunda ideia logo na sequência pra fechar o raciocínio. ' +
      'E uma pergunta no final pra te ouvir?';
    expect(splitReply(reply, P)).toEqual(splitReply(reply, P));
  });

  it('preserves all visible content (chunks rejoin to the original modulo whitespace)', () => {
    const reply =
      'Bom dia! Tudo certo por aí?\n\n' +
      'Queria te apresentar uma condição especial que liberamos essa semana. ' +
      'São R$ 500,00 de bônus na primeira compra. ' +
      'Topa dar uma olhada?';
    const chunks = splitReply(reply, P);
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(norm(chunks.join(' '))).toBe(norm(reply));
  });
});

describe('planDelays — human latency', () => {
  it('floors the first reply delay at floorMs (never < 1s), even for a tiny reply and zero inbound', () => {
    const delays = planDelays(['oi'], 0, P);
    expect(delays[0]).toBe(1000);
    expect(delays[0]).toBeGreaterThanOrEqual(P.floorMs);
  });

  it('scales the first delay with inbound length (read time)', () => {
    const short = planDelays(['ok'], 0, P)[0];
    const long = planDelays(['ok'], 300, P)[0];
    expect(long).toBeGreaterThan(short);
  });

  it('computes first delay as readMs*inboundLen + typeMs*firstChunk when between floor and cap', () => {
    // 15*50 + 25*30 = 1500, inside [1000, 8000]
    const chunk = 'x'.repeat(30);
    expect(planDelays([chunk], 50, P)[0]).toBe(1500);
  });

  it('caps any delay at capMs', () => {
    expect(planDelays(['ok'], 100_000, P)[0]).toBe(8000);
  });

  it('delays non-first chunks by typing time, floored at minGapMs and capped at capMs', () => {
    const delays = planDelays(['primeira', 'curto', 'y'.repeat(1000)], 0, P);
    expect(delays).toHaveLength(3);
    expect(delays[1]).toBe(600); // 25*5=125 -> floored to minGapMs
    expect(delays[2]).toBe(8000); // 25*1000 -> capped
  });

  it('returns an empty array for no chunks', () => {
    expect(planDelays([], 100, P)).toEqual([]);
  });

  it('is deterministic', () => {
    expect(planDelays(['a', 'bbbb', 'cc'], 42, P)).toEqual(planDelays(['a', 'bbbb', 'cc'], 42, P));
  });
});

describe('buildDeliveryPlan', () => {
  it('returns aligned chunks + delays, with the first delay floored at 1s', () => {
    const plan = buildDeliveryPlan(
      'Oi! Tudo bem? Quero te mandar uma proposta completa agora mesmo pra você analisar.',
      40,
      P,
    );
    expect(plan.chunks.length).toBe(plan.delays.length);
    expect(plan.chunks.length).toBeGreaterThan(0);
    expect(plan.delays[0]).toBeGreaterThanOrEqual(1000);
    expect(plan.chunks.join(' ')).toContain('proposta');
  });

  it('returns empty chunks and delays for an empty reply', () => {
    expect(buildDeliveryPlan('', 100, P)).toEqual({ chunks: [], delays: [] });
  });
});

describe('deliveryProfileFor — per-archetype profiles', () => {
  it('gives every archetype a profile that honours the ≥1s floor and a sane size band', () => {
    for (const archetype of ['qualificador', 'vendedor', 'carteira'] as const) {
      const prof = deliveryProfileFor(archetype);
      expect(prof.floorMs).toBeGreaterThanOrEqual(1000);
      expect(prof.capMs).toBeGreaterThanOrEqual(prof.floorMs);
      expect(prof.maxChars).toBeGreaterThan(prof.minChars);
    }
  });

  it('falls back to a safe default profile for an unknown archetype', () => {
    // deliberately off-contract input — must never throw or drop below the floor
    const prof = deliveryProfileFor('desconhecido' as unknown as 'qualificador');
    expect(prof.floorMs).toBeGreaterThanOrEqual(1000);
    expect(prof.maxChars).toBeGreaterThan(prof.minChars);
  });
});
