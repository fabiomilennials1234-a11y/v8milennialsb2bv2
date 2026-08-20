# 2026-08-20 — "Lead não respondeu" passa a enxergar o canal oficial

Issue [#1693](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1693) ·
épico #1684 · descoberto no #1686 (PR #1694).

## Mudança

- **`find_leads_no_reply`** (função de banco consultada pelo cron
  `process-workflow-executions` para o gatilho `lead_no_reply`) ganhou uma
  segunda guarda `NOT EXISTS`, sobre `channel_messages`. A guarda que já existia
  sobre `whatsapp_messages` **não foi tocada**.
- Chave de correspondência **por canal**, não por campo preenchido:
  - `lead_id` — vale em qualquer canal (inclusive Instagram já vinculado);
  - **telefone** — só no canal `whatsapp` e só quando não há vínculo de lead,
    normalizado por `normalize_br_mobile`, a mesma régua de
    `resolve_wait_response_by_phone`.
- Migration: `20270820160000_find_leads_no_reply_enxerga_canal_oficial.sql`.
  **Não aplicada em produção** — aplicar é decisão do CTO.

## O defeito, medido

`find_leads_no_reply` lia uma tabela só: `whatsapp_messages`, o chip. As
mensagens do canal oficial vivem em `channel_messages` e nascem sem vínculo de
lead. Medido em prod em 2026-08-20: **5.312 de 5.312** mensagens de entrada do
canal oficial de WhatsApp têm telefone, e só **3.521** têm `lead_id`.

Consequência: quem respondia pelo número oficial continuava na lista de "sumiu"
e levava a cobrança automática.

## Ensaio transacional contra produção

`scripts/ensaio-1693.sh` — BEGIN / medição ANTES / migration real por
concatenação / asserções / medição DEPOIS / ROLLBACK. Corte de 24h congelado,
**107 organizações**, nenhuma amostra.

| Eixo | Antes | Depois | Saiu | Entrou |
|---|---|---|---|---|
| 100 orgs só-chip (19 com candidato) | 1.487 | 1.487 | 0 | 0 |
| 7 orgs com canal oficial | 1 | 1 | 0 | 0 |

Matriz de 6 casos plantados e revertidos: resposta oficial por telefone (sem o
nono dígito) e por vínculo saem da lista; Instagram vinculado sai; **saída**,
Instagram sem vínculo e "não respondeu em canal nenhum" permanecem.

Duas provas de que o ensaio é carga, e não enfeite:

1. **Controle negativo** — o mesmo ensaio sem a migration no meio falha com
   `VERDE FALHOU` nomeando L1, L2 e L6.
2. **Teste de mutação** — trocar o recorte de tenant por `OR true` falha com
   `REGRESSAO NO EIXO DO CHIP: Barulinho Bom (saiu=1); SOBRAL FRIOS (saiu=1)`.

Grants conferidos depois do `CREATE OR REPLACE`: `anon=false`,
`authenticated=false`, `service_role=true`.

## Irmã não tocada, e por quê

`get_leads_no_response_from_lead` (regras de `follow_up_automations`, gatilho
`no_response_from_lead`) tem a **mesma cegueira**: lê só `whatsapp_messages` e
casa por `lead_id`. Ficou fora porque o conserto ali não é uma guarda a mais — a
função escolhe a *última* mensagem do lead e devolve `last_outgoing_at`, então
somar o canal oficial muda a semântica do retorno, não só o filtro.

Medido: **1 regra ativa, 1 organização** (Drink Express), e essa organização tem
**zero** linhas em `channel_messages`. Não está produzindo o defeito hoje.
