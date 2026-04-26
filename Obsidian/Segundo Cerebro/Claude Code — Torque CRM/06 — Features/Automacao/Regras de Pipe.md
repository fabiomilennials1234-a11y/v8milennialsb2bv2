---
tags:
  - claude-code
  - feature
  - torque-crm
  - automacao
created: 2026-04-12
last_updated: 2026-04-26
status: active-migrating
---

# Regras de Pipe

> [!warning] Trilha 3.A — Em migracao pro workflow engine (2026-04-26)
> Pipe rules agora geram **wrapper workflows** internamente. UI nao muda.
> Backend persiste em `workflows` com `wrapper_for='pipe_rule'` +
> `wrapper_source_id` (FK virtual pra `pipe_dispatch_rules.id`).
> `pipe-rule-dispatch` cron continua rodando mas vira shim que cancela
> items pendentes de rules com wrapper. Workflow engine (`process-workflow-executions`)
> assume processamento.
> Drop tabelas + cron legados: +30d soak (Fase A4 cleanup).
> Conversor: `convert_pipe_rule_to_workflow(p_rule_id uuid) RETURNS uuid`.

## O que faz

Dispatch automatico de mensagens quando lead entra ou muda de stage nos pipes estruturais (WhatsApp/Confirmacao/Propostas). Sequences configuraveis com delay, wait_response, timeout, e reassignment.

## Regras de negocio

- Trigger types: `lead_added`, `lead_moved_to_stage`
- Action types: `send_template`, `wait_response`, `change_stage`, `assign_sdr`, `cancel_sequence`
- Wait_response tem timeout configuravel (wait_timeout_minutes)
- Processado via fila `scheduled_pipe_messages`
- Se lead muda de stage durante sequence ativa, sequence anterior e cancelada

## Como o usuario usa

1. Na configuracao de cada pipe (WhatsApp/Confirmacao/Propostas)
2. Define trigger: qual evento dispara a regra
3. Seleciona stage afetada
4. Adiciona steps: enviar template → aguardar resposta → timeout → mover stage
5. Ativa a regra

## Edge cases

- Lead que muda de stage cancela sequence ativa anterior
- wait_response sem timeout pode ficar stuck (status muda para `timed_out` apos timeout_minutes)
- Template deletado nao invalida a regra (step falha silenciosamente)
- Multiplas regras podem triggar simultaneamente para o mesmo lead

---

## Como funciona (tecnico)

### Componentes

Reutiliza componentes de dispatch rules das campanhas.

### Hooks

Dados acessados via Supabase client direto. Dispatch via edge function invoke.

### Edge Functions

- `pipe-rule-dispatch` — Cron 1 min. Processa fila `scheduled_pipe_messages`.

### Tabelas

- `pipe_dispatch_rules` — pipe_type (whatsapp/confirmacao/propostas), trigger_type, pipeline_stage_id, is_active, organization_id
- `pipe_dispatch_rule_steps` — rule_id, action_type, template_id, delay_minutes, position, wait_timeout_minutes
- `scheduled_pipe_messages` — pipe_type, rule_id, pipe_record_id, lead_id, status (scheduled/sent/failed/waiting_response/timed_out/executed), action_type, target_stage_id, error_message

### Fluxo de dados

```
Lead entra/muda de stage no pipe
  → Trigger detectado → cria scheduled_pipe_messages para cada step
    → pg_cron 1 min → pipe-rule-dispatch
      → Processa fila: step 1 (send_template) → aguarda delay → step 2 (wait_response)
        → Se resposta recebida: marca como executed, avanca
        → Se timeout: marca como timed_out, executa acao de fallback
          → step 3 (change_stage ou assign_sdr) → executa
```

---

## Historico de mudancas

## Links relacionados

- [[Pipe WhatsApp]]
- [[Pipe Confirmacao]]
- [[Pipe Propostas]]
- [[Templates de Mensagem]]
