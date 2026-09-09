import { getCorsHeaders } from './cors.ts';
import { withSecurityHeaders } from './security-headers.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, requireAuth } from './user-auth.ts';
import { evaluateGuidedCondition } from './guided-condition.ts';

/** Public personal-test endpoint. Its response contains no commercial action. */
export async function handleGuidedConditionTest(req: Request): Promise<Response> {
  const headers = { ...withSecurityHeaders(getCorsHeaders(req.headers.get('Origin'))), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });
  if (req.method !== 'POST') return reply({ status: 'error', code: 'method_not_allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply({ status: 'error', code: 'access_denied' }, 401);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.organizationId !== 'string' || !body.organizationId
      || typeof body.leadId !== 'string' || !body.leadId
      || (body.entryId !== undefined && body.entryId !== null && (typeof body.entryId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.entryId)))) {
      return reply({ status: 'error', code: 'invalid_configuration' }, 400);
    }
    const identity = await requireAuth(req, { organizationId: body.organizationId, requireOrganization: true });
    const key = Deno.env.get('ANON_KEY_2')?.trim() || Deno.env.get('ANON_KEY')?.trim() || Deno.env.get('SUPABASE_ANON_KEY')!;
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const result = await evaluateGuidedCondition(caller, {
      organizationId: identity.organizationId, leadId: body.leadId, entryId: body.entryId ?? null, condition: body.condition,
    });
    return reply(result, result.status === 'evaluated' ? 200 : result.code === 'access_denied' ? 403 : 422);
  } catch (error) {
    if (error instanceof AuthError) return reply({ status: 'error', code: 'access_denied' }, error.status);
    return reply({ status: 'error', code: 'source_unavailable' }, 500);
  }
}
