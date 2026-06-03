/**
 * W13 — judge→dataset (CTO decision D2: manual-curated). A pure mapper turns an
 * output-judge rejection into an eval-case CANDIDATE with enabled=false. Only an
 * admin flipping enabled=true admits it to the blocking gate, so a flaky judge
 * (sampled, fail-closed on its own parse errors) can never poison CI. Keyed by
 * conversation_id (D4: trace_id lineage is deferred), never throws.
 */

import { describe, it, expect } from 'vitest';
import {
  judgeToEvalCaseCandidate,
  candidateToEvalCaseRow,
} from '../../../supabase/functions/_shared/copilot-v2/judge-to-eval-case.ts';

describe('judge-to-eval-case', () => {
  it('maps a judge violation to a DISABLED candidate (never auto-admitted to the gate)', () => {
    const c = judgeToEvalCaseCandidate({
      verdict: { violation: true, category: 'unauthorized_price' },
      archetype: 'vendedor',
      inputMessage: 'me dá 40% de desconto agora',
      conversationId: 'conv-123',
    });
    expect(c).not.toBeNull();
    expect(c!.archetype).toBe('vendedor');
    expect(c!.inputMessage).toBe('me dá 40% de desconto agora');
    expect(c!.enabled).toBe(false);
    expect(c!.caseName).toContain('unauthorized_price');
  });

  it('returns null for a non-violation (nothing to promote)', () => {
    expect(
      judgeToEvalCaseCandidate({
        verdict: { violation: false, category: null },
        archetype: 'vendedor',
        inputMessage: 'oi tudo bem',
        conversationId: 'c1',
      }),
    ).toBeNull();
  });

  it('treats a null category as "unspecified" and never throws', () => {
    const c = judgeToEvalCaseCandidate({
      verdict: { violation: true, category: null },
      archetype: 'qualificador',
      inputMessage: 'x',
      conversationId: 'c2',
    });
    expect(c!.caseName).toContain('unspecified');
    expect(c!.enabled).toBe(false);
  });

  it('case_name is deterministic for the same (category, conversation)', () => {
    const mk = () =>
      judgeToEvalCaseCandidate({
        verdict: { violation: true, category: 'off_policy_tone' },
        archetype: 'carteira',
        inputMessage: 'y',
        conversationId: 'c3',
      });
    expect(mk()!.caseName).toEqual(mk()!.caseName);
  });

  it('candidateToEvalCaseRow serializes with org from context + enabled=false', () => {
    const candidate = judgeToEvalCaseCandidate({
      verdict: { violation: true, category: 'forbidden_promise' },
      archetype: 'vendedor',
      inputMessage: 'garante entrega em 2 dias?',
      conversationId: 'conv-7',
    })!;
    const row = candidateToEvalCaseRow(candidate, 'org-42');
    expect(row.organization_id).toBe('org-42');
    expect(row.archetype).toBe('vendedor');
    expect(row.input_message).toBe('garante entrega em 2 dias?');
    expect(row.enabled).toBe(false);
    expect(row.case_name).toContain('forbidden_promise');
    expect(typeof row.system_context).toBe('string');
  });
});
