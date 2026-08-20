# Plano de sincronização — ERP Toth → CRM, org Café Jurerê

**SCRUM-229 · 19/08/2026 · org `4922638c-4909-494e-ba10-12282ec0b161`**

Objetivo: popular a carteira do CRM com os clientes e as cobranças do ERP.
Restrições do CTO: **não escrever no ERP**, **não disparar automação, campanha ou
Copilot**, **não mexer na operação atual deles**.

---

## 0. A restrição mais forte já está garantida por construção

**A integração não tem caminho de escrita no ERP.** Não é disciplina, é ausência
de código: o `TothClient` expõe `get` e `postForm`, e os únicos `postForm` são
`users/login` e `cobrancas` (consulta). `TOTH_CAPABILITIES.pushOrder` é `false`,
e não existe função `toth-push-*`. O ERP é somente leitura.

---

## 1. Estado medido da org (19/08, leitura em prod)

| Entidade | Quantidade | Leitura |
|---|---|---|
| Leads | **2** | org praticamente vazia |
| **Carteira (`upsell_clients`)** | **0** | 🔴 decide o plano inteiro — ver §2 |
| Títulos a receber | 0 | nada a conciliar |
| Workflows **ativos** | **0** (3 existem, todos desligados) | nada dispara |
| Copilot **ativos** | **0** (2 existem, desligados) | nenhuma conversa |
| Campanhas | 0 | nenhum disparo |
| Webhooks ativos | **0** | nenhuma notificação externa |
| Instâncias WhatsApp | 1 | ver §3 |
| Mensagens WhatsApp | 168, sendo **137 órfãs** | ver §3 |

---

## 2. A tensão central: `enrich_only` não serve aqui

O modo seguro padrão (`enrich_only`) **só enriquece cliente que já existe e pula
o resto**. Com a carteira em zero, ele sincronizaria **exatamente nada**.

Para popular é preciso `canonical`, que cria o cliente — e
`upsell_clients.lead_id` é **NOT NULL**, então criar cliente **obriga criar
lead**. Não há caminho alternativo: é uma restrição do schema, não uma escolha.

> **Nuance que torna isso aceitável aqui:** o perigo do `canonical` é sobrescrever
> a curadoria da equipe com dado do ERP. Nesta org **não existe curadoria a
> sobrescrever** — a carteira está vazia. O modo perigoso num CRM povoado é o
> modo correto num CRM zerado.

---

## 3. O que a criação de lead dispara — medido, não suposto

`leads` tem **20 triggers**. `upsell_clients` e `titulos_receber` têm **um cada**,
e só carimbam `updated_at` — são inertes. Todo o risco está no lead.

| Trigger | Dispara? | Por quê |
|---|---|---|
| `trg_workflow_lead_created` | ❌ | 0 workflows ativos |
| `trg_workflow_field_changed` / `_lead_assigned` / `_score_reached` | ❌ | idem |
| `trg_enqueue_lead_webhooks` | ❌ | 0 webhooks ativos → laço vazio |
| `trg_auto_assign_lead_default_pipe` | ❌ | **stage `novo` está INATIVO** — o guard (4) da função retorna antes de inserir em `pipeline_entries` |
| `trg_leads_google_calendar_sync` | ❌ | só reage a campos de reunião |
| `leads_normalize_phone`, `derive_uf`, `audit_leads` | ✅ | inócuos — normalizam e auditam |
| **`tg_leads_adopt_orphan_messages`** | ⚠️ **SIM** | ver abaixo |

### 3.1 🟠 O único efeito real: adoção de conversas órfãs

O trigger faz `UPDATE whatsapp_messages SET lead_id = <novo lead>` para toda
mensagem sem dono cujo `normalized_phone` bata com o do lead criado. Há **137
mensagens órfãs** na org.

Consequência: conversas que hoje aparecem como "Sem lead" passariam a ficar
penduradas nos clientes vindos do ERP. **Não envia nada, não notifica ninguém** —
é vínculo de dado. Provavelmente é até desejável, mas é mudança na operação
atual, então é decisão sua, não default meu.

- **Quantas casariam?** Desconhecido até termos os telefones do ERP. O passo de
  dry-run (§4.2) mede isso **antes** de qualquer escrita.
- **Reversível:** `UPDATE whatsapp_messages SET lead_id = NULL WHERE lead_id IN
  (<leads criados>)`, mesma coisa para `whatsapp_conversation_summary`.
- **Não dá para evitar guardando o telefone depois:** o trigger é
  `INSERT OR UPDATE`. Adiar só adia.

### 3.2 ⚠️ Fragilidade a conhecer

O funil não é semeado **porque a stage `novo` está inativa hoje**. Se alguém a
ativar, os leads criados **a partir daí** passam a virar card. Os já criados não
são semeados retroativamente. Combinar de não mexer nas stages durante a janela.

---

## 4. Plano

### 4.1 Pré-requisito — conectar a org (humano)

Só um admin logado da Café Jurerê consegue: a edge function resolve a org pelo
JWT, nunca pelo corpo. Em Configurações → Integrações → Toth:

- endereço `http://cafejurere.ddns.net:8080/toth/services`
- usuário e senha da integração (idealmente o técnico somente-leitura; se ainda
  for o compartilhado, **trocar a senha depois**)
- marcar o aceite de tráfego sem criptografia

Escreve só em `toth_connections` + `toth_connection_secrets` — tabelas inertes.
**Este é o primeiro contato real com a API.** Se o login falhar, para aqui.

### 4.2 🔴 Construir o dry-run ANTES de sincronizar — falta no código

Hoje `toth-sync-clientes` é tudo-ou-nada: até 20 páginas × 100 = **2000 clientes
numa tacada**, sem opção de amostra e sem prévia. Para o cuidado que você pediu,
falta:

- `dry_run: true` — busca, mapeia e **relata** sem escrever nada;
- `max_clients: N` — piloto pequeno;
- no relatório do dry-run: quantos clientes vieram, quantos têm CNPJ, quantos têm
  telefone, e **quantas das 137 órfãs casariam** — o número que decide §3.1.

É a única alteração de código que este plano exige. Sem ela, o primeiro `sync` é
irreversível na prática (dá para apagar, mas já terá criado leads e adotado
conversas).

### 4.3 Sondagem sem escrita

`toth-probe` com `{ "discover": true }` e depois `{ "path": "clientes" }`.
Devolve **forma**, não dado: nomes de campo, tipos, taxa de preenchimento. Zero
escrita no CRM. Confirma que `codigoCliente` e `numeroInscricao` existem mesmo e
que o volume é o esperado.

> Limite conhecido: o probe só faz `GET`, então **não cobre `/cobrancas`** (que é
> `POST`). O dry-run de §4.2 cobre.

### 4.4 Dry-run de clientes → **PONTO DE PARADA**

Rodar com `dry_run: true`. Conferir com alguém da Café Jurerê:

- o total bate com o que o ERP mostra na tela?
- os nomes e CNPJs estão corretos numa amostra de 5?
- quantas conversas órfãs seriam adotadas? **Decidir aqui** (§3.1).

Não seguir sem esse aceite. Foi o próprio fornecedor quem pediu: *"pode ter
particularidades neles que pode atrapalhar"*.

### 4.5 Piloto real — 10 clientes

`erp_sync_mode = 'canonical'`, `max_clients: 10`. Verificar no CRM:

- 10 clientes na carteira, cada um com o lead correspondente;
- **nenhum card novo no funil** (`pipeline_entries` continua em 2);
- `webhook_deliveries` sem linha nova;
- `runtime_logs` sem erro.

**Rollback do piloto** (§6) se qualquer item falhar.

### 4.6 Carga completa de clientes

Remover `max_clients`. Reexecutar até `stop_reason` indicar fim. Reconferir a
contagem total com a tela do ERP.

### 4.7 Cobranças

`toth-sync-cobrancas`, que depende dos clientes já casados por CNPJ. Primeira
execução com `{ "full": true }` para trazer o histórico; depois a janela padrão
(±45 dias) basta.

Conferir especificamente: **um cliente com pagamento parcial** e **um com título
quitado** — são os dois casos onde a semântica de saldo foi corrigida e onde um
erro apareceria como inadimplência falsa.

### 4.8 Cron — só depois de tudo conferido

Não existe job agendado hoje, e **é assim que deve ficar até aqui**. Só então
criar: clientes 1×/dia, cobranças a cada 2h, clientes sempre antes.

---

## 5. O que este plano NÃO faz

- Não escreve nada no ERP.
- Não ativa workflow, campanha ou Copilot — todos permanecem como estão.
- Não envia mensagem a ninguém.
- Não mexe em stages, funis ou permissões.
- Não toca nos 2 leads que já existem (o casamento é por `external_id`/CNPJ; sem
  CNPJ neles, não há colisão).

---

## 6. Rollback

Tudo o que a sincronização cria é rastreável por `external_source = 'toth'`:

```sql
-- 1. desfazer a adoção de conversas
UPDATE whatsapp_messages SET lead_id = NULL
 WHERE organization_id = '<org>' AND lead_id IN (
   SELECT lead_id FROM upsell_clients
    WHERE organization_id = '<org>' AND external_source = 'toth');
UPDATE whatsapp_conversation_summary SET lead_id = NULL
 WHERE organization_id = '<org>' AND lead_id IN (... mesma subconsulta ...);

-- 2. títulos, clientes, leads (nesta ordem — FK)
DELETE FROM titulos_receber  WHERE organization_id='<org>' AND external_source='toth';
DELETE FROM upsell_clients   WHERE organization_id='<org>' AND external_source='toth';
DELETE FROM leads            WHERE organization_id='<org>' AND origin='erp_toth';

-- 3. desligar
UPDATE toth_connections SET erp_sync_mode='off' WHERE organization_id='<org>';
```

⚠️ Rodar a subconsulta de (1) **antes** do DELETE de (2) — depois de apagar os
clientes não há como saber quais leads eram do ERP por essa via (embora
`origin='erp_toth'` continue servindo).

---

## 7. Resumo do risco

| | |
|---|---|
| Disparo de mensagem / campanha / Copilot | **Nenhum** — tudo desligado na org |
| Escrita no ERP | **Nenhuma** — não existe caminho no código |
| Card novo no funil | **Nenhum** — stage `novo` inativa (frágil, ver §3.2) |
| Webhook externo | **Nenhum** — 0 webhooks ativos |
| Mudança na operação atual | **Uma**: adoção de conversas órfãs (§3.1), reversível |
| Não validado | A integração **nunca rodou contra a API real** |
