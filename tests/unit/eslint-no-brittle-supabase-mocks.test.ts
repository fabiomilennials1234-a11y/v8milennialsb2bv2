import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import rule from '../../eslint-rules/no-brittle-supabase-mocks.js';

function lint(code: string): Linter.LintMessage[] {
  const linter = new Linter();
  return linter.verify(code, {
    plugins: {
      custom: { rules: { 'no-brittle-supabase-mocks': rule } },
    },
    rules: {
      'custom/no-brittle-supabase-mocks': 'warn',
    },
  });
}

describe('no-brittle-supabase-mocks', () => {
  it('flags vi.fn().mockReturnValue({ select: vi.fn() }) pattern', () => {
    const msgs = lint(`const mock = vi.fn().mockReturnValue({ select: vi.fn() });`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('custom/no-brittle-supabase-mocks');
  });

  it('flags mockFrom.mockReturnValue({ select: ... }) pattern', () => {
    const msgs = lint(
      `mockFrom.mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn() }) });`
    );
    // Both outer ({ select }) and inner ({ eq }) are brittle chain mocks
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0].ruleId).toBe('custom/no-brittle-supabase-mocks');
  });

  it('flags mockResolvedValue with Supabase chain methods', () => {
    const msgs = lint(`mock.mockResolvedValue({ from: vi.fn(), select: vi.fn() });`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].ruleId).toBe('custom/no-brittle-supabase-mocks');
  });

  it('does NOT flag legitimate mockReturnValue on non-Supabase objects', () => {
    expect(lint(`mockFetch.mockReturnValue({ ok: true, json: vi.fn() });`)).toHaveLength(0);
    expect(lint(`mock.mockReturnValue({ data: [], error: null });`)).toHaveLength(0);
    expect(lint(`vi.fn().mockReturnValue(42);`)).toHaveLength(0);
    expect(lint(`vi.fn().mockReturnValue("hello");`)).toHaveLength(0);
  });

  it('does NOT flag createMockSupabase usage', () => {
    expect(lint(`const { sb, mockTable } = createMockSupabase();`)).toHaveLength(0);
    expect(
      lint(`const mock = createMockSupabase(); mock.mockTable('leads', []);`)
    ).toHaveLength(0);
  });

  it('rule message includes suggestion to use createMockSupabase', () => {
    const msgs = lint(`const mock = vi.fn().mockReturnValue({ eq: vi.fn() });`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].message).toContain('createMockSupabase');
  });

  it('detects nested chain patterns with order/filter/single', () => {
    const msgs1 = lint(
      `mock.mockReturnValue({ order: vi.fn().mockReturnValue({ single: vi.fn() }) });`
    );
    // Both outer ({ order }) and inner ({ single }) are brittle mocks
    expect(msgs1.length).toBeGreaterThanOrEqual(1);
    expect(msgs1.every((m) => m.ruleId === 'custom/no-brittle-supabase-mocks')).toBe(true);

    const msgs2 = lint(`mock.mockReturnValue({ filter: vi.fn() });`);
    expect(msgs2).toHaveLength(1);
  });
});
