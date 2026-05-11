# E — Rollout Toolkit (per-org)

**Data:** 2026-05-11
**Status:** Artefatos prontos — execução em **PROD requer autorização explícita do CTO**.

---

## Aviso de segurança

Etapa E altera comportamento de envio de WhatsApp em PROD. Memory rule:

> Edge functions/migrations em prod: só com autorização direta do CTO na sessão.

Esta branch NÃO executa nada em PROD. Toolkit é para CTO (ou sessão futura autorizada) rodar.

---

## 0. Pré-requisitos globais (uma vez por ambiente)

Antes do primeiro cutover em PROD, aplicar lá:

```bash
# 1. Migrations
supabase/migrations/20260930000000_user_write_instance.sql
supabase/migrations/20260930000001_revoke_anon_write_instance_rpcs.sql
```

Em PROD via Management API (mesmo padrão usado em DEV):

```powershell
$token = "<SUPABASE_PROD_ACCESS_TOKEN>"
$ref = "jsjsmuncfkbsbzqzqhfq"
foreach ($f in @(
  "supabase/migrations/20260930000000_user_write_instance.sql",
  "supabase/migrations/20260930000001_revoke_anon_write_instance_rpcs.sql"
)) {
  $sql = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
  $body = (@{ query = $sql } | ConvertTo-Json -Compress)
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json; charset=utf-8" }
  Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
    -Method POST -Headers $headers -Body $bodyBytes
  Write-Output "Applied: $f"
}
```

Validar pós-aplicação com queries da seção §1.

---

## 1. Pré-checks por org

Substituir `:org_id` pelo UUID da org-alvo. Pilot Milennials = `6030520a-2ca7-477d-be89-55758e2cd808`.

### 1.1 Toda instância open|connected tem owner

```sql
SELECT id, instance_name, status, owner_team_member_id
FROM whatsapp_instances
WHERE organization_id = ':org_id'
  AND owner_team_member_id IS NULL
  AND status IN ('open', 'connected');
```

**Critério:** 0 rows. Caso contrário, admin abre [InstanceOwnerModal](../../../src/components/chat/admin/InstanceOwnerModal.tsx) e atribui owner antes do cutover.

### 1.2 Cobertura de leads ativos com responsável

```sql
WITH stats AS (
  SELECT
    count(*) FILTER (WHERE responsible_user_id IS NOT NULL) AS with_resp,
    count(*) FILTER (WHERE responsible_user_id IS NULL) AS without_resp,
    count(*) AS total
  FROM leads
  WHERE organization_id = ':org_id'
    AND COALESCE(status, '') NOT IN ('lost', 'won_archived', 'arquivado')
)
SELECT
  with_resp,
  without_resp,
  total,
  ROUND(100.0 * without_resp / NULLIF(total, 0), 2) AS pct_without_resp
FROM stats;
```

**Critério:** `pct_without_resp < 5`. Caso contrário, rodar backfill (§2) ou popular manualmente.

### 1.3 Cobertura de users vs. instâncias

```sql
SELECT
  (SELECT count(*) FROM team_members
    WHERE organization_id = ':org_id' AND is_active = true) AS active_members,
  (SELECT count(*) FROM whatsapp_instances
    WHERE organization_id = ':org_id' AND status IN ('open','connected')) AS active_instances,
  (SELECT count(*) FROM whatsapp_instances
    WHERE organization_id = ':org_id' AND owner_team_member_id IS NOT NULL) AS instances_with_owner;
```

**Critério:** `active_members <= active_instances` ideal. Se `members > instances` → users sem instância recebem `NO_INSTANCE` (composer Estado 3 ERRO_SEM_INSTANCIA). Documentar e seguir se aceitável.

---

## 2. Backfill helper

### 2.1 `responsible_user_id` por org

Migration A já fez `COALESCE(closer_id, sdr_id)` global. Para preencher residual via heurística adicional (último team_member que registrou interação):

```sql
-- Preenche responsible_user_id como (closer ou sdr ou last_assigned_to) para a org
UPDATE leads l
SET responsible_user_id = COALESCE(l.closer_id, l.sdr_id, l.last_assigned_to)
WHERE l.organization_id = ':org_id'
  AND l.responsible_user_id IS NULL
  AND COALESCE(l.closer_id, l.sdr_id, l.last_assigned_to) IS NOT NULL;
```

(`last_assigned_to` existe? Validar antes — pode não ser coluna. Confirmar no schema da org.)

### 2.2 Owner por allowed_members único

Migration A já fez para casos exatos = 1. Se quiser ampliar para "primeiro membro adicionado":

```sql
UPDATE whatsapp_instances wi
SET owner_team_member_id = sub.first_member,
    updated_at = NOW()
FROM (
  SELECT
    waam.whatsapp_instance_id,
    (ARRAY_AGG(waam.team_member_id ORDER BY waam.created_at))[1] AS first_member
  FROM whatsapp_instance_allowed_members waam
  GROUP BY waam.whatsapp_instance_id
) sub
WHERE wi.id = sub.whatsapp_instance_id
  AND wi.organization_id = ':org_id'
  AND wi.owner_team_member_id IS NULL;
```

⚠️ **Risco**: viola índice `uq_whatsapp_instances_owner_per_org` se 2 instâncias da mesma org caírem no mesmo `first_member`. Conferir antes:

```sql
SELECT first_member, count(*) AS instance_count
FROM (
  SELECT
    wi.id,
    (ARRAY_AGG(waam.team_member_id ORDER BY waam.created_at))[1] AS first_member
  FROM whatsapp_instances wi
  JOIN whatsapp_instance_allowed_members waam ON waam.whatsapp_instance_id = wi.id
  WHERE wi.organization_id = ':org_id'
    AND wi.owner_team_member_id IS NULL
  GROUP BY wi.id
) sub
GROUP BY first_member
HAVING count(*) > 1;
```

Se retornar rows → conflito. Atribuição manual via `set_instance_owner` RPC.

---

## 3. Cutover

### 3.1 Ligar flag para uma org

```sql
INSERT INTO organization_features (organization_id, feature_key, is_enabled, updated_at, created_at)
VALUES (':org_id', 'user_write_instance_strict', true, now(), now())
ON CONFLICT (organization_id, feature_key) DO UPDATE
SET is_enabled = true, updated_at = now();
```

⚠️ Confirmar nome da coluna: `is_enabled` (visto em [instance-write-guard.ts:257](../../../supabase/functions/_shared/instance-write-guard.ts#L257)). Não `enabled`.

Cache backend = 30s, frontend = 60s. **Aguardar 90s** para efeito propagar.

### 3.2 Rollback (1 query, instantâneo modulo cache)

```sql
UPDATE organization_features
SET is_enabled = false, updated_at = now()
WHERE organization_id = ':org_id'
  AND feature_key = 'user_write_instance_strict';
```

---

## 4. Observabilidade pós-cutover

### 4.1 Edge function logs (primeiras 24h)

```bash
supabase functions logs whatsapp-api-proxy --project-ref jsjsmuncfkbsbzqzqhfq | grep -E "409|403|InstanceWriteGuard"
supabase functions logs outbound-trigger --project-ref jsjsmuncfkbsbzqzqhfq | grep "StrictWriteResolutionError"
supabase functions logs followup-sender --project-ref jsjsmuncfkbsbzqzqhfq | grep "StrictWriteResolutionError"
```

| Log pattern | Severidade | Ação |
|-------------|-----------|------|
| `409` recorrente em proxy | Média | lead trocou de responsável durante conversa — esperado baixo |
| `403` recorrente em proxy | Alta | bug owner ou user removido — investigar |
| `StrictWriteResolutionError code=NO_RESPONSIBLE` | Alta | backfill insuficiente — pausar e completar |
| `StrictWriteResolutionError code=NO_INSTANCE` | Alta | pré-check 1 falhou — atribuir owner urgente |
| `StrictWriteResolutionError code=INSTANCE_INACTIVE` | Média | instância caiu — reconectar |

### 4.2 SQL — taxa de sucesso por hora

```sql
-- Volume de envios por hora (últimas 24h) para a org
SELECT date_trunc('hour', created_at) AS h,
       count(*) AS msgs_sent
FROM channel_messages
WHERE organization_id = ':org_id'
  AND direction = 'outbound'
  AND created_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 1;
```

**Critério:** ±10% do baseline pré-cutover. Drop > 20% = rollback.

### 4.3 Auditoria de mudança de owner

```sql
SELECT changed_at, instance_id, previous_owner_id, new_owner_id, changed_by, reason
FROM whatsapp_instance_owner_history
WHERE organization_id = ':org_id'
ORDER BY changed_at DESC
LIMIT 50;
```

Detecta ping-pong de owner (sintoma de problema).

---

## 5. Sequência de rollout

```
PROD migration apply (janela ociosa)
        ↓
Pré-checks Milennials (§1)
        ↓
Backfill se necessário (§2)
        ↓
Cutover Milennials (§3.1)  — flag ON
        ↓
Observação 7 dias (§4)
        ↓
Lote 2: 3 orgs médias (escolha CTO)
        ↓
Observação 48h
        ↓
Lotes de 5 orgs / 48h
        ↓
100% orgs ON por 30 dias
        ↓
PR separado: feature_flags.default_enabled = true
        ↓
D2-bis: refactor frontend (allowed_members → owner)
        ↓
Drop tabela allowed_members (janela ociosa, backup)
```

---

## 6. Checklist de execução (CTO/sessão autorizada)

Pré-cutover Milennials:
- [ ] Migrations A+revoke aplicadas em PROD.
- [ ] §1.1 retorna 0 rows.
- [ ] §1.2 `pct_without_resp < 5%`.
- [ ] §1.3 cobertura aceitável.
- [ ] Snapshot/backup PROD ondemand.
- [ ] Janela de manutenção comunicada (se necessário).

Cutover:
- [ ] Rodar §3.1 com `:org_id = '6030520a-2ca7-477d-be89-55758e2cd808'`.
- [ ] Aguardar 90s.
- [ ] Smoke: 1 envio humano via UI lead drawer + 1 envio via copilot.

Observação 24h:
- [ ] Logs §4.1 sem padrão crítico.
- [ ] Volume §4.2 dentro de ±10%.
- [ ] Sentry: nenhum novo erro relacionado.
- [ ] Suporte: nenhum ticket vinculado.

Decisão pós-7d:
- [ ] Green: avançar lote 2.
- [ ] Anomalia: rollback (§3.2) + post-mortem.
