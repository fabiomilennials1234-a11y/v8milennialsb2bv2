Fecha o item 3 do handoff das #1862/#1867: **os outros `<Popover>` sem `modal`**.

O handoff dizia "varrer exige medição tela a tela e é ticket próprio". Esta é a varredura, medida.

## O defeito, em uma frase

Radix `Dialog`/`Sheet` montam um `react-remove-scroll` que engole o `wheel` de tudo fora do conteúdo do diálogo; um Radix `Popover` portaliza o conteúdo dele para o `body` — **para fora**. Sem `modal`, a lista dentro do popover não rola com a roda. E onde o painel vira folha no celular, o `z-50` do primitivo perde para o `z-[51]` do `SheetContent` e a lista **existe no DOM sem pintar**.

## O que foi medido

**54 `<Popover>` raiz no `src/`** — não 51, que foi minha primeira contagem: um grep por `<Popover[ >]` **perde a forma multi-linha** (`<Popover\n  open={...}`). Foram 3 perdidos, e um deles era defeito real.

Dos 54, 52 estavam sem `modal`. Cada um teve a cadeia de montagem subida **até um `<Route>` do `App.tsx`**, e todo veredito "quebrado" passou por um agente independente encarregado de **refutá-lo**.

| | |
|---|---|
| dentro de diálogo, com lista que transborda, alcançável | **5** ✅ consertados |
| dentro de diálogo, mas seletor de data | **6** ⏸️ deferidos, com motivo |
| cadeia fecha em diálogo **morto** | **6** ❌ descartados |
| soltos, ou conteúdo que cabe inteiro | **37** — sem defeito |

## Consertados (5)

Todos têm contêiner de rolagem real **e** fecham na escolha — que é a condição para `modal` não custar interatividade.

| arquivo | rota | o que rola | `z-[70]`? |
|---|---|---|---|
| `carteira/client/ClientChipSelector.tsx` | `/upsell` | a carteira inteira de clientes (`CommandList`, `max-h-[300px]`) | — |
| `pipelines/disparo/AudienceConditionsControls.tsx` | `/pipe-whatsapp` | `CommandList` | — |
| `leads/leads/LeadChecklistSection.tsx` | `/chat-whatsapp` | `max-h-40` | — |
| `leads/deal-card/DealCardChecklists.tsx` | `/leads` +4 | `max-h-56` | ✅ |
| `leads/lead-detail/modal/header/ResponsibleSlot.tsx` | `/leads` +4 | `max-h-60` | ✅ |
| `leads/lead-card/LeadCardEtiquetas.tsx` | `/leads` +4 | `max-h-52` do `SeletorDeEtiquetas` | ✅ |

`z-[70]` **só onde há `SheetContent` na cadeia viva** — os três de baixo descem pelo `DealCardPanel`, que é `Dialog` acima de 768px e `Sheet` abaixo.

🚨 O `ClientChipSelector` merece nota: ele fica no **mesmo `DialogContent`** onde o `ProductCombobox` já tinha `modal` desde a #1862 — lado a lado, um consertado e o outro não. É a terceira vez que a lista de telas cobertas sai errada por ser feita **pelo nome do componente** em vez do caminho de import resolvido.

## Deferidos, com motivo (6)

Os seis seletores de **data**: `CommitmentDateModal`, `AddMeetingModal`, `RescheduleModal`, `SetMeetingDateModal`, `ScheduleFollowUpModal`, `ScheduleMessageModal`.

Todos com a mesma forma — `<Popover>` **não controlado**, `<Calendar>` dentro, `onSelect={setX}`. **Escolher a data não fecha o popover.** Com `modal`, o Radix chama `hideOthers` e o resto do diálogo fica `aria-hidden` e inerte até alguém clicar fora.

Eu **liguei** `modal` nos seis primeiro, e foi o `test:ratchet` que me corrigiu: **8 testes de comportamento que já existiam caíram**, todos por não achar mais o botão de confirmar do diálogo enquanto o calendário estava aberto. E o benefício não está medido — grade de mês é altura fixa (~300px), não lista que cresce com o dado.

**Custo certo × benefício não medido → ficam sem `modal`.** O conserto que serve aqui é outro e é maior: tornar o popover controlado e fechar no `onSelect`. Está escrito no teste, não perdido.

## Descartados (6)

Todos com cadeia que fecha num `DialogContent`/`SheetContent` de verdade — e em **código que ninguém monta**. O caso dominante:

🚨 **O roteador `LeadDetailDialog` (V1/V2 do modal de lead) é órfão.** `grep -rn "<LeadDetailDialog\|<LeadDetailSheet" src --include=*.tsx` devolve o próprio roteador e dois arquivos de teste. As 5 telas vivas passam `panel={<><DealCardPanel /><LeadCardPanel /></>}` ao `LeadPanelLayout`. A flag `new_lead_modal_v2` nem chega a ser consultada.

Quatro "defeitos" caíram por isso, e **dois agentes deram um deles como real** por pararem no primeiro `DialogContent` em vez de subir até o `App.tsx`. É a armadilha central deste sweep e está registrada no teste.

## A guarda

`tests/unit/popover-em-dialogo-contract.test.ts` — 20 casos.

Não é um teste por componente: jsdom não tem layout nem rolagem, então "a lista rolou" é immensurável ali de qualquer jeito. O que faltava não era o observável — era **a lista**, e a garantia de que ela não encolhe sozinha. Então o arquivo trava as duas listas (consertados e deferidos) e tem um **ratchet no total de `<Popover>` do `src/`**: o próximo que alguém adicionar estoura o número, e a pergunta "ele é montado dentro de um Dialog/Sheet?" tem de ser respondida uma vez, por quem escreveu.

**18/18 mutantes mortos, nos dois sentidos:**

- tirar `modal` de qualquer um dos 8 consertados (inclui os 2 da #1862/#1867) → **vermelho**
- tirar `z-[70]` de qualquer um dos 4 → **vermelho**
- **pôr** `modal` em qualquer um dos 6 calendários deferidos → **vermelho**

O parser do teste também é medido: a primeira versão dele cortava a tag no primeiro `>`, e `onOpenChange={(v) => {` traz um `>` **dentro** da tag — ele declarou o `LeadCardEtiquetas` sem `modal` estando consertado. Agora só conta o `>` com as chaves fechadas.

## Portões

| | |
|---|---|
| `typecheck:ratchet` | **idêntico ao baseline limpo** — 14 erros dos dois lados, mesmo conjunto (`diff` vazio) |
| `lint:ratchet` | 0 introduzido |
| `test:ratchet` | **0 quebrado**; 1 instável (`Sidebar`, passa no retry) |
| `build` | ok |
| `lint:deps:check` | ok |
| `guard:master-ghost` | vermelho **igual** na árvore limpa — herdado |

## O que fica em aberto

1. **Os 6 calendários** — conserto real é fechar no `onSelect`. Ticket próprio.
2. **`LeadDetailDialog` V1/V2 órfão** — `LeadDetailSheet`, `LeadDetailProperties`, `LeadModalHeader`, `LeadTagsBar`, `LeadActionsBlock` e `AbrirConversaButton` (por esse caminho) não são alcançáveis. Antes de remover, ver a regra do `CLAUDE.md`: `git log --all --follow --diff-filter=A` para separar andaime de resíduo.
