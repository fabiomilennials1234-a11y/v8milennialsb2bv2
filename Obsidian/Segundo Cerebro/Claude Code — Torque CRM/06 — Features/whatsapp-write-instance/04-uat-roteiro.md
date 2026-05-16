---
type: feature
title: UAT — Roteiro de Testes Presenciais
status: active
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---

# UAT — Roteiro de Testes Presenciais

**Feature:** Vínculo user ↔ instância de escrita WhatsApp
**Versão:** 1.0
**Data:** 2026-05-11
**Tempo estimado:** 60-90 min
**Quem executa:** CTO + 1 dev humano + 1 admin Milennials
**Onde:** browser real apontando PROD (`jsjsmuncfkbsbzqzqhfq`)
**Pré-condição:** PRs #112+#113+#114 mergeadas + edge functions deployadas + frontend deployado

---

## 0. Setup pré-execução

### 0.1 Recursos necessários

| Recurso | Quem fornece | Detalhe |
|---------|--------------|---------|
| Credenciais admin Milennials | CTO | login + senha de `ADMIN MILENNIALS` (user_id `f9096632-...`) |
| Credenciais vendedor 1 (owner inst `nicoladeli`) | CTO | Nicolodi (`team_member 43380940-...`) |
| Credenciais vendedor 2 (owner inst `sdr`) | CTO | Furstenberg (`team_member bf98c3f9-...`) |
| Credenciais vendedor 3 (sem instância) | CTO | Weder (`team_member 6ae25df4-...`) |
| Telefone destino real | Dev | número WhatsApp recebendo (não-Milennials, idealmente celular do dev) |
| Console Supabase PROD | CTO | `https://supabase.com/dashboard/project/jsjsmuncfkbsbzqzqhfq` |
| Acesso Sentry | CTO | dashboard de erros |
| Browser navegação anônima 4× | Dev | 1 aba por persona (ADMIN, Nicolodi, Furstenberg, Weder) |

### 0.2 Confirmação ambiente

```bash
# Dev rodando ou prod?
echo "Apontar pra https://app.torquecrm.com.br (PROD)"

# Validar flag Milennials enabled
curl -s "https://api.supabase.com/v1/projects/jsjsmuncfkbsbzqzqhfq/database/query" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT enabled FROM organization_features WHERE organization_id=''6030520a-2ca7-477d-be89-55758e2cd808'' AND feature_key=''user_write_instance_strict''"}'
# Esperado: enabled=true
```

### 0.3 Telefone de teste — IMPORTANTE

Use **um único** telefone de teste pra todos os F1-F6 (mesmo destino). Razão:
- Reduz noise no histórico
- Permite inspecionar ordem cronológica das mensagens recebidas
- Facilita identificar de qual instância partiu (cabeçalho do WhatsApp mostra remetente)

Crie um lead em Milennials apontando pra esse telefone **antes** de começar UAT (evita criar lead na hora e atrapalhar timing).

### 0.4 Bookmarks úteis

- Modal admin "Vincular número": precisa estar logado como admin → `/chat` → botão no header
- Console SQL Supabase: aba SQL Editor
- Logs edge functions: `https://supabase.com/dashboard/project/jsjsmuncfkbsbzqzqhfq/functions/<slug>/logs`

---

## 1. Cenários F1-F8

Marcar resultado: ✅ pass / ❌ fail / ⚠️ pass com observação. Anotar qualquer divergência mesmo se aprovado.

### F1 — Composer humano (fluxo principal)

**Persona:** Furstenberg (member, owner da instância `sdr`).

**Setup:**
1. Lead Milennials existente OU novo, com:
   - `responsible_user_id = bf98c3f9-...` (Furstenberg)
   - `phone = <telefone teste>`
2. Login como Furstenberg em aba anônima.

**Passos:**
1. `/chat` → buscar lead por nome ou telefone.
2. Abrir conversa.
3. Verificar composer **HABILITADO** (Estado 1). Sem banner amarelo, sem card de erro.
4. Digitar "UAT F1 — composer humano" + Enter.

**Critério de aceite:**
- [ ] Mensagem aparece otimisticamente (cinza/pendente).
- [ ] Status muda pra ✓✓ em < 5s.
- [ ] Telefone destino recebe a mensagem.
- [ ] Cabeçalho WhatsApp mostra número da instância `sdr`.
- [ ] Nada em Sentry.
- [ ] Logs `whatsapp-api-proxy`: linha `action=sendText` + `outcome=allowed` + `lead_id` no payload.

**Falha esperada (não acontecer):**
- HTTP 409 ou 403 no console do browser → bug no resolve do guard.
- Mensagem com remetente da instância errada → bug no `set_instance_owner` ou backend ignorando vínculo.

---

### F2 — Outbound copilot imediato

**Persona:** Sistema (cron). Validador: dev.

**Setup:**
1. Em Milennials, copilot do tipo `qualificador` ou `sdr` ATIVO + vinculado à instância `sdr` (owner Furstenberg).
2. Verificar `copilot_agents.is_active = true` + `business_context` preenchido.

**Passos:**
1. Criar lead novo via webhook ou UI: phone = `<telefone teste>`, sem responsible (deixa NULL).
2. Atribuir responsible Furstenberg manualmente (ou esperar regra de pipeline atribuir).
3. Aguardar copilot disparar (≤ 1 min — depende de cron `outbound-trigger`).

**Critério de aceite:**
- [ ] Telefone destino recebe mensagem do copilot.
- [ ] Cabeçalho WhatsApp = instância `sdr` (não `nicoladeli`).
- [ ] Logs `outbound-trigger` ou `outbound-sender`: ausência de `StrictWriteResolutionError`.
- [ ] Tabela `conversation_messages`: row inserida com `instance_id` = sdr.

**Falha esperada (não acontecer):**
- Mensagem sai pela instância errada → backend não passou `lead_id` ou flag não está ativa pra org.
- Mensagem nunca sai + log `StrictWriteResolutionError code=NO_INSTANCE` → owner não atribuído ao Furstenberg (pré-check falhou).

---

### F3 — Followup cron

**Persona:** Sistema (cron `followup-sender`).

**Setup:**
1. Lead Milennials com responsible Furstenberg + last_contact > 24h atrás (ajustar em SQL se necessário pra forçar followup).
2. Followup template configurado.

**Passos:**
1. Aguardar cron rodar (≤ 1 min ou disparar manualmente via SQL `pg_cron.run_job`).

**Critério de aceite:**
- [ ] Follow-up sai pela instância `sdr`.
- [ ] `follow_ups.status = sent` + `instance_id` = sdr.
- [ ] Sem erros em logs.

---

### F4 — Workflow node `send_message`

**Persona:** Sistema (workflow trigger).

**Setup:**
1. Workflow Milennials ATIVO com node `send_message` (template).
2. Trigger: `lead_created` ou `stage_changed`.

**Passos:**
1. Disparar trigger (criar lead ou mover stage do lead Furstenberg).

**Critério de aceite:**
- [ ] `workflow_executions.status = completed`.
- [ ] Mensagem sai pela instância do responsible.
- [ ] Logs `workflow-action-handler`: sem `StrictWriteResolutionError`.

---

### F5 — `pipe-rule-dispatch` (template + timeout)

**Persona:** Sistema.

**Setup:**
1. Pipeline com regra que dispara `send_template` ao mover lead pra stage X.
2. Lead Furstenberg em stage anterior.

**Passos:**
1. Mover lead pra stage X via UI (drag-and-drop ou botão).

**Critério de aceite:**
- [ ] Template sai imediatamente.
- [ ] Instância correta (sdr).
- [ ] Logs limpos.

---

### F6 — `campaign-rule-dispatch`

**Persona:** Sistema.

**Setup:**
1. Campanha ativa em Milennials com agente IA + responsável (round-robin).
2. Lead novo entra na campanha.

**Passos:**
1. Adicionar lead à campanha.
2. Aguardar dispatch (≤ 1 min).

**Critério de aceite:**
- [ ] Mensagem sai pela instância do responsible designado.
- [ ] `campanha_stages` atualizado.

---

### F7 — Broadcast (`mass-send-create`) — exceção arquitetural

**Persona:** Admin.

**Setup:**
1. Admin Milennials cria campanha de massa (mass send).
2. Lista de N telefones, instância `sdr` selecionada manualmente.

**Passos:**
1. Disparar broadcast.

**Critério de aceite:**
- [ ] Mensagem sai pela instância `sdr` (escolhida manualmente, IGNORA vínculo).
- [ ] Logs `mass-send-create`: SEM linha do `instance-write-guard` (broadcast bypassa guard por desenho).
- [ ] Documentação confirma exceção em [feature-overview.md §4.4](feature-overview.md).

**Atenção:** este é um teste de **não-regressão**. Broadcast nunca deve ser bloqueado pelo guard.

---

### F8 — UI lead drawer (Estados 2 + 3)

**Persona:** Furstenberg primeiro, depois Weder.

#### F8.1 — Estado 2 (BLOQUEADO_INSTANCIA_ALHEIA)

**Setup:** lead Milennials com responsible **Nicolodi** (não Furstenberg).

**Passos:**
1. Login como Furstenberg.
2. Abrir o lead da Nicolodi.

**Critério de aceite:**
- [ ] Composer **desabilitado** (cinza, opacity reduzida).
- [ ] Banner com ícone Lock + texto: _"Esta conversa pertence ao número de Nicolodi. Você pode ler e adicionar notas internas."_
- [ ] Aba Notas continua funcionando normalmente.
- [ ] Tentar digitar/colar texto: nada acontece (cursor não foca).
- [ ] Inspecionar DOM: `data-write-blocked="true"` + `aria-hidden="true"` no wrapper.

#### F8.2 — Estado 3 (ERRO_SEM_INSTANCIA)

**Setup:** lead Milennials com responsible **Weder** (member SEM instância vinculada).

**Passos:**
1. Login como Weder.
2. Abrir o lead.

**Critério de aceite (Weder member):**
- [ ] Composer SUBSTITUÍDO por card "Lead sem responsável" OU "Weder ainda não tem um número de WhatsApp".
- [ ] Subtítulo: _"Peça ao administrador para vincular um número..."_.
- [ ] Sem CTA primário (Weder não é admin).

**Repetir como ADMIN MILENNIALS abrindo MESMO lead:**
- [ ] Card mostra mesmo texto.
- [ ] Subtítulo: _"Vincule um número para que Weder possa responder pelos leads dele."_.
- [ ] CTA primário "Vincular número" visível.
- [ ] Clique em "Vincular número" → modal `InstanceOwnerModal` abre.

#### F8.3 — Modal admin "Vincular número"

**Setup:** continuação do F8.2 com admin logado.

**Passos:**
1. Modal aberto.
2. Verificar lista ordenada: `Disponível` (verde) → `Em uso` (amarelo) → `Atual` (azul).
3. Selecionar instância **disconnected** (`numero1` ou `testetesteteste`).
4. Verificar banner amarelo aparece com `AlertTriangle` + texto _"Este número está desconectado. O vendedor verá o composer bloqueado até reconectar."_
5. Selecionar `nicoladeli` (em uso por Nicolodi).
6. Clicar "Vincular".
7. Verificar confirmação inline destructive: _"Substituir vínculo deste número? O vendedor anterior perderá acesso de envio por este número."_.
8. **NÃO confirmar** — clicar "Voltar".
9. Selecionar instância sem owner (se houver) e atribuir a Weder.

**Critério de aceite:**
- [ ] Ordering correto.
- [ ] Warn de inativa aparece e some ao trocar seleção.
- [ ] Confirmação destructive aparece pra owner-switch.
- [ ] Toast `success` após RPC.
- [ ] `whatsapp_instance_owner_history` inserida com `changed_by` = ADMIN MILENNIALS user_id.
- [ ] Reabrir lead do Weder após atribuição → composer Estado 1 (HABILITADO).

---

## 2. Smokes pós-cenários (3 min)

Após F1-F8 todos passarem, rodar smokes finais:

### 2.1 RPCs ainda respondendo

```sql
SELECT * FROM get_lead_write_instance('<lead_id_furstenberg>'::uuid);
-- Esperado: instance_id=sdr, error_code=NULL
```

### 2.2 Logs últimos 30min

```bash
# whatsapp-api-proxy: contar 409 e 403
# Esperado: contagem baixa, somente em testes intencionais
```

### 2.3 Volume `channel_messages` Milennials últimas 24h

```sql
SELECT date_trunc('hour', created_at) AS hour, count(*)
FROM channel_messages
WHERE organization_id='6030520a-2ca7-477d-be89-55758e2cd808'
  AND direction='outbound'
  AND created_at > now() - interval '24 hours'
GROUP BY 1 ORDER BY 1;
```
Comparar com baseline pré-cutover (mesmo dia da semana, semana anterior). ±10% aceitável.

### 2.4 Sentry últimas 2h

Filtrar `organization=Milennials`. **Nenhum erro novo** desde merge.

---

## 3. Critérios de sign-off CTO

UAT aprovado quando:

- [ ] F1-F8: todos ✅ ou ⚠️ com motivo aceito pelo CTO.
- [ ] Smokes 2.1-2.4: todos ✅.
- [ ] Sem ticket de suporte vinculado durante UAT.
- [ ] Audit log preenchido pra todas atribuições feitas no F8.3.

Se aprovado: **assinar** abaixo + arquivar este arquivo em `.specs/features/whatsapp-write-instance/uat-results-YYYY-MM-DD.md`.

```
Data:  ____ / ____ / 2026
CTO:   ___________________________
Dev:   ___________________________
Admin Milennials: _______________
Total tempo execução: ____ min
Aprovado? [ ] Sim   [ ] Não — motivos: _____________________________
```

---

## 4. Plano de rollback (se UAT falhar)

### 4.1 Falha em F1-F6 (envio quebrado)

```sql
-- Rollback flag Milennials
UPDATE organization_features SET enabled = false
WHERE organization_id='6030520a-2ca7-477d-be89-55758e2cd808'
  AND feature_key='user_write_instance_strict';
```

Cache backend 30s + frontend 60s → ~90s pra propagar.

### 4.2 Falha em F8 (UI quebrada)

Frontend rollback = revert do PR via GH Actions:
```bash
git revert <merge-commit-sha>
git push origin main
# GH Actions rebuilda + EasyPanel deploya
```

### 4.3 Schema permanece intacto

Migration A NÃO é revertida. Cols + RPCs + tabela auditoria continuam vivos. Flag OFF garante zero efeito comportamental. Próxima tentativa parte do mesmo schema.

---

## 5. Cenários NÃO cobertos por este UAT

Documentar e agendar separado:

- **Carga**: 10+ users mandando simultâneo. Race condition em `set_instance_owner`?
- **Migração de owner mid-conversa**: cliente está enviando, admin troca owner — composer reage?
- **Network flaky**: edge function timeout — frontend mostra erro corretamente?
- **Cache miss simultâneo**: 2 edge functions reciclando ao mesmo tempo, ambas leem flag — pega valor consistente?
- **Provider Uazapi vs Evolution**: instância de cada provider responde igual?
- **Mass send durante cutover**: broadcast disparado quando flag flip → escopa instância correta?

---

## 6. Próximas ações pós-UAT verde

1. ✅ Marcar UAT pass em [qa-report.md](qa-report.md) §VEREDICTO.
2. ✅ Remover workaround SQL: `ALTER TABLE organization_features DROP COLUMN is_enabled;`.
3. ✅ Deletar `evolution-api-proxy` deploy: `supabase functions delete evolution-api-proxy --project-ref jsjsmuncfkbsbzqzqhfq`.
4. ✅ Iniciar observação 7 dias Milennials antes de expandir.
5. ⏭️ Próximo lote: 3 orgs médias (escolha CTO) — repetir pré-checks toolkit §1.

---

## 7. Próximas ações pós-UAT vermelho

1. ❌ Rollback (§4) imediato.
2. ❌ Pause na branch — abrir issue documentando falha exata.
3. ❌ Investigar logs + reproduzir em DEV.
4. ❌ Fix → novo PR → UAT segunda rodada.

---

## 8. Anexos

### 8.1 IDs de referência Milennials (PROD)

```
org_id:                6030520a-2ca7-477d-be89-55758e2cd808
admin_master_user_id:  f9096632-8c6f-464e-a8ae-2eefed2e2a38  (ADMIN MILENNIALS)
admin_user_id (Leo):   23a14cad-7859-4f92-83e5-6139909a2c39

instance sdr (id):     c7b4d774-ddc4-41e8-bdde-1c9404b923c4
   owner team_member:  bf98c3f9-13b6-4950-8bbc-701203ae5078  (Furstenberg)
instance nicoladeli:   c0238aa0-9316-4e83-8957-3563d55c5761
   owner team_member:  43380940-a044-4809-b264-2fa74530480c  (Nicolodi)
instance numero1:      b27b39fd-f636-493f-b714-634e347540c3  (disconnected, sem owner)
instance teste:        39e3dff2-9313-483c-acd4-9ba6f23345f4  (disconnected, sem owner)

Furstenberg user_id:   0f71db39-e7d0-4b0d-9955-bce3c54d792b
Nicolodi user_id:      (consultar team_members.user_id WHERE id='43380940-...')
Weder team_member:     6ae25df4-ba91-481a-ae9a-a0a1b7e6ea7c
```

### 8.2 Dashboard rápido SQL

```sql
-- Estado pós-UAT
SELECT
  (SELECT count(*) FROM whatsapp_instance_owner_history
    WHERE organization_id='6030520a-2ca7-477d-be89-55758e2cd808'
      AND changed_at > now() - interval '2 hours') AS owner_changes_today,
  (SELECT count(*) FROM channel_messages
    WHERE organization_id='6030520a-2ca7-477d-be89-55758e2cd808'
      AND direction='outbound'
      AND created_at > now() - interval '2 hours') AS outbound_2h,
  (SELECT count(*) FROM leads
    WHERE organization_id='6030520a-2ca7-477d-be89-55758e2cd808'
      AND responsible_user_id IS NOT NULL) AS leads_com_resp;
```
