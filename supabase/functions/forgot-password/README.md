# Recovery email delivery

The published login calls `forgot-password`. It uses `password_reset_tokens` and
links to `https://torquecrm.com.br/reset-password/:token`. This is separate from
Supabase Auth's native recovery session flow. Do not test this page by sending
`auth.resetPasswordForEmail`: that produces a different token format.

Delivery uses Hostinger SMTP over TLS on port 465. Configure Edge secrets
`RESET_SMTP_USER` and `RESET_SMTP_PASSWORD` with the mailbox credentials. Auth SMTP
settings do not automatically configure Edge Functions. Never commit credentials.

The template uses the approved Torque assets and includes a plain text version.
`forgot_password_email` runtime logs record SMTP acceptance or a sanitized failure
code, never the password, reset token or message body. SMTP acceptance is not proof
of inbox placement.

Validation: unit tests in `password-reset-email.test.ts` and `password-reset.test.ts`;
Deno check on `index.ts`; HTTP checks against forgot-password and reset-password.
Existing DB integration tests cover single use, expiry and deny-all token RLS.
