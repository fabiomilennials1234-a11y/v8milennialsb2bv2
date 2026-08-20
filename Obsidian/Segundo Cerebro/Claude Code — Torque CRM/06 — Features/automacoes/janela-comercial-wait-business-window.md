# Nó `wait_business_window` — Janela Comercial

## O que é

Nó do DAG de automações que controla **quando** o fluxo segue, em função do
relógio e do dia da semana. Cada nó carrega até 6 janelas; cada janela tem nome,
dias, horário de início/fim e uma ação.

A semântica foi travada pelo CTO em 2026-08-19 e é a única leitura válida:

> **A janela desenhada é o horário em que a mensagem dispara.**

Dentro de uma janela de envio, o fluxo continua no mesmo tick. Fora de todas as
janelas, a execução dorme até a próxima janela de envio abrir.

## Como funciona

### Vocabulário gravado em `windows[].action`

O intérprete único é `supabase/functions/_shared/workflow-window-role.ts`
(`resolveWindowRole`). Nenhum outro ponto do executor lê `action` diretamente.

| Valor gravado | Papel | Comportamento |
|---|---|---|
| `pass` | `send` | Dentro dela o fluxo continua pela saída padrão |
| `route:<chave>` | `route` | Dentro dela o fluxo sai pela edge cujo `sourceHandle === <chave>` |
| `hold_until:` (alvo **vazio**) | `send` | **Legado.** Lido como janela de envio |
| `hold_until:<Nome>` (alvo **nomeado**) | `blackout` | **Legado.** Bloqueio: dorme durante ela |
| vazio / ausente / desconhecido | `send` | Nunca falha o nó |

O discriminador do legado é *"o alvo está preenchido?"*. A UI antiga oferecia
"Segurar até janela X" e nunca exigia o X — uma janela solitária com alvo vazio
só tem uma leitura sã: é a janela de trabalho. Alvo nomeado, por outro lado, é
bloqueio deliberado.

Desconhecido cai em `send` de propósito: um valor que ninguém sabe ler não pode
virar motivo para estrangular uma org.

### Escada de decisão quando a execução dorme

A ordem **é** o contrato:

1. Próxima abertura entre as janelas de papel `send`;
2. Se não existe nenhuma janela `send`, próxima abertura entre janelas de
   **qualquer** papel — um nó só de `route` é legítimo e não pode expirar;
3. Nada abre em 14 dias → `cancelled` com `error = "expired:no_send_window"`;
4. Resultado `<= agora` em qualquer ponto → `cancelled` com
   `error = "expired:window_resolution_loop"`.

O passo 4 é a guarda contra livelock. Ele roda **antes** do jitter, porque o
jitter é positivo e empurraria um resultado igual a "agora" para o futuro,
mascarando a contradição.

### Jitter de release

Toda escrita de hold recebe jitter determinístico (FNV-1a sobre o `executionId`,
nunca `Math.random()`), limitado a `min(30 min, duração da janela / 2)`.

Determinístico é requisito, não estética: a mesma execução, reavaliada, precisa
cair no mesmo minuto. Com aleatório, cada reavaliação sortearia de novo e a
execução andaria para frente indefinidamente em vez de convergir.

O caminho de envio imediato **não** recebe jitter.

### Guarda de resume vencido (24h)

Se `next_run_at` está mais de 24h no passado quando a execução é reclamada, o nó
expira **sem enviar**: `status = cancelled`, `error = "expired:stale_resume_24h"`,
`completed_at` preenchido, e **nenhum nó a jusante executa**.

Uma mensagem agendada para ontem e disparada hoje chega fora de contexto; o
custo de mandá-la (reputação do número, resposta confusa) supera o de não mandar.

## Regras de negócio

- Primeira janela que casar (ordem da lista) vence.
- `end <= start` significa que a janela cruza a meia-noite.
- O painel oferece apenas **"Enviar nesta janela"** e **"Desviar pela saída X"**.
  Nada novo nasce com `hold_until:`.
- Janela legada `hold_until:<Nome>` é renderizada **somente leitura**, com aviso
  e um botão explícito "Remover esta janela de bloqueio".
- 🔴 **O painel nunca reescreve janela que o usuário não tocou.** Converter no
  salvamento inverteria a intenção de quem desenhou um bloqueio: uma janela
  feita para NÃO enviar viraria janela de envio no primeiro save. A conversão é
  ato explícito do usuário, jamais efeito colateral.
- O campo `mode` (`hold|route|hybrid`) está `@deprecated`: sempre foi decorativo
  (o executor só o ecoava no step) e saiu da UI. Permanece no tipo para que
  definições antigas round-trippem intactas.
- Status terminal reusa `cancelled` — **não** existe status `expired`.
  `workflow_executions.status` é TEXT livre sem check constraint, e
  `STATUS_CONFIG` em `AutomacoesExecucoes.tsx` faz fallback para `running`: um
  status novo apareceria como "Executando" com spinner, eterno na tela. O motivo
  específico vai no prefixo de `error` (`expired:*`).

## Caminho legacy

Nó **sem** `windows[]` (só `days` com chaves PT + `startTime`/`endTime`) segue
por `getNextSendTime` de `_shared/followupSchedule.ts`, byte-idêntico ao que
sempre foi. 624 execuções da Goletric Perdizes dependiam disso em 2026-08-19 e
mantiveram seus `next_run_at`.

Desde 2026-08-19 o nó arrastado da paleta já **nasce** com `windows[]`
preenchido (`AutomacoesEditor.tsx`, `createDefaultNodeData`) — antes ele nascia
legado e caía nesse caminho até alguém abrir o painel.

## Edge cases

- Janela sem dias (`days: []`) nunca abre — é filtrada antes da varredura.
- Todas as janelas em blackout com uma ativa → `expired:window_resolution_loop`
  em vez de livelock.
- `route:` sem edge correspondente → `failed` com `completed_at` preenchido.
- `nextRunAt` ausente ou inválido não dispara a guarda de 24h.

## Áreas frágeis

🟠 Workflows + WhatsApp/Uazapi (mensagem enviada não volta) + multi-tenant.

O modo de falha histórico era assimétrico: um `return { success: false }` **sem
escrever linha terminal** deixava a execução em `processing` para sempre. Com
`per_org_cap = 5`, 77 zumbis consumiam todas as vagas por ciclo e matavam de
fome a org inteira. Hoje há duas defesas:

1. Todo `return { success:false }` do nó escreve linha terminal;
2. `process-workflow-executions` tem backstop guardado por
   `.eq("status","processing")` — pega qualquer `success:false` futuro, de
   qualquer nó, sem sobrescrever a linha mais rica do executor.

## Custo da varredura — não desfaça o cache de formatters

`getHourMinutesInTimezone` e `getDayKeyInTimezone` (`_shared/copilot/time-context.ts`)
guardam seus `Intl.DateTimeFormat` num cache por timezone. Isso **não é
microotimização**: são 3 formatters por sonda, dentro de um laço de até 20.160
sondas.

Medido (Node, mesmo V8 do Deno, 2026-08-19):

| cenário | sondas | sem cache | com cache |
|---|---|---|---|
| hop de fim de semana (sexta 20:00 → segunda 08:00) | 3.360 | 458 ms | 7,4 ms |
| varredura completa de 14 dias | 20.160 | 3.200 ms | 45 ms |

62× e 71×. O que torna isso crítico: `process-workflow-executions` processa
lote de 20 execuções por invocação. Sem o cache, um lote da Chique numa sexta à
noite custaria ~9 s de CPU **bloqueante** numa única invocação de edge function.
Se o isolate for morto pelo limitador antes de terminar o lote, as linhas
reclamadas ficam em `processing` — e **o backstop não salva, porque backstop é
JS e isolate morto não roda JS**. Ou seja: sem o cache, este módulo reintroduz a
exata classe de zumbi que ele existe para matar.

Os testes de jitter em `workflow-executor-branches.test.ts` rodam com o timeout
**default** de propósito: a duração deles é o gate de regressão dessa varredura.
Aumentar o timeout converte lentidão em silêncio.

## Instrumentação

O payload do step grava `insideWindow`, `activeWindow`, `action`, `nextRunAt`,
`roleResolved`, `jitterMs`, `scannedPool` e `windowOpensAt`. `jitterMs` existe
para medir depois se 30 min de espalhamento bastam — a constante é escolha de
projeto, não medida.

## Arquivos

- `supabase/functions/_shared/workflow-window-role.ts` — intérprete do vocabulário
- `supabase/functions/_shared/workflow-executor.ts` — case `wait_business_window`
- `supabase/functions/_shared/copilot/time-context.ts` — `computeNextSendWindowStart`, `windowSpanMinutes`
- `supabase/functions/process-workflow-executions/index.ts` — backstop de estado
- `src/modules/workflows/components/sidebar-panels/WaitBusinessWindowPanel.tsx`
- `src/modules/workflows/components/nodes/WaitBusinessWindowNode.tsx`
- `src/modules/workflows/pages/AutomacoesEditor.tsx` — semente do nó novo
- `tests/unit/window-role.test.ts` — tabela de compatibilidade
- `tests/unit/workflow-executor-branches.test.ts` — formas Chique/Bertin/Happyneis/Goletric

## Histórico

- 2026-08-19 — Semântica travada em "janela = horário de envio". `hold_until:`
  com alvo vazio passa a ser lido como envio; "Janela alvo" e "Modo" saem da UI.
  Guarda de resume vencido (24h), jitter determinístico de release, escrita
  terminal em todo caminho de falha e backstop de estado no worker.
  Supera a nota `reference_wait_business_window_hold_until_empty_bricks_workflow.md`:
  o "fix `action=pass`" registrado lá era contorno manual por workflow, não
  conserto — o código continuava capaz de produzir o mesmo zumbi.
