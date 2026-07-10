/**
 * forgot-password — Edge Function (public, self-hosted password reset step 1)
 *
 * Replaces Supabase Auth's resetPasswordForEmail (fragile: undelivered email,
 * broken redirect, PKCE fails cross-device, email scanners burn the one-time
 * link). We own the token, the email (Resend) and the reset page.
 *
 * Flow:
 *   1. Validate email format.
 *   2. Rate limit by client IP (5 / 15 min) — BEFORE the user lookup so the
 *      endpoint is not an existence oracle via differential work.
 *   3. Look up the auth user by email (case-insensitive, active only).
 *   4. If missing/inactive → do nothing, but return the SAME generic success
 *      (anti-enumeration).
 *   5. If present → invalidate prior unused tokens, mint a new token, store ONLY
 *      its SHA-256 hash (expires in 1h), and email the link (fire-and-forget).
 *   6. Always respond 200 with the same generic message.
 *
 * The raw token / reset link are NEVER logged.
 */

import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { withSecurityHeaders } from '../_shared/security-headers.ts';
import { logRuntime } from '../_shared/logger.ts';
import {
  generateRawToken,
  hashRawToken,
  isValidEmail,
  resetTokenExpiryFromNow,
} from '../_shared/password-reset.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = '15 minutes';

// Same generic body whether or not the account exists (anti-enumeration).
const GENERIC_MESSAGE =
  'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.';

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

/**
 * Resolve an active auth user by email (case-insensitive). Uses the admin
 * listUsers pagination (the reliable path in this codebase — auth schema is not
 * exposed via PostgREST). Returns null when not found or banned (inactive).
 */
async function findActiveUserByEmail(
  supabase: ReturnType<typeof createClient>,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const target = email.trim().toLowerCase();
  const perPage = 1000;
  let page = 1;

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];

    for (const u of users) {
      if ((u.email ?? '').toLowerCase() !== target) continue;
      // "inactive" = banned/soft-disabled in auth. banned_until in the future
      // means the user cannot authenticate → treat as not eligible.
      const bannedUntil = (u as { banned_until?: string | null }).banned_until;
      if (bannedUntil && Date.parse(bannedUntil) > Date.now()) return null;
      return { id: u.id, email: u.email ?? target };
    }

    if (users.length < perPage) return null; // last page reached, no match
    page += 1;
  }
}

/**
 * Send the reset email via Resend. Fire-and-forget: failures are logged but
 * never surfaced to the caller (and never block the response). The reset link
 * and raw token are NEVER logged.
 */
async function sendResetEmail(toEmail: string, rawToken: string): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    // No key configured (e.g. dev without secret) — skip silently. The reset
    // row still exists; operator provisioning is documented in the changelog.
    console.warn('[forgot-password] RESEND_API_KEY not set — email skipped');
    return;
  }

  const fromAddr = Deno.env.get('RESET_EMAIL_FROM') ?? 'no-reply@send.torquecrm.com.br';
  const appUrl = Deno.env.get('APP_URL') ?? 'https://app.torquecrm.com.br';
  const resetLink = `${appUrl}/reset-password/${rawToken}`;

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="color: #0f172a;">Redefinição de senha</h2>
      <p>Recebemos um pedido para redefinir a senha da sua conta no <strong>Torque CRM</strong>.</p>
      <p style="margin: 24px 0;">
        <a href="${resetLink}"
           style="display: inline-block; background: #eab308; color: #0f172a; font-weight: 600; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
          Redefinir minha senha
        </a>
      </p>
      <p style="font-size: 13px; color: #475569;">Este link é válido por <strong>1 hora</strong>. Se o botão não funcionar, copie e cole este endereço no navegador:</p>
      <p style="font-size: 13px; color: #475569; word-break: break-all;">${resetLink}</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">Se você não solicitou esta alteração, ignore este e-mail — sua senha continua a mesma.</p>
    </div>`;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Torque CRM <${fromAddr}>`,
      to: toEmail,
      subject: 'Redefinição de senha — Torque CRM',
      html,
    }),
  });

  if (!resp.ok) {
    // Log the failure WITHOUT the token/link so we can diagnose deliverability.
    const detail = await resp.text().catch(() => '');
    console.error(`[forgot-password] Resend failed: ${resp.status} ${detail.slice(0, 200)}`);
  }
}

serve(
  withErrorBoundary('forgot-password', async (req) => {
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

    let body: { email?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { success: false, message: 'Requisição inválida.' },
        400,
        corsHeaders,
      );
    }

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!isValidEmail(email)) {
      return jsonResponse(
        { success: false, message: 'Informe um e-mail válido.' },
        400,
        corsHeaders,
      );
    }

    // Rate limit BEFORE the user lookup (no existence oracle via work/timing).
    const ip = clientIpFrom(req);
    const { data: withinLimit, error: rlError } = await supabase.rpc('check_auth_rate_limit', {
      p_ip: ip,
      p_endpoint: 'forgot-password',
      p_max: RATE_LIMIT_MAX,
      p_window: RATE_LIMIT_WINDOW,
    });
    if (rlError) {
      console.error('[forgot-password] rate-limit rpc error:', rlError.message);
      // Fail closed on infra error — better to reject than to open the endpoint.
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

    try {
      const user = await findActiveUserByEmail(supabase, email);

      if (user) {
        // Invalidate any prior unused tokens for this user (single active token).
        await supabase
          .from('password_reset_tokens')
          .update({ used_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .is('used_at', null);

        const rawToken = generateRawToken();
        const tokenHash = await hashRawToken(rawToken);

        const { error: insertError } = await supabase.from('password_reset_tokens').insert({
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: resetTokenExpiryFromNow(),
        });

        if (insertError) {
          // Log without token; still return generic success (do not leak state).
          console.error('[forgot-password] token insert failed:', insertError.message);
          await logRuntime({
            module: 'auth',
            action: 'forgot_password',
            status: 'error',
            entityType: 'user',
            entityId: user.id,
            errorMessage: insertError.message,
          });
        } else {
          // Fire-and-forget: do not block the response and never fail on email.
          // On Supabase Edge, EdgeRuntime.waitUntil keeps the promise alive after
          // the response returns (a plain floating promise can be killed when the
          // isolate tears down). Falls back to a floating promise in local dev.
          const emailPromise = sendResetEmail(user.email, rawToken).catch((e) => {
            console.error('[forgot-password] email send error:', (e as Error).message);
          });
          const edgeRuntime = (globalThis as {
            EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
          }).EdgeRuntime;
          if (typeof edgeRuntime?.waitUntil === 'function') {
            edgeRuntime.waitUntil(emailPromise);
          } else {
            void emailPromise;
          }
          await logRuntime({
            module: 'auth',
            action: 'forgot_password',
            status: 'success',
            entityType: 'user',
            entityId: user.id,
          });
        }
      } else {
        // Anti-enumeration: no account (or inactive) → identical generic success.
        await logRuntime({
          module: 'auth',
          action: 'forgot_password',
          status: 'skipped',
        });
      }
    } catch (e) {
      // Never leak internal failure detail; still return generic success so the
      // response is indistinguishable from the happy path.
      console.error('[forgot-password] lookup/mint error:', (e as Error).message);
      await logRuntime({
        module: 'auth',
        action: 'forgot_password',
        status: 'error',
        errorMessage: (e as Error).message,
      });
    }

    return jsonResponse({ success: true, message: GENERIC_MESSAGE }, 200, corsHeaders);
  }),
);
