# Runbook — Migração WhatsApp Evolution→Uazapi por organização

Script e playbook para rollout gradual da migração de ~30 orgs prod.

## Pré-requisitos

- Secrets Uazapi configurados em prod (`UAZAPI_BASE_URL`, `UAZAPI_ADMIN_TOKEN`, `UAZAPI_WEBHOOK_SECRET`)
- Edge functions `whatsapp-api-proxy` + `whatsapp-webhook` deployed em prod
- Migration `20260423000200_org_whatsapp_migration_columns.sql` aplicada
- Admin master acesso ao dashboard `/master/whatsapp-migration`

## Playbook

### Fase A — Piloto (1 semana)

1. Escolher 3 orgs amigas (Milennials + 2).
2. Admin → `/master/whatsapp-migration`:
   - Marcar as 3 orgs como `pending` (botão "Agendar").
3. Comunicar cada org:
   - Email/WhatsApp: "Migração WhatsApp agendada. No próximo login, banner aparece com CTA Migrar."
4. Usuário da org clica "Migrar agora" → wizard guiado:
   - Step 1: revisa explicação, clica Continuar
   - Step 2: sistema pausa workflows, deleta instância Evolution, cria Uazapi (~30s)
   - Step 3: QR code aparece → escaneia no celular
   - Sistema detecta pareamento (status=connected) → sucesso
5. Admin monitora dashboard — `whatsapp_migration_status='migrated'` aparece.
6. Validar 48h:
   - Mensagens recebidas funcionam (webhook ativa)
   - Mensagens enviadas pelo Copilot chegam (dispatch)
   - `whatsapp_messages` idempotency preservado (sem duplicatas)
   - Nenhuma error rate spike em Sentry

### Fase B — Rollout (2 semanas)

1. Lotes de 5 orgs/dia.
2. Mesma rotina: marcar pending → comunicar → aguardar usuário.
3. Monitorar dashboard diariamente.
4. Falhas: botão "Migrar" repete wizard. Se persistir, toggle override=`evolution` (volta status quo temporário).

### Fase C — Cleanup

1. 100% migradas → remover env vars Evolution:
   ```bash
   supabase secrets unset EVOLUTION_API_URL EVOLUTION_API_KEY \
     --project-ref jsjsmuncfkbsbzqzqhfq
   ```
2. Após 30 dias sem uso do override=evolution: remover EvolutionProvider code (cleanup final).

## Script em lote (opcional)

Para agendar várias orgs de uma vez:

```sql
-- Marca todas orgs not_started como pending (exceto as já migradas)
UPDATE organizations
SET whatsapp_migration_status = 'pending'
WHERE whatsapp_migration_status = 'not_started';
```

Ou individualmente via dashboard (preferido — auditoria).

## Kill-switch (panic button)

Se Uazapi tiver incidente global:

```sql
-- Rollback todas orgs migradas pra Evolution temporariamente
UPDATE organizations
SET whatsapp_provider_override = 'evolution'
WHERE whatsapp_provider_override IS NULL
  AND whatsapp_migration_status = 'migrated';
```

Lembrar: Evolution env vars ainda devem estar setadas. Revogar override após incidente:

```sql
UPDATE organizations
SET whatsapp_provider_override = NULL
WHERE whatsapp_provider_override = 'evolution';
```

## Rollback de uma org específica

```sql
UPDATE organizations
SET whatsapp_provider_override = 'evolution',
    whatsapp_migration_status = 'failed'
WHERE id = '<org_id>';
```

Org volta a usar Evolution. Usuário vê banner "falhou" e pode tentar de novo.

## Workflows pausados

Durante migração, workflows `running` viram `paused`. Pós-migração, retomar:

```sql
UPDATE workflow_executions
SET status = 'running'
WHERE organization_id = '<org_id>'
  AND status = 'paused'
  AND created_at > NOW() - INTERVAL '1 day';
```

Admin deve revisar antes de retomar em massa — alguns podem ter virado stale.

## Troubleshooting

- **Wizard trava em "provisioning"**: logs edge function `whatsapp-api-proxy` no Supabase dashboard. Provável: token/env issues.
- **QR code não aparece**: `useRefreshQRCode` retornou null. Instância pode estar rejeitando init na Uazapi — verificar cota.
- **Pareamento nunca completa**: WhatsApp celular com 2FA ou device limit. Usuário deve desconectar sessões antigas.
- **Mensagens não chegam pós-migração**: webhook URL mal configurado no Uazapi. Verificar `updateWebhook` no provisioning.

## Contato

Incidentes: canal `#crm-whatsapp-migration` ou `fabio@milennials.com`.
