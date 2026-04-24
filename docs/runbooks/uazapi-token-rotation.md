# Runbook: Rotação de credenciais Uazapi

Procedimentos para girar credenciais Uazapi em caso de comprometimento, rotação periódica ou offboarding.

## Quando girar

- Vazamento suspeito (token em log, repo público, screenshot)
- Rotação trimestral (recomendado)
- Saída de dev com acesso ao painel Uazapi
- Auditoria de segurança

## 1. Girar `UAZAPI_ADMIN_TOKEN` (token mestre da conta)

Impacto: **Alto**. Todas as operações admin (criar instância) quebram até atualizar secret.

Passos:

1. Login no painel Uazapi → gerar novo admin token.
2. Atualizar secret Supabase (dev + prod):
   ```bash
   supabase secrets set UAZAPI_ADMIN_TOKEN="<novo>" --project-ref bcfadphgsibjzivtbjvc
   supabase secrets set UAZAPI_ADMIN_TOKEN="<novo>" --project-ref jsjsmuncfkbsbzqzqhfq
   ```
3. Redeploy de edge functions afetadas:
   ```bash
   supabase functions deploy whatsapp-api-proxy --project-ref bcfadphgsibjzivtbjvc
   supabase functions deploy whatsapp-api-proxy --project-ref jsjsmuncfkbsbzqzqhfq
   ```
4. Invalidar token antigo no painel Uazapi.
5. Verificar logs: sem erros `invalid_admin_token`.
6. Smoke test: criar instância teste em dev → delete.

## 2. Girar `UAZAPI_WEBHOOK_SECRET` (HMAC/shared-secret de webhooks)

Impacto: **Alto**. Webhooks das instâncias param até reconfigurar cada uma.

Passos:

1. Gerar novo secret:
   ```bash
   openssl rand -hex 32
   ```
2. Atualizar secret Supabase (dev + prod):
   ```bash
   supabase secrets set UAZAPI_WEBHOOK_SECRET="<novo>" --project-ref bcfadphgsibjzivtbjvc
   supabase secrets set UAZAPI_WEBHOOK_SECRET="<novo>" --project-ref jsjsmuncfkbsbzqzqhfq
   ```
3. Redeploy `whatsapp-webhook` em ambos projetos:
   ```bash
   supabase functions deploy whatsapp-webhook --project-ref bcfadphgsibjzivtbjvc
   supabase functions deploy whatsapp-webhook --project-ref jsjsmuncfkbsbzqzqhfq
   ```
4. Reconfigurar webhook em cada instância Uazapi usando `updateWebhook` endpoint — pode ser feito via job interno:
   ```sql
   -- Listar instâncias para reconfigurar
   SELECT id FROM whatsapp_instances WHERE provider = 'uazapi';
   ```
   Para cada id: chamar edge function `whatsapp-api-proxy` com action `updateWebhook`, passando novo URL+secret.
5. Smoke test: enviar msg em instância teste → confirmar webhook chega.

## 3. Girar `uazapi_token` per-instance (1 instância comprometida)

Impacto: **Localizado**. Apenas aquela instância.

Passos:

1. Delete instância na Uazapi via `DELETE /instance/delete` com admin token.
2. Delete row em `whatsapp_instance_secrets` da instância:
   ```sql
   DELETE FROM whatsapp_instance_secrets WHERE instance_id = '<id>';
   ```
3. Usuário recria instância na UI → novo QR → novo `uazapi_token` salvo via `set_uazapi_credentials` RPC.

## 4. Offboarding de dev

1. Remover acesso ao painel Uazapi.
2. Girar `UAZAPI_ADMIN_TOKEN` (passo 1).
3. Girar `UAZAPI_WEBHOOK_SECRET` (passo 2).
4. Auditar acessos recentes no painel Uazapi.

## Escalação

- Erro `invalid_token` em massa → rollback secret anterior temporariamente via `supabase secrets set` com valor antigo, re-planejar.
- Webhook silencioso sem erro → chamar suporte Uazapi, verificar se IP do Supabase Edge está em allowlist.

## Checklist pós-rotação

- [ ] Secret atualizado em dev
- [ ] Secret atualizado em prod
- [ ] Edge functions redeployadas
- [ ] Smoke test dev verde
- [ ] Smoke test prod verde
- [ ] Token antigo invalidado no painel
- [ ] Log da rotação em `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/07 — Changelog/`
