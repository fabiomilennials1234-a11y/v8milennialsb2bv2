/**
 * ESLint rule: no-brittle-supabase-mocks
 *
 * Detects brittle Supabase chain mocks like:
 *   vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn() }) })
 *
 * Suggests using `createMockSupabase` from `tests/helpers/supabase-mock.ts` instead.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow brittle Supabase client chain mocks in tests',
      recommended: false,
    },
    schema: [],
    messages: {
      brittleMock:
        'Brittle Supabase chain mock detected. Use `createMockSupabase` from `tests/helpers/supabase-mock.ts` or `createTestDB` instead. Chain mocks break when query structure changes.',
    },
  },

  create(context) {
    // Supabase query builder method names that indicate a chain mock
    const SUPABASE_CHAIN_METHODS = new Set([
      'select',
      'from',
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'like',
      'ilike',
      'is',
      'in',
      'filter',
      'order',
      'limit',
      'range',
      'single',
      'maybeSingle',
      'insert',
      'update',
      'upsert',
      'delete',
      'rpc',
      'match',
      'not',
      'or',
      'contains',
      'containedBy',
      'textSearch',
    ]);

    /**
     * Check if an ObjectExpression has properties whose keys are Supabase chain methods.
     */
    function hasSupabaseChainProps(node) {
      if (node.type !== 'ObjectExpression') return false;

      return node.properties.some(
        (prop) =>
          prop.type === 'Property' &&
          prop.key &&
          prop.key.type === 'Identifier' &&
          SUPABASE_CHAIN_METHODS.has(prop.key.name)
      );
    }

    /**
     * Check if a CallExpression is .mockReturnValue(...) or .mockResolvedValue(...)
     * with an object argument containing Supabase chain method keys.
     */
    function checkMockCall(node) {
      if (node.type !== 'CallExpression') return;
      if (node.callee.type !== 'MemberExpression') return;

      const methodName =
        node.callee.property &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name;

      if (
        methodName !== 'mockReturnValue' &&
        methodName !== 'mockResolvedValue' &&
        methodName !== 'mockReturnValueOnce' &&
        methodName !== 'mockResolvedValueOnce'
      ) {
        return;
      }

      // Check first argument
      const arg = node.arguments[0];
      if (!arg) return;

      if (hasSupabaseChainProps(arg)) {
        context.report({
          node,
          messageId: 'brittleMock',
        });
      }
    }

    return {
      CallExpression: checkMockCall,
    };
  },
};

export default rule;
