# 35. O Aviso é uma linha viva, não um evento imutável

Date: 2026-08-31

## Status

Accepted

Origem: sessão de grilling sobre notificações (sino + som + canal quente). Relaciona-se a
ADR-0007 (métricas de reunião event-sourced), que fornece o evento `meeting_booked` consumido aqui.

## Context

O sino de hoje (`AlertsDropdown`) mistura duas naturezas na mesma lista. Quatro tipos —
`meeting_today`, `meeting_soon`, `follow_up_due`, `overdue` — não existem em lugar nenhum: são
`SELECT` refeitos a cada 60 segundos contra `pipe_confirmacao` e `follow_ups`. Outros três —
`transfer_to_human`, `workflow_alert`, resposta de Chamado — são linhas reais em `notifications`.

Dessa mistura saem três defeitos que não se consertam separadamente:

- **Não há "não lido".** Para os tipos derivados, o que já foi visto vive em `localStorage`
  (`v8-alerts-viewed-ids`, teto de 200 ids). Troca de máquina, troca de navegador ou limpeza de
  cache e tudo volta a piscar.
- **Não há como tocar som.** Som exige saber que algo é *novo*. Comparar a lista de agora com a
  lista de 60 segundos atrás não distingue "chegou" de "ainda está lá": um follow-up atrasado está
  atrasado continuamente, e tocaria para sempre.
- **A query nem filtra a organização.** `notifications` é lida só por `user_id`; quem participa de
  duas orgs vê, na org A, aviso nascido na org B.

O motivo estrutural é um só, e a memória do projeto já o tinha catalogado noutro contexto: **coluna
de estado não é trilha**. `due_date` e `meeting_date` descrevem agora; notificação é passado por
definição. Enquanto o sino derivar estado, ele não tem o que notificar.

O segundo fato que molda o desenho é volume. Uma única org movimenta ~268 mil mensagens em 30 dias
(~8,9 mil/dia). Uma linha por mensagem inbound tornaria a tabela e o som inutilizáveis no primeiro
dia — e 70–86% do inbound entra sem `lead_id`, ou seja, sem ninguém a quem endereçar, num campo
`user_id` que é `NOT NULL`.

## Decision

1. **Fonte única.** Todo aviso nasce como linha em `notifications`. O frontend lê e marca `read_at`;
   nunca inventa item por query. Os quatro tipos derivados passam a ser materializados por cron
   (varredura das 7h para follow-ups; janela de 15 minutos para reunião dentro de 1h).

2. **O Aviso coalesce por `group_key`.** Uma linha por *conversa*, não por mensagem: a primeira
   mensagem não lida cria; as seguintes fazem `UPDATE` na mesma linha, incrementando `event_count` e
   avançando `last_event_at`. A unicidade vale **apenas enquanto não lida** — índice único parcial
   `(user_id, group_key) WHERE read_at IS NULL`. Lida a linha, ela sai do índice e o próximo evento
   nasce como aviso novo, que é exatamente o comportamento desejado.

3. **`group_key` não é a entidade que o aviso abre.** Uma automação falhando agrupa por Workflow e
   abre na Execution. Por isso a chave é coluna própria, e não `entity_id` reaproveitado.

4. **Sem dono, não nasce aviso.** O destinatário é derivado (`responsible → closer → sdr` para
   conversa; `admin`s da org para falha de automação; Closer da reunião para agendamento). Lead sem
   dono é problema de atribuição — transformá-lo em broadcast converte o buraco em ruído para todo
   mundo.

5. **Preferência corta entrega, nunca registro.** Som, toast e push são governados por preferências
   por usuário × organização; a linha é sempre gravada. Histórico com buracos torna "não recebi"
   indebugável.

6. **Ordenação por `last_event_at`.** Uma conversa que voltou a falar não pode ficar enterrada sob a
   ordem de criação.

## Consequences

- `notifications` ganha `group_key`, `event_count`, `last_event_at`, o índice único parcial e um
  índice de leitura `(user_id, organization_id, read_at, last_event_at DESC)`.
- Todo produtor passa a escrever por `INSERT … ON CONFLICT (user_id, group_key) WHERE read_at IS
  NULL DO UPDATE`. **O predicado tem que ser repetido no `ON CONFLICT`** — sem ele o Postgres não
  casa o árbitro e devolve `42P10`. Esse erro já apareceu neste repo noutro upsert.
- O `workflow_alert` existente muda de forma: hoje ele exige 3 falhas em 1h e suprime por
  organização inteira (dois workflows quebrados na mesma hora → o segundo nunca notifica). Com
  coalescing, a linha nasce na primeira falha e o limiar desaparece — o que sobra é uma regra de
  *escalonamento de entrega* (`event_count ≥ 3` ou causa bloqueante sobe para o canal quente), não
  de registro.
- A tabela passa a crescer com o uso (~9 mil linhas/dia somando as orgs). Exige limpeza semanal —
  lidas acima de 90 dias, não lidas acima de 180. Como `notifications` está publicada em
  `supabase_realtime`, o `DELETE` precisa rodar em lotes pequenos, ou a limpeza vira enxurrada de
  eventos de realtime.
- Notificação deixa de ser efêmera de tela e vira dado consultável: "quantos avisos por vendedor por
  dia" passa a ser uma pergunta respondível, e é a medida que diz se o recorte de ruído está certo.
