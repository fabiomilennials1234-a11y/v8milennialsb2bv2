# Protótipo — aba de Funis do Torque

Modelo 1 ("uma linha só") + a proposta de nivelar capacidade entre todos os funis.

```
node serve.mjs      →  http://localhost:8901
```

Sem dependência, sem build. Node 18+.

---

## O que dá pra clicar

| Ação | O que acontece |
|---|---|
| **Clicar no nome do funil** | Abre a lista, agrupada em Estruturais / Customizados / Com prazo. Você **escolhe** qual ver — não troca sozinho ao clicar |
| **Buscar** | Filtra por nome, empresa e telefone. Ignora acento (`acos` acha "Aços Piraí") e casa dígito de telefone (`9455`) |
| **Filtros** | **Criados no período** (atalhos de 7/30/90 dias e Este mês, ou data a data), **Parado há** (faixas de dias na etapa), Origem, Responsável, Calor e Tags. O contador no botão mostra quantos grupos estão ativos, e os filtros viram chips com × logo abaixo da barra |
| **Views** | No topo, o alternador **Kanban / Lista / Analytics**. Abaixo, aplica ou salva uma visualização de filtros; dá pra excluir passando o mouse na linha |
| **Arrastar um card** | Move entre etapas. Começa depois de 8px de movimento, igual ao dnd-kit do Torque. A contagem das duas colunas se ajusta e aparece um aviso embaixo. Funciona com filtro ativo |
| **Clicar num card** | Abre a ficha do lead — o modal do sistema (`LeadDetailDialogV2`), não um layout inventado |
| **Caixa no canto do card** | Seleciona. Aparece no hover; com algo já selecionado fica visível em todos. `Shift` + clique pega o intervalo dentro da coluna; `Ctrl/⌘ + A` pega tudo que está visível |
| **Barra de baixo** (com algo selecionado) | Contagem + soma em R$, e **Mover para · Responsável · Tags · Disparo · Exportar · Remover**. Responsável e Tags são liga/desliga: o menu fica aberto e marca o que já vale pra seleção inteira |
| **`…` no card** | Abrir ficha, WhatsApp, follow-up, **Mover para**, **Responsável**, **Tags**, selecionar, exportar só esse, remover do funil |
| **`…` na coluna** | Selecionar todos, **Ordenar por** (manual / valor / calor / parado / nome), mover a coluna inteira, **exportar a etapa em CSV**, editar etapas, criar etapa ao lado |
| **Clicar numa etapa da trilha** | Move o lead por dentro da ficha; se for o funil aberto, o board acompanha |
| **Clicar numa pill** (Valor, Orçamento, Reunião…) | Abre o painel de edição embaixo, como o `ActionPanel` do sistema faz hoje |
| **"editar itens"** no Orçamento | Adiciona e remove produto de verdade. O campo de nome puxa do catálogo e preenche tipo e preço sozinho; o total recalcula |
| **"definir" / "editar"** em Valor, Reunião, Compromisso, Notas | Editam de verdade e o card reflete na hora |
| **Configurações → Etapas** | Renomeia, recolore, reordena, cria e exclui etapa. O board redesenha enquanto você digita |
| **Configurações → Recursos** | Liga/desliga capacidade por funil, e escolhe o que resume no card |
| **Mexer num toggle** | O board redesenha na hora — dá pra ver o card ganhando e perdendo informação |
| `Tab` + `Enter` | O card e a linha da Lista são focáveis pelo teclado e abrem a ficha |
| `Esc` | Fecha o que estiver aberto, na ordem: menu → popover → modal → seleção |

### Os dois filtros de tempo

São coisas diferentes e independentes, de propósito:

- **Criados no período** — data a data, sobre a data de criação do lead. É o que o `MetricsPeriodSelector` fazia no cabeçalho antigo; aqui ele voltou pra dentro de Filtros, que é onde compõe com o resto. Inclusivo nas duas pontas, e clicar de novo no atalho que já está valendo desliga. Nada de data futura.
- **Parado há** — quantos dias o lead está na etapa atual, em faixas (até 2 · 3–7 · 8–14 · 15–30 · mais de 30). É a pergunta operacional de verdade: "quem está encalhado?".

Um lead criado em maio pode ter se mexido ontem — por isso os dois filtros existem separados e podem ser combinados. As duas visualizações salvas de exemplo (**Esquecidos (15+ dias)** e **Entraram em julho**) demonstram cada um.

### As três visões

**Kanban** é o que já estava. As outras duas vivem no topo do menu **Views**:

- **Lista** — a única visão do mobile hoje. Uma linha por negócio com etapa, responsáveis, origem, calor, valor, tempo parado e tags; **qualquer coluna ordena** (clicar de novo inverte). Marca todos pela caixa do cabeçalho. Rodapé com contagem e soma.
- **Analytics** — cinco números no topo (negócios, valor em aberto, ticket médio, parados 8+ dias, sem responsável), distribuição por etapa e quebra por origem e por responsável. Respeita os filtros ativos.

Os filtros, a busca e a seleção **atravessam as três visões**: filtrar no Kanban e trocar pra Lista mostra o mesmo recorte.

### Exportar

Sai CSV de verdade (o navegador baixa o arquivo), em três lugares: a etapa inteira pelo `…` da coluna, a seleção pela barra de baixo, e um lead só pelo `…` do card. Separador `;` e BOM UTF-8 — é o que faz o Excel em pt-BR abrir já colunado e com acento certo, sem passar pelo assistente de importação. Com filtro ativo, exporta **só o que passa no filtro**, e o menu avisa isso.

### A ficha é o modal do sistema

Estrutura copiada do `LeadDetailDialogV2` (a flag `new_lead_modal_v2` está ligada em **93/93 orgs**, então é o que roda pra todo mundo):

- **Sem abas no desktop** — grid 7/5. Esquerda: `CrossPipePanel` + coluna de Info. Direita: Checklist + Histórico & comentários.
- **Header**: avatar 56px com anel, nome, empresa · telefone · idade; slots **Pré-Venda / Venda** e **Pré-Qualificação / Qualificação** (Diamante/Ouro/Prata/Bronze/Desqualificado); barra de tags com "+ Tag".
- **Toolbar**: WhatsApp, Ligar, Email, Follow-up, chave IA, kebab.
- **Info**: "Informações do lead" (só preenchidos) · "Campos personalizados" · "Faltam informações (N)" ou "Lead completo" · "Tracking" (origem + UTMs).
- **Direita**: Checklist com `{feitos}/{total}` e barra; comentários com @menção e "⌘/Ctrl + Enter para publicar"; feed filtrável por Todos/Comentários/Manual/Copilot/Automação/Sistema/Pipeline.

**Onde entra a nossa mudança:** nas *action pills*. Hoje o sistema tem **duas, fixas** — "Reunião" (só em `pipe_confirmacao`) e "Orçamento" (só em `pipe_propostas`). Aqui elas viram **os recursos que cada funil ligou**, na mesma mecânica de pill → painel. É a menor mudança possível que atende o pedido: nenhum componente novo, o `ActionPill`/`ActionPanel` só deixa de ter a lista fixa.

O funil **Qualificação** (o que abre por padrão) sai com **tudo ligado**, de propósito: abrindo qualquer lead você vê a linha completa — `Valor · Orçamento · Reunião · Notas · Motivo de perda · Compromisso` — que é justamente o que a proposta defende. O contraste (funil que **não pode** ter isso) é demonstrado pelo **Giro de carteira**, onde a trava do banco aparece. Dá pra desligar qualquer um em Configurações → Recursos e ver o card e a ficha encolherem na hora.

### Como o orçamento soma

`unit` é sempre **preço unitário**; a linha é `unit × qtd`. O **recorrente não entra no total** — somá-lo exigiria supor um prazo de contrato, e essa premissa não existe no Torque. Ele aparece ao lado (`recorrente R$ 1.200/mês`), como o produto já separa Rec. de Unit/Proj. Onde há orçamento, o **Valor do negócio é derivado** do total, pra não existirem dois números se contradizendo na mesma tela.

**Teste que vale a pena:** troque para **Giro de carteira** e abra Configurações. Quase tudo aparece travado — é a limitação real do banco, não escolha de design. Depois abra o card do **Ricardo Menezes** (primeiro da coluna Novo): ele está em 3 funis, e o terceiro trilho mostra o mesmo bloqueio.

---

## Onde isso bate no código real

Cores, raios, nomes de etapa e microcopy vieram de `v8milennialsb2bv2`:

- Paleta e raio — `src/index.css` (`.dark`), `tailwind.config.ts`
- Nomes de etapa — `src/contracts/pipe/pipe-defaults.ts`
- Faixa de controles — substitui o cabeçalho de `src/modules/pipelines/pages/PipeWhatsapp.tsx:552-660`
- Recursos por funil — hoje é a constante `VARIANT_CONFIG` em `src/modules/leads/components/leads/LeadCard.tsx`
- Ficha do lead — hoje é `LeadDetailDialog` V2 (`new_lead_modal_v2`, ligada em 93/93 orgs) com `CrossPipePanel`
- Etapas — `pipeline_stages` (sistema) e `custom_pipeline_stages` (custom); `sla_hours` e `max_days_in_stage` só existem na primeira

O logo é o arquivo real do produto — `src/assets/torque-icon.png` e `torque-logo.png`, copiados pra cá. O wordmark aparece no hover com a mesma mecânica do `TopNavigation.tsx` (gira 360° e ganha brilho dourado).

O que **não** é fiel: a fonte. O produto usa Inter; aqui roda a pilha do sistema (Segoe UI no Windows).

---

## O que está travado de verdade

Levantado lendo `origin/main`, não suposição.

**1. `custom_pipe_entries` não tem `metadata jsonb`.**
Quase toda capacidade avançada — valor, reunião, Meet, status de confirmação, motivo de perda, MRR — mora em `pipeline_entries.metadata`. Funis custom e com prazo usam outra tabela, que não tem esse campo. Sem migration, esses funis não guardam nada disso. Duas saídas: adicionar a coluna (barato, dobra a bifurcação) ou fundir `custom_pipe_entries` em `pipeline_entries` (caro, acaba com ela).

**2. Orçamento em funil custom é impossível hoje, não só escondido.**
`pipe_proposta_items.pipe_proposta_id` é FK para `pipeline_entries(id)`. Entrada de funil custom vive noutra tabela, com outro espaço de ids. Exige a fusão acima ou coluna polimórfica + reescrita de 2 policies de RLS.

**3. Receita só é contada em Propostas.**
~15 RPCs somam `pipe_propostas.sale_value` com `status='vendido'`. Valor lançado em qualquer outro funil **não aparece em nenhum dashboard**. Pior: `lead_excluded_from_metrics()` já exclui de propósito o lead que só vive em funil custom, nas orgs com a flag `exclude_custom_pipe_leads_from_metrics` (HGE é uma). Ligar valor em funil custom sem revisar isso produz "vendi R$ 40k e o painel mostra zero".

**4. Agenda e alertas leem só `pipe_confirmacao`.**
`get_agenda_events` (Source 4) e `AlertsDropdown` fazem `FROM public.pipe_confirmacao`. Isso já é um buraco provado: reunião marcada no funil mergeado de Oportunidades **não aparece na Agenda**. Ligar reunião em 6 tipos de funil sem tocar nisso reproduz o buraco 6 vezes.

**5. Duas tabelas de etapa.**
`pipeline_stages` é chaveada por `(organization_id, pipeline_type)` — não tem `pipeline_id`. `custom_pipeline_stages` é por `pipeline_id`. Toda feature de etapa é escrita duas vezes, e SLA/aging existe só na primeira.

---

## O que já está pronto e só falta ligar

- `flattenMetadata` (`usePipelineEntries.ts`) **já** expõe `meeting_date`, `meet_link` e `is_confirmed` para todos os slugs
- `pipe_proposta_items` **já** aceita entrada de `whatsapp` — orçamento fora de Propostas funciona no banco hoje, falta UI
- A edge function `google-calendar-events` **já** recebe `pipe_slug` e `pipe_stage_key` — Meet em qualquer funil é passar dois strings
- Os `show*` do card já são props sobrescritas em produção (`CustomPipelineKanban.tsx:213`)
- Comentários, checklists, timeline, tags, campos personalizados e follow-up **já** são por-lead e aparecem em qualquer funil — custo zero

O precedente é o ADR-0004 (funil mergeado "Oportunidades"). Vale ler antes: fundiu **2** tipos de funil, para **1** org, em ~7 semanas, e deixou 11 lacunas abertas. O pedido aqui é o mesmo movimento para 6 tipos, com o obstáculo extra da tabela sem `metadata`.

---

---

## Decisões que este protótipo tomou (e que ainda podem mudar)

1. **O alternador de visão vive no topo do menu Views.** O Modelo 1 tirou o alternador Kanban/Lista/Analytics da faixa, e isso deixaria a visão Lista — a única do mobile — inalcançável no desktop. Botá-lo dentro do Views mantém o cabeçalho numa linha só e devolve a Lista. A alternativa era um segundo controle na faixa, que é justamente o que o Modelo 1 removeu.
2. **A soma por coluna não voltou pro board.** Ela aparece na Lista (rodapé), no Analytics (por etapa) e na barra de seleção. No Torque a soma hoje só existe em Propostas e **soma errado acima de 20 cards**, porque soma a página carregada, não a etapa. Repetir isso em 6 colunas multiplicaria o erro por 6.
3. **O Disparo continua fora do cabeçalho**, mas existe na barra de ação em massa — que é onde "disparar pra estes N" faz sentido. Ainda em aberto se some do cabeçalho de vez.
4. **Excluir etapa com negócio dentro é recusado**, com aviso de quantos mover antes. Não inventa destino nem apaga em silêncio.

## Estado

Protótipo. **Nada foi escrito no Torque** — nem código, nem migration, nem branch. Etapas, toggles, tags, responsáveis e movimentações valem só na aba do navegador e somem no refresh.

Verificado por Playwright headless (Edge do repo): 3 visões, ordenação, seleção com shift e Ctrl+A, os três menus com submenu, CSV baixado e conferido, aba Etapas (renomear/reordenar/criar/excluir e a recusa com leads dentro), mais regressão de arrasto, busca, filtros e ficha. Sem erro de console, sem SVG estourado e sem rolagem horizontal da página em 900, 1024, 1280 e 1600px.

Depois disso passou por uma revisão adversarial em 5 frentes (estado/índices, ciclo de vida dos menus, as visões novas, CSV + Etapas, layout), cada uma com um cético tentando derrubar os achados: **28 achados brutos → 14 sobreviveram → 12 corrigidos**. Cada um foi *reproduzido* antes de consertar. Os que mais apareciam na tela:

- o menu flutuante saltava pro canto superior esquerdo ao marcar uma tag (medir `getBoundingClientRect()` de um nó que o repinte já tinha destruído devolve zeros);
- o cabeçalho da Lista nunca grudava (`overflow: hidden` no pai vira container de rolagem e mata o `sticky` do filho — `overflow: clip` recorta igual sem criar container);
- a barra de ação em massa tapava o "+ Novo negócio" de 3 das 6 colunas (`.col-f` é **irmão** do `.col-body`, então dar padding ao corpo que rola não movia o rodapé);
- teclado não conseguia marcar card nem abrir o menu de ações;
- excluir etapa em funil sem board passava por cima da recusa e deixava a trilha da ficha órfã;
- a marca de ordenação migrava pra outra coluna ao reordenar etapas.
