// Copy the two smoke fixtures beside the prepared functions/ bundle before use.
// The live source snapshot is intentionally not duplicated in the repository.
const root = process.env.TORQUE_LIVE_PARITY_SMOKE_ROOT;
if (!root) throw new Error('TORQUE_LIVE_PARITY_SMOKE_ROOT must point to a prepared smoke directory');
export default {
  resolve: { alias: {
    'https://esm.sh/@supabase/supabase-js@2': new URL('../../../node_modules/@supabase/supabase-js', import.meta.url).pathname,
    'https://deno.land/std@0.177.0/node/crypto.ts': 'crypto',
  } },
  test: { root, environment: 'node', include: ['group-policy.test.ts', 'update-parity.test.ts'] },
};
