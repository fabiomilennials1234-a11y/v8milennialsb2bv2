# DNA de Almas — Integração por cenário · Implementation Plan

> **For agentic workers:** implementar task-a-task. Steps com checkbox (`- [ ]`).
> Execução toca **prod** (workflows + stages na org DNA) → cada apply exige **autorização CTO explícita**.
> Ferramenta: `scripts/recovery/dna_almas/q.py` (Management API, token `sbp_*`). NÃO commitar q.py.

**Goal:** Rotear leads DNA para a coluna certa do funil por cenário de checkout, via workflows nativos
disparados por tag, e cascatear os drips de WhatsApp.

**Architecture:** Zuvic posta lead+tag no `lead-webhook` → `trg_workflow_tag_added` → workflow nativo
(`tag_added`→`move_stage`+drip). Mapa tag→stage→drip no Torque. Sem edge nova, sem n8n.

**Tech Stack:** Postgres (Supabase prod `jsjsmuncfkbsbzqzqhfq`), workflows nativos (`workflows` table,
`definition` jsonb), `move_stage`/`send_whatsapp` actions, `trg_workflow_tag_added`.

**Constantes:**
- `ORG = d67ae17a-815d-476d-b3a9-287c7b267997`
- pipe whatsapp slug `whatsapp` (pipeline_id `e7125643-223c-41ca-ac25-23144b8257e2`)
- stage shape do nó: `{id, type, data:{...}, position:{x,y}, measured:{width:280,height:62}}`
- edge shape: `{id, type:"animated", source, target, animated:true}`

---

## ONDA 1 — Pago nativo (sem dependência Zuvic; DEP-1 só pro envio)

### Task 1: Workflow `DNA · Pago (tag→stage)`

Cobre REQ-1.1, REQ-1.2. Padrão A (só move; drip F existente cascateia via stage_changed→pago).

**Files:**
- Create: `scripts/recovery/dna_almas/apply_11_pago_tag_workflow.sql`

- [ ] **Step 1: Escrever o SQL do insert do workflow**

```sql
-- apply_11_pago_tag_workflow.sql
INSERT INTO public.workflows
  (organization_id, name, is_active, trigger_type, trigger_config, definition)
VALUES (
  'd67ae17a-815d-476d-b3a9-287c7b267997',
  'DNA · Pago (tag→stage)',
  true,
  'tag_added',
  '{"tag_name":"Cliente"}'::jsonb,
  '{
     "edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
     "nodes":[
       {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
        "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{}}},
       {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
        "data":{"type":"action","label":"Mover p/ Pago","actionType":"move_stage","targetStage":"pago","pipeType":"whatsapp"}}
     ]
   }'::jsonb
)
RETURNING id, name, is_active;
```

- [ ] **Step 2: Aplicar em prod (AUTORIZAÇÃO CTO)**

Run: `python q.py prod scripts/recovery/dna_almas/apply_11_pago_tag_workflow.sql`
Expected: 1 row com `name='DNA · Pago (tag→stage)'`, `is_active=true`. Guardar o `id` retornado.

- [ ] **Step 3: Verificar registro**

Run:
```sql
SELECT name, trigger_type, trigger_config::text,
       (definition->'nodes'->1->'data'->>'actionType') AS acao,
       (definition->'nodes'->1->'data'->>'targetStage') AS stage
FROM workflows
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Pago (tag→stage)';
```
Expected: `trigger_type=tag_added`, `trigger_config={"tag_name":"Cliente"}`, `acao=move_stage`, `stage=pago`.

### Task 2: Verificar roteamento ponta-a-ponta (sem envio)

Cobre verificação REQ-1.1/1.2. Lead descartável, cleanup total.

**Files:**
- Create: `scripts/recovery/dna_almas/verify_11_pago.sql` (queries de assert)

- [ ] **Step 1: Criar lead de teste em `novo_lead`**

```sql
WITH l AS (
  INSERT INTO leads (organization_id, name, email, phone, origin, pipe_whatsapp)
  VALUES ('d67ae17a-815d-476d-b3a9-287c7b267997','ZZ Teste Pago','zztestepago@example.com','5511999990001','outro','novo_lead')
  RETURNING id
)
INSERT INTO pipeline_entries (pipeline_id, lead_id, stage_key)
SELECT 'e7125643-223c-41ca-ac25-23144b8257e2', id, 'novo_lead' FROM l
RETURNING lead_id;
```
Guardar `lead_id`.

- [ ] **Step 2: Inserir a tag `Cliente` (simula POST Zuvic do pago)**

```sql
-- garante a tag na org + vincula ao lead (dispara trg_workflow_tag_added)
WITH t AS (
  INSERT INTO tags (organization_id, name, color)
  VALUES ('d67ae17a-815d-476d-b3a9-287c7b267997','Cliente','#22c55e')
  ON CONFLICT (organization_id, name) DO UPDATE SET name=EXCLUDED.name
  RETURNING id
)
INSERT INTO lead_tags (lead_id, tag_id)
SELECT '<LEAD_ID>', id FROM t
ON CONFLICT (lead_id, tag_id) DO NOTHING
RETURNING lead_id, tag_id;
```
Nota: se a tag já existir com outra cor, o ON CONFLICT mantém. O INSERT em lead_tags é o que dispara.

- [ ] **Step 3: Assert — lead moveu pra `pago`**

Run (aguardar ~10–30s p/ engine):
```sql
SELECT pe.stage_key, l.pipe_whatsapp
FROM pipeline_entries pe JOIN leads l ON l.id=pe.lead_id
WHERE pe.lead_id='<LEAD_ID>' AND pe.pipeline_id='e7125643-223c-41ca-ac25-23144b8257e2';
```
Expected: `stage_key=pago`, `pipe_whatsapp=pago`.

- [ ] **Step 4: Assert — execução do drip F criada**

```sql
SELECT w.name, we.status, we.current_node_id
FROM workflow_executions we JOIN workflows w ON w.id=we.workflow_id
WHERE we.lead_id='<LEAD_ID>' ORDER BY we.created_at DESC;
```
Expected: linha de `DNA · Pago (tag→stage)` (completed) + linha de `DNA · F — Pós-compra` (running/paused
no delay). Envio do WhatsApp só ocorre com DEP-1 (instância).

- [ ] **Step 5: Cleanup**

```sql
DELETE FROM workflow_executions WHERE lead_id='<LEAD_ID>';
DELETE FROM lead_tags WHERE lead_id='<LEAD_ID>';
DELETE FROM pipeline_entries WHERE lead_id='<LEAD_ID>';
DELETE FROM lead_history WHERE lead_id='<LEAD_ID>';
DELETE FROM leads WHERE id='<LEAD_ID>';
```
Expected: lead some; org volta a 167 leads.

---

## ONDA 2 — Recusado + ciclo de assinatura (requer DEP-2 tags + DEP-3 phone da Zuvic)

> Os workflows abaixo podem ser CRIADOS já (dormentes) — só disparam quando a Zuvic enviar a tag.

### Task 3: Migration — stages `cancelado` + `inadimplente`

Cobre REQ-2.2.

**Files:**
- Create: `scripts/recovery/dna_almas/apply_12_stages_cancel_inad.sql`

- [ ] **Step 1: SQL dos stages**

```sql
INSERT INTO pipeline_stages (organization_id, pipeline_type, stage_key, name, position, is_active)
VALUES
 ('d67ae17a-815d-476d-b3a9-287c7b267997','whatsapp','cancelado','🔴 Cancelado',21,true),
 ('d67ae17a-815d-476d-b3a9-287c7b267997','whatsapp','inadimplente','⚠️ Inadimplente',22,true)
ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING
RETURNING stage_key, position, is_active;
```

- [ ] **Step 2: Aplicar (AUTORIZAÇÃO CTO)** — `python q.py prod .../apply_12_stages_cancel_inad.sql`
Expected: 2 rows. Conferir no Kanban que as colunas aparecem.

### Task 4: Workflows Padrão A (só move; drip por-stage cascateia)

Cobre REQ-2.1, 2.7, 2.8. Mesmo template da Task 1, variando `name`/`tag_name`/`targetStage`.

**Files:** Create `scripts/recovery/dna_almas/apply_13_onda2_move_workflows.sql`

- [ ] **Step 1: Inserir os 3 workflows** (1 INSERT por linha da tabela; copiar o bloco VALUES da Task 1
  trocando os 3 campos):

| name | trigger_config.tag_name | targetStage | drip que cascateia |
|---|---|---|---|
| `DNA · Recusado (tag→stage)` | `checkout_recusado` | `cartao_recusado` | `DNA · E` (existe) |
| `DNA · Upgrade (tag→stage)` | `checkout_upgrade` | `pago` | `DNA · F` (existe) |
| `DNA · Free (tag→stage)` | `checkout_free` | `novo_lead` | — (sem drip) |

Para cada: `is_active=true`, `trigger_type='tag_added'`, `definition` = o JSON da Task 1 Step 1 com
`action-2.data.targetStage` trocado. Ex. Recusado:
```sql
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
VALUES ('d67ae17a-815d-476d-b3a9-287c7b267997','DNA · Recusado (tag→stage)',true,'tag_added',
 '{"tag_name":"checkout_recusado"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover","actionType":"move_stage","targetStage":"cartao_recusado","pipeType":"whatsapp"}}
   ]}'::jsonb);
```

- [ ] **Step 2: Aplicar (AUTORIZAÇÃO CTO)** + verificar 3 rows com trigger_config/targetStage corretos
  (mesma query da Task 1 Step 3 por nome).

### Task 5: Workflows Padrão B (move + drip embutido) — Inadimplente, Cancelado, Downgrade, Renovação

Cobre REQ-2.3, 2.4, 2.5, 2.6. Drips novos (cobrança/winback) — copy abaixo.

**Files:** Create `scripts/recovery/dna_almas/apply_14_onda2_drip_workflows.sql`

- [ ] **Step 1: Definir copy dos drips novos** (WhatsApp, `{{custom.primeiro_nome}}`, `{{custom.link_checkout}}`):
  - **Inadimplente (cobrança)** — 1 msg: `{{custom.primeiro_nome}}, identificamos que a renovação do seu acesso ao DNA de Almas não foi confirmada. Pra não perder o acesso, é só regularizar por aqui: 👉 {{custom.link_checkout}}`
  - **Cancelado (winback)** — 1 msg: `{{custom.primeiro_nome}}, seu acesso ao DNA de Almas foi encerrado. Se quiser voltar quando fizer sentido, deixo o link aqui: 👉 {{custom.link_checkout}}. Te desejo um caminho leve. 🌙`

- [ ] **Step 2: Montar os 4 workflows** (template Padrão B = trigger tag_added → move_stage → delay → send_whatsapp):

| name | tag_name | targetStage | drip |
|---|---|---|---|
| `DNA · Inadimplente` | `inadimplente` | `inadimplente` | cobrança (Step 1) |
| `DNA · Cancelado` | `cancelado` | `cancelado` | winback (Step 1) |
| `DNA · Downgrade` | `downgrade` | `cancelado` | — (só move) |
| `DNA · Renovação` | `renovacao` | (sem move) | — (no-op; opcional thank-you) |

Nó send_whatsapp = shape `{"id":"action-3","type":"action","data":{"type":"action","actionType":"send_whatsapp","messageTemplate":"<copy>","label":"Enviar WhatsApp"},...}` + delay 5min antes (ver template `DNA · E` em `design.md` §4 / prod workflow `01beb79b-…`).

- [ ] **Step 3: Aplicar (AUTORIZAÇÃO CTO)** + verificar 4 rows.

### Task 6: Guard "pago mata recuperação" (REQ-1.3)

Adiciona, antes de cada `send_whatsapp` dos drips de recuperação (E, e B/C/D quando ativos), um nó
`condition` que checa se o lead ainda está no stage de recuperação; se saiu (ex. virou `pago`), encerra o ramo.

**Files:** Modify (via UPDATE workflows.definition) — `DNA · E` (`01beb79b-…`) + B/C/D.

- [ ] **Step 1: Verificar capacidade do nó `condition` pra checar stage atual**

Run: ler `supabase/functions/_shared/workflow-executor.ts` (handling de `node.type==='condition'`) e
`workflow-action-handler.ts` — confirmar config de condição por `stage_key` atual do lead. Documentar o
shape exato do nó condition (campo/operador) antes de editar.

- [ ] **Step 2: Inserir nó condition antes do 1º send em `DNA · E`** (UPDATE definition; AUTORIZAÇÃO CTO),
  ramo "saiu do stage" → fim. Repetir p/ B/C/D.

- [ ] **Step 3: Verificar** — lead em drip E que recebe tag `Cliente` (→pago) não recebe os sends seguintes de E.

---

## ONDA 3 — Recuperação B/C/D (requer DEP-4: eventos novos Zuvic)

### Task 7: Workflows tag→stage para B/C/D (dormentes até DEP-4)

Cobre REQ-3.1/3.2/3.3. Padrão A; drips B/C/D já existem por stage_changed.

**Files:** Create `scripts/recovery/dna_almas/apply_15_onda3_move_workflows.sql`

- [ ] **Step 1: 3 workflows** (template Task 1, `is_active=false` até DEP-4):

| name | tag_name | targetStage | drip |
|---|---|---|---|
| `DNA · Abandonado (tag→stage)` | `checkout_abandonado` | `checkout_abandonado` | `DNA · B` |
| `DNA · PIX (tag→stage)` | `pix_gerado` | `pix_gerado` | `DNA · C` |
| `DNA · Boleto (tag→stage)` | `boleto_gerado` | `boleto_gerado` | `DNA · D` |

- [ ] **Step 2: Aplicar (AUTORIZAÇÃO CTO)** com `is_active=false`. Flipar pra true quando Zuvic emitir os eventos.

---

## FINAL

### Task 8: Atualizar pedido Zuvic pro modelo tag-driven

**Files:** Modify `C:\Users\torch\Desktop\Clientes\DNA de almas\PEDIDO-ZUVIC-webhooks.md`

- [ ] **Step 1:** Trocar a seção 1 (place_in_pipe) por: "enviar 1 **tag determinística por evento** no array
  `tags` do POST" + a tabela evento→tag (design.md §3). Manter seções phone (2), eventos novos (3),
  evento-de-compra (4), provisionamento (5). Já mandam `Cliente` no pago.

### Task 9: Commit do spec/design/tasks (branch própria)

- [ ] **Step 1:** `git checkout -b chore/dna-almas-integration-spec`
- [ ] **Step 2:** `git add .specs/features/dna-almas-integration/` (NÃO add scripts/recovery — q.py tem token)
- [ ] **Step 3:** commit (mensagem convencional). Push só sob pedido CTO (feedback push-new-branch).

---

## Self-review (cobertura spec → task)

- REQ-1.1/1.2 → Task 1 + verify Task 2. REQ-1.3 → Task 6 (reposicionado p/ Onda 2, quando E ativa).
- REQ-2.1/2.7/2.8 → Task 4. REQ-2.2 → Task 3. REQ-2.3/2.4/2.5/2.6 → Task 5.
- REQ-3.1/3.2/3.3 → Task 7. REQ-X.1 → Task 5 copy + F branch (design §7). REQ-X.2 → copy usa {{custom.valor}}/98,00.
- DEP-1 (instância) gate de envio em todas as tasks de verificação — explícito.
- Pendência conhecida: Task 6 Step 1 exige confirmar shape do nó `condition` (stage atual) antes de editar —
  única peça não-determinística; resolver na execução antes de aplicar.
