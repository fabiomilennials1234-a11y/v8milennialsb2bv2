/**
 * reset-password — Edge Function (public, self-hosted password reset step 2)
 *
 * Consumes a token minted by forgot-password and swaps the user's password via
 * the Auth admin API. No session/PKCE involved — the session is NOT created
 * automatically, so the frontend sends the user to /auth to log in afterwards.
 *
 * Flow:
 *   1. Rate limit by client IP (10 / 15 min).
 *   2. Validate the new password against the app-wide strong policy.
 *   3. SHA-256 the token, atomically claim it via claim_password_reset_token
 *      (single-use, unexpired). NULL → generic "invalid or expired".
 *   4. On a valid claim → admin.updateUserById(user_id, { password }).
 *
 * The raw token is NEVER logged.
 */

import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { withSecurityHeaders } from '../_shared/security-headers.ts';
import { logRuntime } from '../_shared/logger.ts';
import { hashRawToken, isStrongPassword, PWD_POLICY_MESSAGE } from '../_shared/password-reset.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = '15 minutes';

const GENERIC_INVALID = 'Link inválido ou expirado. Solicite um novo.';

function jsonResponse(
  data: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** First hop of x-forwarded-for = the real client IP at the edge. */
function clientIpFrom(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  return xff.split(',')[0].trim() || 'unknown';
}

serve(
  withErrorBoundary('reset-password', async (req) => {
    const origin = req.headers.get('Origin') ?? undefined;
    const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error: 'Method not allowed' }, 405, corsHeaders);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let body: { token?: unknown; password?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ success: false, message: 'Requisição inválida.' }, 400, corsHeaders);
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    // Rate limit first (per IP).
    const ip = clientIpFrom(req);
    const { data: withinLimit, error: rlError } = await supabase.rpc('check_auth_rate_limit', {
      p_ip: ip,
      p_endpoint: 'reset-password',
      p_max: RATE_LIMIT_MAX,
      p_window: RATE_LIMIT_WINDOW,
    });
    if (rlError) {
      console.error('[reset-password] rate-limit rpc error:', rlError.message);
      return jsonResponse(
        { success: false, message: 'Serviço indisponível. Tente novamente mais tarde.' },
        503,
        corsHeaders,
      );
    }
    if (withinLimit === false) {
      return jsonResponse(
        { success: false, message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
        429,
        corsHeaders,
      );
    }

    if (!token) {
      return jsonResponse({ success: false, message: GENERIC_INVALID }, 400, corsHeaders);
    }

    // Enforce the strong password policy BEFORE consuming the token, so a weak
    // password does not burn a valid one-time token.
    if (!isStrongPassword(password)) {
      return jsonResponse({ success: false, message: PWD_POLICY_MESSAGE }, 400, corsHeaders);
    }

    const tokenHash = await hashRawToken(token);

    // Atomic single-use claim. NULL → invalid / expired / already used.
    const { data: claimedUserId, error: claimError } = await supabase.rpc(
      'claim_password_reset_token',
      { p_token_hash: tokenHash },
    );

    if (claimError) {
      console.error('[reset-password] claim rpc error:', claimError.message);
      await logRuntime({
        module: 'auth',
        action: 'reset_password_selfservice',
        status: 'error',
        errorMessage: claimError.message,
      });
      return jsonResponse({ success: false, message: GENERIC_INVALID }, 400, corsHeaders);
    }

    if (!claimedUserId) {
      // Do not distinguish invalid vs expired vs used — single generic error.
      await logRuntime({
        module: 'auth',
        action: 'reset_password_selfservice',
        status: 'skipped',
      });
      return jsonResponse({ success: false, message: GENERIC_INVALID }, 400, corsHeaders);
    }

    const userId = claimedUserId as string;

    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password,
    });

    if (updateError) {
      console.error('[reset-password] updateUserById error:', updateError.message);
      await logRuntime({
        module: 'auth',
        action: 'reset_password_selfservice',
        status: 'error',
        entityType: 'user',
        entityId: userId,
        errorMessage: updateError.message,
      });
      // The token is already consumed; a generic failure asks the user to retry.
      return jsonResponse(
        { success: false, message: 'Não foi possível redefinir a senha. Solicite um novo link.' },
        400,
        corsHeaders,
      );
    }

    await logRuntime({
      module: 'auth',
      action: 'reset_password_selfservice',
      status: 'success',
      entityType: 'user',
      entityId: userId,
    });

    return jsonResponse({ success: true }, 200, corsHeaders);
  }),
);
