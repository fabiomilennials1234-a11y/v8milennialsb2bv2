# Gatilho "Lead Respondeu" — funil, etapa e número de origem

Data: 2026-09-03
Branch: `feat/lead-respondeu-gatilho` (de `origin/main` @ `53f6dda8`)
Status: desenho aprovado pelo CTO, pronto para plano de implementação

## O pedido

Reagir à resposta de um lead com uma automação, restringindo por onde o lead
está (funil e etapa) e **por qual número nosso ele respondeu** — para que, numa
org com dois WhatsApp falando com a mesma pessoa, só o número escolhido conte.

## O que já existe (medido em `origin/main` e em PROD, 2026-09-03)

O gatilho **não é novo**. `lead_replied` existe como `WorkflowTriggerType`, tem
painel, matcher e teste. Isto é elevação do que existe, não construção nova.

Já pronto e **fora do escopo desta fatia**:

- **Disparo antes dos gates de IA.** O `fireTrigger` roda no passo 0.97 do
  `agent-message`, acima dos gates de Copilot. Foi movido para lá justamente
  porque, embaixo deles, o gatilho era inalcançável: PROD 2026-08-11 media
  ZERO workflows e ZERO execuções em toda a história.
- **Filtro por funil.** `pipeline_ids: uuid[]`, multi-seleção, semântica OR,
  vazio = qualquer funil, fail-closed quando a leitura falha, e a query de
  funis do lead só é paga quando algum workflow candidato usa o filtro.
- **Um campo cobre funil padrão e custom.** `pipelines` é a união dos dois
  (PROD: 379 = 294 system + 85 custom, mesmo uuid espelhado). A distinção
  "padrão vs custom" não existe mais na UI nem no dado.
- **Segundo ponto de disparo:** `notificame-webhook` (canal social/oficial).

Estado em PROD: **2 workflows `lead_replied`, 0 ativos**. Não há base instalada
para regredir — este é o momento barato de mudar o comportamento do gatilho.

## O que falta, e é este trabalho

1. **Filtro por etapa.** Hoje só funil.
2. **Filtro por número/instância de origem.** Hoje só `channel`
   (`any|whatsapp|meta`), que não distingue o número do SDR do número do Closer.
3. **Definição de "responder" configurável** + freio contra rajada.

## Decisões

### D1 — Funil e etapa são FILTRO DE ESTADO, não matrícula

O workflow não passa a "pertencer" à etapa. Funil e etapa são condições
avaliadas no instante da resposta. Nada de tabela de vínculo.

### D2 — Etapa é filtro puro; a execução não se amarra ao Negócio

Sob o ADR-0023 quem ocupa etapa é o **Negócio**, não o Lead, e um Lead pode ter
vários. Medido em PROD: 36.899 leads têm 1 card, mas **5.187 (12%) têm 2+**, e
5.165 destes em mais de um funil.

Escolhido: basta o lead ter **algum** card numa das etapas marcadas. **Uma
execução por resposta**, independente de quantos cards casaram. Os nós que
movem card seguem resolvendo como já resolvem hoje — não são tocados.

Rejeitado: carregar o `deal_id` que casou no contexto (mais correto no modelo
novo, mas dobra o custo de dedup e, na variante que dispara por Negócio, faz o
lead receber duas automações por uma resposta).

### D3 — Origem: contrato genérico, um ramo implementado

Config nasce como `source_type` + `source_ids[]`. A v1 implementa apenas
`whatsapp_instance`. O ramo `messaging_channel` (Instagram, WhatsApp oficial)
entra depois como aditivo — sem migração de tipo, sem tocar o matcher.

Justificativa da ordem: o caso descrito vive inteiro no WhatsApp Uazapi (PROD:
152 instâncias em 62 orgs, ~8.600 inbound/dia; **19 orgs têm 2+ números**),
enquanto a caixa unificada tem 2 canais em 2 orgs.

### D4 — Três modos de resposta, `any` por padrão

| Modo | Dispara quando |
|---|---|
| `any` (padrão) | qualquer mensagem do lead |
| `after_outbound` | só se enviamos algo antes, dentro de `reply_window_hours` |
| `first_of_thread` | só na primeira mensagem após `new_thread_after_hours` de silêncio |

`cooldown_minutes` (padrão **60**) vale nos três, por lead e por workflow.

### D5 — Propagar a instância pelo cano existente (não mover o disparo)

O `whatsapp-webhook` conhece `instance_id`, mas o payload que manda ao
`agent-message` não o carrega — e é dentro do `agent-message` que o
`fireTrigger` roda. A identidade do número se perde uma camada antes de onde o
filtro precisa dela.

Escolhido: **acrescentar `instance_id` ao payload** (campo aditivo).

Rejeitado nesta fatia: mover o disparo para o `whatsapp-webhook`. Seria
arquiteturalmente melhor ("o lead respondeu" é fato do inbound, não da IA) e
alcançaria 99 orgs em vez de 60, mas encosta em área 🔴 crítica e exige
transplantar a garantia de disparo único, que hoje mora num lock do
`agent-message`. Fica registrado como dívida, não como esquecimento.

## Config final

`⬜` já existe em main · `🟩` novo

```
⬜ channel                "any" | "whatsapp" | "meta"
⬜ pipeline_ids           uuid[]  — funis, OR, vazio = qualquer
⬜ contains_text          string

🟩 stage_ids              uuid[]  — etapas, OR, vazio = qualquer etapa
🟩 source_type            "whatsapp_instance"
🟩 source_ids             uuid[]  — instâncias, OR, vazio = qualquer
🟩 reply_mode             "any" | "after_outbound" | "first_of_thread"
🟩 reply_window_hours     number  — só em after_outbound
🟩 new_thread_after_hours number  — só em first_of_thread
🟩 cooldown_minutes       number  — padrão 60
```

**Regras de casamento** (mesma convenção do filtro de funil que já existe):

- Lista vazia = "qualquer". Nunca "nenhum".
- Dentro de uma lista, OR. Entre listas, AND.
- **Fail-closed** em todo filtro que dependa de leitura: se a consulta de
  funis/etapas falhar, não dispara.
- **Instância ausente também é fail-closed.** Se o workflow filtra por
  instância e o evento chegou sem ela, não dispara. Sem isso o filtro de número
  viraria "qualquer número" em silêncio no caminho do `notificame-webhook`.
- `stage_id` é a chave da etapa. PROD: `stage_key` cobre 100% das 48.171
  entradas, `stage_id` tem 41 buracos (0,08%) — essas linhas não casam filtro
  nenhum, por fail-closed. uuid é inequívoco entre funis; `stage_key` é texto
  com escopo por funil.
- Número desconhecido **não vira lead**. Já é a regra em main
  (`findLeadByPhoneOrEmail`, resolve-only) e continua: primeiro contato é
  `lead_created`, não "respondeu".
- Mensagem de grupo não conta como resposta.

## Caminho do dado

```
Uazapi → whatsapp-webhook            persiste msg, conhece instance_id
           │  🟩 + instance_id no payload (aditivo)
           ▼
        agent-message (passo 0.97, antes dos gates de IA)
           │  guarda hasActiveWorkflowsForTrigger → sem workflow, sai numa query
           │  resolve lead por telefone (nunca cria)
           ▼
        fireTrigger(lead_replied, context:{channel, message, 🟩 instance_id})
           │  🟩 carrega sob demanda: funis + etapas do lead
           │  🟩 carrega sob demanda: evidência do modo
           ▼
        matchesTriggerConfig → workflow_executions
```

### Três armadilhas do código existente que o desenho respeita

1. **Tudo que o matcher lê tem que ir para o `context` persistido.** O
   `process-workflow-executions` relê o contexto gravado e roda
   `matchesTriggerConfig` **de novo** antes de executar. O filtro de funil já
   caiu nisso: sem os funis no contexto, o fail-closed reprova tudo e o filtro
   vira no-op em 100% dos casos (`"Skipped: trigger conditions not met"`).
   Etapas, instância e evidência de modo entram no contexto pelo mesmo motivo.

2. **Nada disso entra na chave de dedup.** A chave usa o `context` cru, não o
   enriquecido — funis e etapas do lead mudam com o tempo e tornariam a chave
   instável. A chave sai byte-a-byte igual à de hoje.

3. **O cooldown reusa mecanismo existente.** O índice único parcial
   `(workflow_id, lead_id, trigger_dedup_key)` com chave balde-por-janela já
   entrega "só o primeiro insert vence" sob concorrência. Cooldown de 60 min é
   a mesma janela com outro número (hoje: 60s geral, 300s para `stage_changed`).
   **Ressalva:** balde tem efeito de borda — 10h59 e 11h01 caem em baldes
   diferentes e as duas passam. Teto: uma execução extra, só na virada.
   Cooldown exato exigiria uma query por mensagem; recusado.

## Arquivos

| Arquivo | O quê |
|---|---|
| `src/types/workflow.ts` | 7 campos em `TriggerConfigLeadReplied` |
| `_shared/workflow-trigger.ts` | matcher + carga de etapas + evidência de modo + janela |
| `whatsapp-webhook/index.ts` | `instance_id` no payload — aditivo, não toca resolução de instância |
| `agent-message/index.ts` | recebe `instance_id`, repassa no `context` |
| `notificame-webhook/index.ts` | passa a mandar `context` (hoje vazio — conserta o filtro de canal, que passa sempre) |
| `TriggerPanel.tsx` → `LeadRepliedConfig` | etapas, instâncias, modo, cooldown |
| `tests/unit/workflow-trigger-shared.test.ts` | casos do matcher |

Reuso de UI, sem componente novo: `useAllPipelineStages()` para as etapas,
`useWhatsAppInstances()` para os números.

## Tela

Divulgação progressiva — nada aparece antes de fazer sentido:

- Bloco "De onde" só aparece com **2+ instâncias**: 43 das 62 orgs têm um número
  só e não devem ver uma escolha que não existe.
- Lista de etapas só existe depois de um funil marcado.
- Funil desativado que ainda esteja salvo no filtro continua visível — é o
  comportamento de main, e existe para que desmarcar seja possível.

## Custo por mensagem recebida

Zero para quem não tem workflow do tipo (sai na guarda indexada). Para quem
tem: uma query de funis+etapas do lead, e só se algum workflow candidato usar
esses filtros. `after_outbound` acrescenta uma segunda query, só para quem
escolher esse modo.

## Prova

**Sem banco** (`vitest`): matcher em `workflow-trigger-shared.test.ts` — cada
filtro isolado, cada combinação AND/OR, e os fail-closed (leitura falhou,
instância ausente, `stage_id` nulo). Mais o contract test do
`whatsapp-webhook`, para provar que o campo aditivo não mexeu na resolução de
instância.

**Com banco** — a revalidação do contexto no `process-workflow-executions`,
exatamente onde o filtro de funil já quebrou uma vez. Não roda local (Docker e
Supabase local são proibidos). Ao chegar nesse ponto: **parar e pedir uma
branch do Supabase**, dizendo o que será rodado lá e por quê.

## Fora de escopo, de propósito

- Ramo `messaging_channel` do filtro de origem.
- Amarrar a execução ao Negócio que casou.
- Cooldown exato (fica o balde, com a borda declarada).

## Limitações herdadas — não introduzidas aqui, não consertadas aqui

1. **Workflow com nó de Copilot nunca dispara por este gatilho.** É o *origin
   guard*, que evita laço IA↔automação. Consequência: "lead respondeu → agente
   de IA responde" **não é construível** com este trigger.
2. **39 das 99 orgs seguem fora de alcance**, presas num gate de plano que
   exige a feature `copilot` mesmo para quem só tem `automations`. Subir o
   disparo acima desse gate passaria na frente do lock de dedup e perderia a
   garantia de disparo único. O conserto certo é gatear por `automations`.
