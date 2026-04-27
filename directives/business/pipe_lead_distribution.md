# Distribuição de leads em pipes (funis) — Escopo para fase 2

**Status:** Escopo/desenho. Implementação prevista após estabilização da rotação em campanhas.

## Objetivo

Quando um lead entra em um pipe (whatsapp, confirmacao, propostas) — via webhook `place_in_pipe`, integrações ou criação manual — poder atribuir SDR (e, se aplicável, closer) de forma **rotativa** ou **aleatória**, conforme configuração por pipe ou global.

## Situação atual

- **lead-webhook** ([supabase/functions/lead-webhook/index.ts](../../supabase/functions/lead-webhook/index.ts)): ao usar `place_in_pipe` apenas define a etapa do lead no pipe; **não** preenche `sdr_id` (nem `closer_id` no pipe de propostas) com base em rotação.
- Não existe tabela nem configuração de “regras de distribuição” por pipe.

## Escopo proposto (fase 2)

### 1. Modelo de configuração

- **Opção A — Por organização e pipe:**  
  Tabela ex.: `pipe_distribution_rules`  
  - `organization_id`, `pipe` (enum: 'whatsapp' | 'confirmacao' | 'propostas')  
  - `mode`: 'round_robin' | 'random'  
  - `team_member_ids`: array de UUID (ou FK para uma tabela “grupo” de membros)  
  - Ordem dos membros para round_robin pode ser a ordem no array ou por `created_at` na tabela de vínculo.
- **Opção B — Global por organização:**  
  Uma única configuração por organização aplicada a todos os pipes (menos flexível).
- **Recomendação:** Opção A para permitir regras diferentes por pipe (ex.: WhatsApp com 3 SDRs, Confirmação com 2 closers).

### 2. Contagem para round_robin

- Por pipe: contar registros em `pipe_whatsapp` / `pipe_confirmacao` / `pipe_propostas` (por organização, ou por pipe + organização).
- Índice do próximo: `count % length(team_member_ids)`; atribuir `sdr_id` (e no pipe propostas, se houver regra de closer, `closer_id`).

### 3. Onde aplicar

- **lead-webhook:** após inserir ou atualizar o registro no pipe (`place_in_pipe`), se existir regra de distribuição para aquele pipe e o registro ainda não tiver `sdr_id` (e closer quando aplicável):
  - Chamar lógica “próximo SDR” (e eventualmente “próximo closer”) para aquele pipe.
  - Atualizar o registro com `sdr_id` (e `closer_id` se for o caso).
- **Front (opcional):** ao criar/colocar lead em um pipe manualmente, poder usar “Distribuir automaticamente” e chamar uma RPC análoga a `get_next_campaign_sdr`, ex.: `get_next_pipe_sdr(p_pipe text, p_organization_id uuid)`.

### 4. RPC sugerida

- `get_next_pipe_sdr(p_pipe text, p_organization_id uuid)`  
  Retorna `team_member_id` (UUID) ou null.  
  Lógica: ler regra em `pipe_distribution_rules` para (p_organization_id, p_pipe); se round_robin, count no pipe correspondente e `member_ids[count % length]`; se random, escolher aleatório entre member_ids.

### 5. Segurança e RLS

- Regras de distribuição por organização; RLS nas novas tabelas para que apenas usuários da organização vejam/editem.
- RPC com `SECURITY INVOKER` para respeitar RLS ao ler pipes e regras.

## Arquivos a criar/alterar (quando implementar)

- Nova migration: tabela `pipe_distribution_rules` (e índice por organization_id + pipe).
- Nova RPC: `get_next_pipe_sdr(p_pipe, p_organization_id)` (e, se necessário, `get_next_pipe_closer` para propostas).
- [lead-webhook/index.ts](../../supabase/functions/lead-webhook/index.ts): após `place_in_pipe`, consultar regra, chamar RPC e atualizar `sdr_id` (e `closer_id` quando aplicável).
- Front (opcional): tela de configuração por pipe (quem participa da rotação, modo) e uso da RPC ao adicionar lead ao pipe com “Distribuir automaticamente”.

## Referência

- Lógica de campanhas: [supabase/functions/_shared/campaign-distribution.ts](../../supabase/functions/_shared/campaign-distribution.ts) e RPC [get_next_campaign_sdr](../../supabase/migrations/20260231000000_get_next_campaign_sdr_rpc.sql).
