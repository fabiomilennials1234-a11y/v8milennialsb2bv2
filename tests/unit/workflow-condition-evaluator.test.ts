import { describe, it, expect } from 'vitest';
import {
  compare,
  compareAnyResponsible,
} from '../../supabase/functions/_shared/workflow-condition-evaluator';

describe('workflow-condition-evaluator — compare()', () => {
  // 1. equals
  it('equals: "abc" equals "abc" → true', () => {
    expect(compare('abc', 'equals', 'abc')).toBe(true);
  });
  it('equals: case-insensitive', () => {
    expect(compare('ABC', 'equals', 'abc')).toBe(true);
  });
  it('equals: "abc" equals "xyz" → false', () => {
    expect(compare('abc', 'equals', 'xyz')).toBe(false);
  });

  // 2. not_equals
  it('not_equals: "abc" not_equals "xyz" → true', () => {
    expect(compare('abc', 'not_equals', 'xyz')).toBe(true);
  });
  it('not_equals: "abc" not_equals "abc" → false', () => {
    expect(compare('abc', 'not_equals', 'abc')).toBe(false);
  });

  // 3. contains
  it('contains: "hello world" contains "world" → true', () => {
    expect(compare('hello world', 'contains', 'world')).toBe(true);
  });
  it('contains: "hello" contains "xyz" → false', () => {
    expect(compare('hello', 'contains', 'xyz')).toBe(false);
  });

  // 4. not_contains
  it('not_contains: "hello" not_contains "xyz" → true', () => {
    expect(compare('hello', 'not_contains', 'xyz')).toBe(true);
  });
  it('not_contains: "hello world" not_contains "world" → false', () => {
    expect(compare('hello world', 'not_contains', 'world')).toBe(false);
  });

  // 5. greater_than
  it('greater_than: 85 greater_than 80 → true', () => {
    expect(compare(85, 'greater_than', '80')).toBe(true);
  });
  it('greater_than: 70 greater_than 80 → false', () => {
    expect(compare(70, 'greater_than', '80')).toBe(false);
  });

  // 6. less_than
  it('less_than: 70 less_than 80 → true', () => {
    expect(compare(70, 'less_than', '80')).toBe(true);
  });
  it('less_than: 90 less_than 80 → false', () => {
    expect(compare(90, 'less_than', '80')).toBe(false);
  });

  // 7. greater_or_equal
  it('greater_or_equal: 80 >= 80 → true', () => {
    expect(compare(80, 'greater_or_equal', '80')).toBe(true);
  });
  it('greater_or_equal: 85 >= 80 → true', () => {
    expect(compare(85, 'greater_or_equal', '80')).toBe(true);
  });
  it('greater_or_equal: 70 >= 80 → false', () => {
    expect(compare(70, 'greater_or_equal', '80')).toBe(false);
  });

  // 8. less_or_equal
  it('less_or_equal: 80 <= 80 → true', () => {
    expect(compare(80, 'less_or_equal', '80')).toBe(true);
  });
  it('less_or_equal: 70 <= 80 → true', () => {
    expect(compare(70, 'less_or_equal', '80')).toBe(true);
  });
  it('less_or_equal: 90 <= 80 → false', () => {
    expect(compare(90, 'less_or_equal', '80')).toBe(false);
  });

  // 9. is_empty
  it('is_empty: "" is_empty → true', () => {
    expect(compare('', 'is_empty', '')).toBe(true);
  });
  it('is_empty: null is_empty → true', () => {
    expect(compare(null, 'is_empty', '')).toBe(true);
  });
  it('is_empty: "  " (whitespace) is_empty → true', () => {
    expect(compare('  ', 'is_empty', '')).toBe(true);
  });
  it('is_empty: "value" is_empty → false', () => {
    expect(compare('value', 'is_empty', '')).toBe(false);
  });

  // 10. is_not_empty
  it('is_not_empty: "value" is_not_empty → true', () => {
    expect(compare('value', 'is_not_empty', '')).toBe(true);
  });
  it('is_not_empty: "" is_not_empty → false', () => {
    expect(compare('', 'is_not_empty', '')).toBe(false);
  });
  it('is_not_empty: null is_not_empty → false', () => {
    expect(compare(null, 'is_not_empty', '')).toBe(false);
  });

  // 11. has_tag
  it('has_tag: "vip,hot" has_tag "vip" → true', () => {
    expect(compare('vip,hot', 'has_tag', 'vip')).toBe(true);
  });
  it('has_tag: "cold" has_tag "hot" → false', () => {
    expect(compare('cold', 'has_tag', 'hot')).toBe(false);
  });

  // 12. not_has_tag
  it('not_has_tag: "cold" not_has_tag "hot" → true', () => {
    expect(compare('cold', 'not_has_tag', 'hot')).toBe(true);
  });
  it('not_has_tag: "vip,hot" not_has_tag "vip" → false', () => {
    expect(compare('vip,hot', 'not_has_tag', 'vip')).toBe(false);
  });

  // 13. in_stage
  it('in_stage: "qualificacao" in_stage "qualificacao" → true', () => {
    expect(compare('qualificacao', 'in_stage', 'qualificacao')).toBe(true);
  });
  it('in_stage: case-insensitive', () => {
    expect(compare('Qualificacao', 'in_stage', 'qualificacao')).toBe(true);
  });
  it('in_stage: "negociacao" in_stage "qualificacao" → false', () => {
    expect(compare('negociacao', 'in_stage', 'qualificacao')).toBe(false);
  });

  // 14. not_in_stage
  it('not_in_stage: "negociacao" not_in_stage "qualificacao" → true', () => {
    expect(compare('negociacao', 'not_in_stage', 'qualificacao')).toBe(true);
  });
  it('not_in_stage: "qualificacao" not_in_stage "qualificacao" → false', () => {
    expect(compare('qualificacao', 'not_in_stage', 'qualificacao')).toBe(false);
  });

  // 15. starts_with
  it('starts_with: "hello world" starts_with "hello" → true', () => {
    expect(compare('hello world', 'starts_with', 'hello')).toBe(true);
  });
  it('starts_with: "hello" starts_with "world" → false', () => {
    expect(compare('hello', 'starts_with', 'world')).toBe(false);
  });

  // 16. ends_with
  it('ends_with: "hello world" ends_with "world" → true', () => {
    expect(compare('hello world', 'ends_with', 'world')).toBe(true);
  });
  it('ends_with: "hello" ends_with "world" → false', () => {
    expect(compare('hello', 'ends_with', 'world')).toBe(false);
  });

  // 17. in_list
  it('in_list: "banana" in_list "apple,banana,cherry" → true', () => {
    expect(compare('banana', 'in_list', 'apple,banana,cherry')).toBe(true);
  });
  it('in_list: "grape" in_list "apple,banana,cherry" → false', () => {
    expect(compare('grape', 'in_list', 'apple,banana,cherry')).toBe(false);
  });

  // 18. not_in_list
  it('not_in_list: "grape" not_in_list "apple,banana,cherry" → true', () => {
    expect(compare('grape', 'not_in_list', 'apple,banana,cherry')).toBe(true);
  });
  it('not_in_list: "banana" not_in_list "apple,banana,cherry" → false', () => {
    expect(compare('banana', 'not_in_list', 'apple,banana,cherry')).toBe(false);
  });

  // 19. is_true
  it('is_true: "true" is_true → true', () => {
    expect(compare('true', 'is_true', '')).toBe(true);
  });
  it('is_true: "1" is_true → true', () => {
    expect(compare('1', 'is_true', '')).toBe(true);
  });
  it('is_true: true (boolean) is_true → true', () => {
    expect(compare(true, 'is_true', '')).toBe(true);
  });
  it('is_true: "false" is_true → false', () => {
    expect(compare('false', 'is_true', '')).toBe(false);
  });

  // 20. is_false
  it('is_false: "false" is_false → true', () => {
    expect(compare('false', 'is_false', '')).toBe(true);
  });
  it('is_false: "0" is_false → true', () => {
    expect(compare('0', 'is_false', '')).toBe(true);
  });
  it('is_false: false (boolean) is_false → true', () => {
    expect(compare(false, 'is_false', '')).toBe(true);
  });
  it('is_false: null is_false → true', () => {
    expect(compare(null, 'is_false', '')).toBe(true);
  });
  it('is_false: "true" is_false → false', () => {
    expect(compare('true', 'is_false', '')).toBe(false);
  });

  // 21. regex_match
  it('regex_match: "abc123" matches "\\d+" → true', () => {
    expect(compare('abc123', 'regex_match', '\\d+')).toBe(true);
  });
  it('regex_match: "abc" matches "^[a-z]+$" → true', () => {
    expect(compare('abc', 'regex_match', '^[a-z]+$')).toBe(true);
  });
  it('regex_match: "123" matches "^[a-z]+$" → false', () => {
    expect(compare('123', 'regex_match', '^[a-z]+$')).toBe(false);
  });
  it('regex_match: invalid regex returns false', () => {
    expect(compare('abc', 'regex_match', '[invalid')).toBe(false);
  });

  // Edge: unknown operator
  it('unknown operator returns false', () => {
    expect(compare('abc', 'unknown_op', 'xyz')).toBe(false);
  });
});

describe('workflow-condition-evaluator — compareAnyResponsible()', () => {
  const PRE = 'pre-sale-uuid';
  const SALE = 'sale-uuid';

  // equals → OR (either column matches)
  it('equals: matches pré-vendas column → true', () => {
    expect(compareAnyResponsible(PRE, SALE, 'equals', PRE)).toBe(true);
  });
  it('equals: matches vendas column → true', () => {
    expect(compareAnyResponsible(PRE, SALE, 'equals', SALE)).toBe(true);
  });
  it('equals: matches neither column → false', () => {
    expect(compareAnyResponsible(PRE, SALE, 'equals', 'other-uuid')).toBe(false);
  });
  it('equals: case-insensitive (inherited from compare)', () => {
    expect(compareAnyResponsible(PRE, SALE, 'equals', PRE.toUpperCase())).toBe(true);
  });

  // not_equals → AND (neither column matches)
  it('not_equals: value absent from both → true', () => {
    expect(compareAnyResponsible(PRE, SALE, 'not_equals', 'other-uuid')).toBe(true);
  });
  it('not_equals: value present in pré-vendas → false', () => {
    expect(compareAnyResponsible(PRE, SALE, 'not_equals', PRE)).toBe(false);
  });
  it('not_equals: value present in vendas → false', () => {
    expect(compareAnyResponsible(PRE, SALE, 'not_equals', SALE)).toBe(false);
  });

  // is_empty → AND (both columns empty)
  it('is_empty: both empty → true', () => {
    expect(compareAnyResponsible(null, null, 'is_empty', '')).toBe(true);
  });
  it('is_empty: only one set → false', () => {
    expect(compareAnyResponsible(PRE, null, 'is_empty', '')).toBe(false);
  });

  // is_not_empty → OR (at least one set)
  it('is_not_empty: one set → true', () => {
    expect(compareAnyResponsible(null, SALE, 'is_not_empty', '')).toBe(true);
  });
  it('is_not_empty: both empty → false', () => {
    expect(compareAnyResponsible(null, null, 'is_not_empty', '')).toBe(false);
  });
});
