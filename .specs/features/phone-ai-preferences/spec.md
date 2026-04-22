# phone_ai_preferences — Spec

**Created:** 2026-04-22
**Status:** Implementing
**Conductor:** agent-conductor
**Agents rota:** Architect → Security (threat) → DBA → Backend → Security (RLS) → AI → Frontend → QA → Security (gate)

## Context

Usuários relatam que o toggle "IA" no chat WhatsApp comporta-se de maneira inconsistente. Três evidências reais capturadas em produção:

1. **IA respondendo em cima do humano (REALSC / Fripel, 2026-04-22 09:00 BRT):** humano atende em paralelo ao disparo de abertura do Copilot; vendedor desliga a IA mas a IA envia uma 2ª resposta 36s depois do desativamento porque a janela "gerar resposta → send Evolution" não re-consulta o flag.
2. **Toggle falha silenciosamente (REALSC, 2026-04-22 10:38 BRT):** cliente tenta desligar IA em contato sem lead, RPC `toggle_conversation_ai` falha com `invalid input value for enum lead_origin: "shadow_ai_toggle"`. Logs Postgres mostram 7 tentativas em 7 segundos. IA permanece ligada, front mostra toast cru.
3. **IA abrindo conversa mesmo quando o humano iniciou a prospecção (REALSC / Mauricio, 2026-04-22 10:30 BRT):** humano disparou 1ª outgoing, contato respondeu, webhook criou lead com `ai_disabled=false` (default), Copilot disparou greeting ignorando a outgoing prévia.

Causa raiz estrutural: a flag `ai_disabled` mora em `leads.ai_disabled`. Sem lead → sem lugar físico pra guardar a preferência. O contorno atual (`toggle_conversation_ai` criando shadow lead com `origin='shadow_ai_toggle'`) está quebrado por enum inválido, não está versionado em migration, e usa normalização de telefone divergente do resto do sistema.

## Requirements

### Functional

- **FR-01**: Toggle "IA off" em contato **sem lead** deve persistir a preferência de forma durável, sem criar entidade fantasma em `leads`.
- **FR-02**: Quando o contato envia a 1ª mensagem e o lead é criado, o `ai_disabled` do lead novo deve **herdar** a preferência já salva para aquele `(organization_id, normalized_phone)`.
- **FR-03**: Toggle em lead existente deve continuar funcionando (via `toggle_lead_ai`), mas agora **também escreve** na tabela de preferências para ser fonte única de verdade cross-lead.
- **FR-04**: Leads duplicados dentro da mesma org com mesmo `normalized_phone` devem ficar consistentes — nenhum caminho pode deixar duplicatas com `ai_disabled` divergente.
- **FR-05**: Front deve refletir o estado real **imediatamente** após toggle bem-sucedido, com optimistic update coerente e rollback visual em caso de erro.
- **FR-06**: Erros devem ser logáveis e diagnosticáveis; não pode haver falha silenciosa com percepção errada de sucesso.

### Non-Functional

- **NFR-01**: Multi-tenant isolado por `organization_id` via RLS (impedir que org A leia/escreva preferência de org B).
- **NFR-02**: Normalização de telefone: uma única fonte de verdade. SQL usa `normalize_brazilian_phone()`. TS usa `normalizePhone()` (src/lib) ou `normalizePhoneForSearch()` (edge), ambos alinhados ao comportamento do SQL. Cobrir divergência com testes de equivalência.
- **NFR-03**: RPC acessível via PostgREST (authenticated role) com `SECURITY DEFINER` e validação explícita de organização — mesmo padrão de `toggle_lead_ai`.
- **NFR-04**: Toda RPC que cria/atualiza estado deve ser versionada em migration — RPC "fantasma" criada direto no banco é anti-padrão e deve ser eliminada.
- **NFR-05**: Sem nova janela de condição de corrida: quando a preferência muda, leads existentes **e** o estado consumido pelo webhook de ingestão devem ser sincronizados atomicamente.

### Out of Scope (nesta task)

- Refactor do copilot pra cancelar respostas já "em voo" (geradas mas não enviadas). Isso é uma 2ª camada — a 1ª fecha quando o send-time re-checa a preferência. Suficiente para os 3 incidentes observados.
- Consolidação de leads duplicados (merge + unique constraint). Permanece no P2 como a migration `20260915000000` já documentou.
- Alteração do enum `lead_origin` para aceitar `shadow_ai_toggle` — a solução remove a necessidade desse valor.

## Acceptance Criteria

- **AC-01** — Contato sem lead: usuário desliga IA, nenhuma linha nova em `leads`, linha aparece em `phone_ai_preferences`, front atualiza visualmente sem flicker.
- **AC-02** — Primeira mensagem após toggle prévio: `getOrCreateLead` consulta `phone_ai_preferences` antes de default `false`; lead criado já nasce com `ai_disabled=true`; Copilot não dispara greeting.
- **AC-03** — Lead existente: `toggle_lead_ai` faz UPSERT em `phone_ai_preferences`, garantindo que novos leads com mesmo telefone herdem; duplicatas permanecem sincronizadas (comportamento da migration `20260915`).
- **AC-04** — Divergência front/back: Switch lê de uma fonte de verdade por `(org, phone)` quando há chat aberto, e por `lead_id` quando há lead focado; optimistic update escreve em ambas as chaves para consistência cross-view.
- **AC-05** — Erro de RPC: rollback visual; toast de erro traduzido (não mostrar sql_state bruto).
- **AC-06** — Multi-tenant: pgTAP/integration test prova que org B não consegue SELECT/UPDATE/DELETE preferência da org A.
- **AC-07** — Normalização: testes provam que SQL + TS canônico produzem mesmo output pra casos-padrão (com/sem 55, 10/11 dígitos, formatação).
- **AC-08** — Regressão do enum: test reproduz o cenário "toggle sem lead" e confirma que NÃO tenta inserir `origin='shadow_ai_toggle'` em `leads`.
- **AC-09** — `toggle_conversation_ai` antiga removida do banco (via migration DROP). Se código frontend ainda chamar `toggle_phone_ai` (novo nome), bate nova RPC.
- **AC-10** — Observabilidade: RPC gera `lead_history` / `runtime_logs` suficiente pra diagnosticar falhas em produção.

## Non-Goals

- Não remover shadow leads como conceito do sistema. Shadow leads continuam existindo para outros fluxos (copilot atendendo "unknown contacts"). Apenas o uso indevido em toggle é eliminado.
- Não substituir `toggle_lead_ai`. Ela continua sendo a RPC certa para toggle com `lead_id`.
