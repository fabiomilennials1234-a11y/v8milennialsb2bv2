# Mapa das 7 DEFINER restantes — org_id por parâmetro, sem gate

**Contexto:** continuação do achado adjacente do INV-2. As duas primeiras (`enqueue_webhook_deliveries_for_org`, `fire_workflow_trigger`) já foram fechadas em prod por REVOKE autorizado pelo CTO. Este documento cobre as 7 restantes.

**Data:** 2026-08-11
**Onde medi:** Postgres local do stack Supabase (`127.0.0.1:54322`), schema montado pelas migrations do repo (baseline = dump de prod de 06/ago + posteriores). Toda escrita foi feita dentro de transação com `ROLLBACK` — nada persistiu, nem local nem em prod.
**Como medi:** `SET LOCAL ROLE authenticated` sem JWT nenhum, chamando cada função com o `organization_id` de uma org da qual o chamador não é membro.

---

## Veredito — as 7 são VULNERÁVEIS. Nenhuma é SEGURA.

Li o corpo inteiro das 7. **Nenhuma tem gate**: zero `auth.uid()`, zero `assert_org_access`, zero `is_master_user`, zero join de associação, zero filtro por org derivado do chamador. Em todas, o `organization_id` chega por parâmetro e é obedecido.

O filtro regex do CTO não perdeu gate nenhum — não havia gate para perder.

| # | Função | Veredito | Dano | Revogar `authenticated` é seguro? |
|---|---|---|---|---|
| 1 | `schedule_pipe_rule_steps_from_position` | 🔴 **VULNERÁVEL — CRÍTICA** | WhatsApp cross-tenant | ✅ sim |
| 2 | `resolve_wait_response` | 🔴 **VULNERÁVEL** | força retomada de workflow (dispara mensagem) | ✅ sim |
| 3 | `advance_onboarding_state` | 🔴 **VULNERÁVEL** | escreve em `organizations` + 2 oráculos | ✅ sim |
| 4 | `acquire_copilot_lock` | 🟠 **VULNERÁVEL** | DoS no Copilot da vítima | ✅ sim |
| 5 | `get_next_round_robin_member` | 🟠 **VULNERÁVEL** | corrompe rodízio de leads | ✅ sim |
| 6 | `create_default_pipelines` | 🟡 **VULNERÁVEL** | polui funis da vítima | ❌ **NÃO — o front chama** |
| 7 | `ensure_pipeline_display_config` | 🟡 **VULNERÁVEL** | polui config de exibição | ❌ **NÃO — o front chama** |

**5 são superfície inútil** (só edge function com service_role chama) → revoke resolve.
**2 são usadas pelo browser** → revoke quebra o produto; precisam do molde `_unchecked` + wrapper.

---

## O argumento do DEFINER/dono, aplicado uma a uma

A regra que sustenta "revogar é seguro": o chamador interno roda como **dono**, não como quem chamou — desde que o chamador seja `SECURITY DEFINER` e o dono mantenha `EXECUTE`. Medido função a função:

| Alvo | Chamadores no banco | DEFINER? | Dono | Pendurado em | Veredito do caminho legítimo |
|---|---|---|---|---|---|
| `schedule_pipe_rule_steps_from_position` | `trigger_pipe_dispatch_rules`, `trigger_pipeline_entries_dispatch`, `trigger_whatsapp_response_detection` | **3/3 sim** | `postgres` | `pipeline_entries`, `whatsapp_messages` (1 órfã) | seguro por construção |
| `resolve_wait_response` | `resolve_wait_response_by_phone` | **sim** | `postgres` | órfã (chamada por edge fn) | seguro por construção |
| `advance_onboarding_state` | — nenhum | n/a | n/a | n/a | seguro (só edge fn) |
| `acquire_copilot_lock` | — nenhum | n/a | n/a | n/a | seguro (só edge fn) |
| `get_next_round_robin_member` | — nenhum | n/a | n/a | n/a | seguro (só edge fn) |
| `create_default_pipelines` | `trigger_create_default_stages` | **NÃO — INVOKER** | `postgres` | **órfã** | ⚠️ ver exceção abaixo |
| `ensure_pipeline_display_config` | — nenhum | n/a | n/a | n/a | — |

### ⚠️ A exceção que o argumento não cobre

`trigger_create_default_stages` é o **único chamador INVOKER** do conjunto — exatamente o caso que quebraria com o REVOKE, porque função INVOKER roda como quem disparou o statement, e um `authenticated` sem EXECUTE tomaria `permission denied` no INSERT.

**Só não quebra porque a função está órfã**: não há trigger pendurado em tabela nenhuma (`pg_trigger` vazio para ela). É código morto.

Registro isso não porque muda a conclusão de hoje, mas porque **a regra "chamador é DEFINER, logo é seguro" tem contraexemplo neste repo**. Se `trigger_create_default_stages` voltar a ser pendurada em `organizations` sem virar DEFINER, o REVOKE passa a quebrar criação de org. Vale um comentário na própria função.

---

## Chamadores no aplicativo (`git grep` em `src/` e `supabase/functions/`)

| Função | Quem chama | Papel |
|---|---|---|
| `schedule_pipe_rule_steps_from_position` | `supabase/functions/pipe-rule-dispatch/index.ts` | edge, `service_role` |
| `resolve_wait_response` | `whatsapp-webhook/index.ts`, `sz-chat-webhook/index.ts` | edge, `service_role` |
| `advance_onboarding_state` | `onboarding-advance/index.ts` | edge, `service_role` |
| `acquire_copilot_lock` | `agent-message/index.ts` | edge, `service_role` |
| `get_next_round_robin_member` | `_shared/workflow-executor.ts` | edge, `service_role` |
| `create_default_pipelines` | **`src/modules/pipelines/hooks/model/usePipelineEntries.ts:178`** | **browser, `authenticated`** |
| `ensure_pipeline_display_config` | **`src/modules/pipelines/hooks/config/usePipelineDisplayConfig.ts:29`** | **browser, `authenticated`** |

As duas chamadas do front mandam o org_id **do cliente**:

```ts
await supabase.rpc("create_default_pipelines", { p_org_id: organizationId });
await supabase.rpc("ensure_pipeline_display_config", { p_org_id: organizationId });
```

Isso viola a regra do próprio repo (*"O frontend nunca envia org_id — vem do auth context"*, CLAUDE.md). São o caso clássico do molde `_unchecked` + wrapper: o wrapper deriva a org do `auth.uid()` e ignora o parâmetro.

---

## 1. 🔴 `schedule_pipe_rule_steps_from_position` — CRÍTICA, vetor de ban

Pior que a `fire_workflow_trigger` que já fechamos, por um motivo específico:

```sql
FOR step_rec IN
  SELECT ... FROM public.pipe_dispatch_rule_steps
  WHERE rule_id = p_rule_id            -- <<< SEM filtro de organization_id
    AND position >= p_from_position
```

O `rule_id` não é confrontado com o `p_organization_id`. O atacante combina **a regra dele** com **a org, o lead e a instância de WhatsApp da vítima**. Resultado: mensagem com **texto escrito pelo atacante**, disparada **pelo número da vítima**, para **o lead da vítima**.

### Prova executada

```
 papel         |   jwt   | agendou
 authenticated | SEM JWT | t

 fila_da_org | enviado_pelo_numero | dono_do_texto | status    | vence_agora | content
 …0000aa     | numero-da-vitima    | …0000bb       | scheduled | t           | Mensagem escrita pelo ATACANTE,
             |                     |               |           |             | disparada pelo numero da VITIMA
```

`fila_da_org` = VÍTIMA. `dono_do_texto` = ATACANTE. `vence_agora` = true (`delay_minutes=0`).

### Laço fechado até o envio

`supabase/functions/pipe-rule-dispatch/index.ts:271-276` seleciona `status='scheduled' AND scheduled_at <= now()`, ordena por `scheduled_at`, e envia. **Nenhuma checagem de origem.** Roda como `service_role`.

Dano: envio em massa a partir do número de um cliente, com conteúdo arbitrário — ban do WhatsApp da vítima, e o cliente vê a mensagem saindo do próprio número.

## 2. 🔴 `resolve_wait_response`

Vira `workflow_executions` da vítima de `waiting_response` → `running` com `next_run_at = NOW()`, injetando `_wait_resolved: 'replied'` no contexto. O executor retoma e avança para o próximo nó — que tipicamente **envia mensagem**.

Pré-condição que limita (mas não elimina) a exploração: precisa de um `lead_id` real da vítima. UUID não é adivinhável, mas vaza em payload de webhook, em export, e é conhecido por ex-funcionário. Sem `p_lead_id` válido a função retorna 0 — por isso não classifico como crítica, mas o gate ausente é idêntico.

## 3. 🔴 `advance_onboarding_state`

Escreve na **própria tabela de tenant**. Prova:

```
 onboarding_state  |      onboarding_answers
 pending_pipelines | {"injetado_pelo": "atacante"}
```

Avançou o estado da vítima e sobrescreveu `onboarding_answers` com JSON arbitrário. Também dá dois **oráculos** pelas mensagens de erro:

```
ERROR:  Organization not found: …9999          -- existência de org
ERROR:  State mismatch: expected chute, got pending_profile   -- estado interno da vítima
```

## 4. 🟠 `acquire_copilot_lock`

Toma o lock `(phone, organization_id)` da vítima. Enquanto o lock estiver fresco (60s), o `agent-message` pula aquela conversa. Repetindo a cada 60s, **silencia o agente de IA da vítima** naquele telefone. Prova: `lock_da_vitima_tomado = t`, 1 linha em `copilot_processing_locks` da vítima.

## 5. 🟠 `get_next_round_robin_member`

Grava/avança `workflow_round_robin_state` de workflow alheio. Prova: 1 linha criada na org da vítima. Dano: distorce a distribuição de leads entre vendedores da vítima (um recebe tudo, outro nada). Não vaza dado — o array de membros é fornecido pelo atacante, então o retorno não revela nada.

## 6-7. 🟡 `create_default_pipelines` / `ensure_pipeline_display_config`

Prova: 3 pipelines e 4 linhas de display config criadas na org da vítima. `ON CONFLICT DO NOTHING` limita a poluição aos defaults ausentes. Dano baixo, mas é escrita cross-tenant na mesma medida.

**Não revogar.** São as duas que o browser usa. Molde `_unchecked` + wrapper.

---

## Recomendação (não executada)

1. **Agora, reversível em uma linha:** `REVOKE EXECUTE ... FROM authenticated` nas 5 de superfície inútil — `schedule_pipe_rule_steps_from_position`, `resolve_wait_response`, `advance_onboarding_state`, `acquire_copilot_lock`, `get_next_round_robin_member`. Caminho legítimo é edge com `service_role`, e os chamadores internos são DEFINER de dono `postgres`.
2. **Depois:** wrapper para as 2 do front, derivando a org do `auth.uid()`.
3. **Independente do revoke:** o `rule_id` sem filtro de org em `schedule_pipe_rule_steps_from_position` é um bug por si só. Mesmo com o grant fechado, um dia alguém expõe essa função por outro caminho.
4. **INV-2 deveria cobrir `authenticated`.** As 9 nunca seriam flagradas pelo invariante atual, que só olha `anon` e `PUBLIC`.
