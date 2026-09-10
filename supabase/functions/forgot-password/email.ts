/** Keep recovery links on the deployed token route, not the Supabase session route. */
export function buildResetEmail(rawToken: string) {
  if (!/^[a-f0-9]{64}$/.test(rawToken)) throw new Error('Invalid recovery token format');
  const resetLink = `https://torquecrm.com.br/reset-password/${rawToken}`;
  return {
    subject: 'Redefina sua senha — Torque CRM',
    text: `Recebemos uma solicitação para redefinir sua senha no Torque CRM.\n\nEscolha sua nova senha: ${resetLink}\n\nLink válido por 1 hora e uma única utilização. Se não solicitou, ignore este e-mail.`,
    html: `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light"><title>Redefinir sua senha — Torque CRM</title></head>
<body style="margin:0;padding:0;background:#1c1c1c;color:#f8f5e7;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Você solicitou uma nova senha para sua conta Torque CRM. O link é válido por 1 hora.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1c1c1c;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;border:1px solid #636156;border-radius:16px;background:#3a2d25;">
<tr><td style="padding:32px 32px 24px;border-bottom:1px solid #636156;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><img src="https://jsjsmuncfkbsbzqzqhfq.supabase.co/storage/v1/object/public/media/brand/auth/torque-horizontal-95e39f5f501c.png" width="216" height="34" alt="Torque CRM" style="display:block;width:216px;max-width:100%;height:auto;border:0;color:#f8f5e7;font-size:24px;"></td><td align="right" style="font-size:10px;letter-spacing:2px;color:#c4c0b5;">SUA CONTA</td></tr></table>
</td></tr>
<tr><td style="padding:32px 32px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td width="56" height="5" style="background:#ed9326;line-height:5px;font-size:1px;">&nbsp;</td><td width="8"></td><td width="24" style="background:#ffd400;line-height:5px;font-size:1px;">&nbsp;</td><td width="8"></td><td style="border-top:1px solid #636156;"></td></tr></table>
<p style="margin:28px 0 12px;color:#ed9326;font-size:11px;line-height:18px;font-weight:bold;letter-spacing:2px;">RECUPERAÇÃO DE ACESSO</p>
<h1 style="margin:0;color:#f8f5e7;font-size:36px;line-height:41px;letter-spacing:-1.2px;font-weight:800;">Vamos recuperar<br>seu acesso.</h1>
<p style="margin:22px 0 0;color:#c4c0b5;font-size:16px;line-height:26px;">Recebemos uma solicitação para redefinir a senha da sua conta no Torque CRM.</p>
<p style="margin:12px 0 28px;color:#c4c0b5;font-size:16px;line-height:26px;">Use o botão abaixo para escolher uma nova senha. Este link é válido por <strong style="color:#f8f5e7;">1 hora</strong> e pode ser usado uma única vez.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#ed9326" style="border-radius:8px;mso-padding-alt:17px 26px;"><a href="${resetLink}" style="display:inline-block;padding:17px 26px;color:#141410;font-size:16px;line-height:20px;font-weight:bold;text-decoration:none;border-radius:8px;">Redefinir minha senha &nbsp; →</a></td></tr></table>
<p style="margin:28px 0;color:#c4c0b5;font-size:13px;line-height:21px;">Não solicitou esta alteração? Ignore este e-mail. Sua senha atual permanece a mesma. Nunca compartilhe este link ou sua senha.</p>
</td></tr>
<tr><td style="padding:22px 32px;border-top:1px solid #636156;color:#aaa69b;font-size:12px;line-height:20px;">TORQUE CRM &nbsp;·&nbsp; Acesso à sua conta<br>Enviado por acesso@torquecrm.com.br</td></tr>
</table>
</td></tr></table></body></html>
`,
  };
}
