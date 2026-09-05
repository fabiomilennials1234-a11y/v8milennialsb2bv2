# Filtros de funil e etapa no gatilho Negócio Criado

Data: 2026-09-04  
Status: aprovado no grill com o CTO  
Issue: [#2001](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/2001)

## Pedido

Permitir que o gatilho `deal_created` restrinja a automação pelo funil e pela
etapa em que o Negócio nasceu.

## Modelo vigente

- O Negócio, nunca o Lead, ocupa uma etapa de um funil (ADR-0023).
- Existe um único tipo de funil; comportamento usa `pipelines.id`, nunca slug ou
  `pipelines.type` (ADR-0034).
- O Negócio nasce ao entrar no funil. Entrada no funil e nascimento são o mesmo
  fato de domínio (`CONTEXT.md`, verbete **Negócio**).
- A posição canônica vive em `pipeline_entries`: `pipeline_id`, `stage_id`,
  `deal_id`.

## Lacuna atual

O gatilho ainda nasce de `AFTER INSERT ON deals`. Nesse instante, as portas
canônicas criam primeiro `deals` e depois `pipeline_entries`, dentro da mesma
transação. Portanto o evento atual carrega identidade, valor, responsável e
procedência, mas não carrega a posição de nascimento.

Consultar `pipeline_entries` apenas quando o worker processar não preserva o
fato de nascimento: o Negócio pode ter mudado de etapa entre criação e execução.

## Evidência de produção

Leitura somente em produção em 2026-09-04:

- 39.414 Negócios vivos; 38.945 têm posição e 469 não têm;
- últimos 30 dias: 5.265 Negócios, 5.213 com posição e 52 sem posição;
- 140 posições foram ligadas depois do `INSERT deals`; atraso máximo 437 ms e
  percentil 95 de 61 ms;
- índice único parcial `uq_pipeline_entries_deal_id` garante no máximo uma
  posição por Negócio quando `deal_id` não é nulo;
- 2 workflows usam `deal_created`, 1 ativo; ambos têm `trigger_config = {}`;
- execuções históricas de `deal_created` carregaram zero `pipeline_id`, zero
  `stage_id`, zero `pipeline_entry_id` e zero `deal_id` nas colunas de sujeito.
- o único workflow ativo tem 4 execuções históricas e contém ações externas de
  WhatsApp e movimentação; sua organização produziu zero Negócios sem posição
  nos últimos 30 dias.

O dado confirma duas exigências: a captura precisa acontecer depois da ligação
da posição; config antiga vazia precisa continuar significando qualquer
Negócio.

## Decisões confirmadas

### D1 — filtro usa posição de nascimento congelada

Funil e etapa significam a posição em que o Negócio nasceu. Essa posição viaja
no contexto da execução e não é recalculada durante processamento.

Exemplo: Negócio nasce em `Oportunidades / Novo` e muda para `Abordado` antes do
worker. Um workflow filtrado por `Novo` continua elegível; um workflow filtrado
por `Abordado` não se torna elegível retroativamente.

Razões:

- coincide com o modelo de domínio: entrar no funil é nascer;
- produz resultado determinístico, independente da latência da fila;
- mantém auditoria explicável a partir do evento original;
- evita que uma movimentação posterior reescreva a causa da automação.

Alternativa rejeitada: consultar a posição corrente no worker. O resultado
dependeria do timing entre criação, movimentação e claim da execução.

### D2 — vários funis e várias etapas

Um gatilho pode selecionar vários funis e várias etapas. A regra é:

```text
(funil de nascimento pertence aos funis selecionados)
E
(etapa de nascimento pertence às etapas selecionadas)
```

Dentro de cada lista, a relação é `OU`. Os IDs de etapa são globais e cada etapa
pertence a um único funil, portanto a lista plana não cria ambiguidade entre
funis. A interface só oferece etapas dos funis selecionados e remove da config
as etapas de um funil quando ele é desmarcado.

Razões:

- cobre automações equivalentes em vários funis sem duplicar o DAG;
- reutiliza o modelo de seleção já entregue em `lead_replied`;
- continua compatível com um único destino, que é o caso mínimo.

Alternativa rejeitada: limitar cada workflow a um funil. A restrição simplifica
o seletor, mas força cópias do mesmo workflow e cria divergência operacional.

### D3 — etapa opcional

Os filtros têm três níveis progressivos:

1. sem funil selecionado: qualquer posição de nascimento;
2. com funis e sem etapas: qualquer etapa de nascimento dentro dos funis
   selecionados;
3. com funis e etapas: somente as etapas selecionadas.

Config vazia continua significando “qualquer Negócio”. Isso preserva os dois
workflows encontrados em produção, ambos salvos com `trigger_config = {}`.

Razões:

- permite filtrar apenas pelo funil;
- uma etapa nova do funil entra automaticamente quando o autor escolheu “qualquer
  etapa”;
- evita tornar uma configuração existente inválida.

Alternativa rejeitada: obrigar ao menos uma etapa quando houver funil. Isso
impediria o caso “qualquer Negócio que nascer neste funil” e exigiria manutenção
quando etapas fossem adicionadas.

### D4 — evento nasce no vínculo entre posição e Negócio

`deal_created` passa a ser emitido quando uma `pipeline_entries` recebe um
`deal_id`, seja no próprio `INSERT`, seja num `UPDATE` que ligue uma entrada já
existente ao Negócio. Nesse momento o contexto congela:

- `deal_id`;
- `pipeline_entry_id`;
- `pipeline_id`;
- `stage_id`;
- dados do Negócio usados pelos filtros existentes.

O trigger legado `AFTER INSERT ON deals` deixa de ser a fonte do evento. Uma
linha em `deals` sem posição vinculada não dispara `deal_created`: sob o modelo
vigente, ela ainda não completou o nascimento do Negócio.

Razões:

- a fonte técnica coincide com o fato de domínio;
- remove a corrida entre `INSERT deals` e criação/vínculo da entrada;
- fornece posição e sujeito no instante do evento;
- cobre as duas ordens de escrita existentes: entrada já nasce com `deal_id` ou
  recebe o vínculo depois;
- o índice único parcial em `pipeline_entries.deal_id` garante uma posição por
  Negócio.

Alternativa rejeitada: manter o trigger em `deals` e adiá-lo até o fim da
transação. Preservaria disparos para linhas sem posição, mas não cobriria uma
posição ligada em transação posterior e manteria duas definições concorrentes de
“nascimento”.

### D5 — etapas formam um filtro global

Config usa duas listas planas:

```ts
pipeline_ids: string[];
stage_ids: string[];
```

Sem `stage_ids`, qualquer etapa dos funis selecionados casa. Existindo ao menos
um `stage_id`, somente as etapas listadas casam. Portanto um funil selecionado
sem nenhuma de suas etapas na lista não produz match enquanto o filtro global de
etapas estiver ativo.

Exemplo: `Oportunidades` e `Orçamentos` selecionados, mas somente
`Oportunidades/Novo` em `stage_ids`. Apenas `Oportunidades/Novo` dispara;
`Orçamentos` não dispara em etapa alguma.

Essa semântica deve aparecer no resumo da interface para evitar que um funil sem
etapa selecionada pareça coberto.

Alternativa rejeitada: grupos de etapa por funil, em que lista vazia significaria
“qualquer etapa” apenas naquele funil. Mais expressiva, mas exigiria config
hierárquica e semântica diferente da escolhida.

### D6 — excluir etapa referenciada desativa o workflow

Ao excluir uma etapa, qualquer workflow que cite seu UUID em `trigger_config`
é desativado dentro da mesma operação. A prévia e a confirmação da exclusão
mostram quantas automações serão desligadas. O autor precisa revisar a config e
reativar conscientemente.

É o mesmo contrato já aplicado pela main quando um funil referenciado é
excluído.

Razões:

- impede que remover a última etapa transforme o filtro em “qualquer etapa”;
- impede workflow ativo com referência quebrada;
- torna a mudança de escopo visível e auditável.

Alternativas rejeitadas: remover o ID silenciosamente da config ou deixar a
referência quebrada dentro de um workflow aparentemente ativo.

### D7 — materialização e backfill não são nascimento operacional

O novo emissor ignora vínculos cujo Negócio tenha uma destas procedências:

- `entrada_materializada`;
- `backfill`;
- `backfill_funil_custom`.

Essas portas completam ou corrigem representação técnica de um card que já
existia. Não representam novo fato comercial e não podem iniciar ações externas.

Produção confirma o risco: 284 Negócios `entrada_materializada` nos últimos 30
dias; 276 estavam ligados a entradas com mais de um dia, e o caso mais antigo
tinha 153 dias. Disparar nesse vínculo transformaria manutenção de dados em
mensagem, tag ou movimentação retroativa.

Alternativa rejeitada: tratar todo primeiro vínculo de `deal_id` como criação.
Isso faria cards históricos parecerem Negócios recém-abertos.

### D8 — evento espera posição completa

O emissor só considera o nascimento concluído quando a entrada possui
simultaneamente `deal_id`, `pipeline_id` e `stage_id`. Se vínculo e etapa forem
gravados em momentos diferentes, o evento nasce na primeira transição em que os
três ficam presentes.

Produção ainda permite `pipeline_entries.stage_id IS NULL`: existem 35 Negócios
vivos nessa situação, mas nenhum foi criado por uma porta operacional nos
últimos 30 dias. São resíduos históricos; não justificam contexto novo
incompleto.

Razões:

- o modelo exige exatamente uma etapa por Negócio;
- D1 exige congelar uma etapa verdadeira no evento;
- evita diferença de comportamento entre filtros só de funil e filtros de
  etapa quando a posição está quebrada.

Alternativa rejeitada: disparar assim que `deal_id` existir, mesmo sem etapa.

### D9 — listas progressivas visíveis no editor

O painel mostra funis como checkboxes. A lista de etapas só aparece depois que
ao menos um funil é selecionado e agrupa etapas pelo nome do funil.

O contrato textual precisa deixar D5 explícita:

- “Nenhum funil marcado = qualquer funil”;
- “Nenhuma etapa marcada = qualquer etapa dos funis selecionados”;
- existindo etapas: “Somente as etapas marcadas disparam”.

Resumo persistente mostra, por exemplo, `2 funis · 3 etapas específicas`. O
controle segue o padrão visual já entregue em `Lead Respondeu`.

Produção justifica lista visível em vez de busca: mediana de 3 funis por org,
P95 de 6 e máximo de 10; mediana de 8 etapas por funil, P95 de 14 e máximo de
25.

Alternativa rejeitada: popovers com busca. Acrescentariam interação sem volume
que a justifique hoje.

### D10 — incompatibilidade não cria execução

O matcher SQL aplica os filtros antes do `INSERT workflow_executions`. Um
Negócio cuja posição de nascimento não casa não aparece como execução
“concluída/pulada”. O matcher TypeScript repete a mesma regra sobre o snapshot
persistido antes do primeiro nó.

Razões:

- não casar é comportamento normal do filtro, não uma execução;
- histórico permanece centrado no que realmente iniciou;
- evita crescimento proporcional a `Negócios × workflows candidatos`;
- dupla avaliação preserva defesa contra contexto ou config alterados entre
  emissão e processamento.

Alternativa rejeitada: criar uma execução terminal para cada recusa. Dá auditoria
individual, mas polui histórico e armazenamento com trabalho que nunca começou.

### D11 — preview integral, depois rollout único

Mudança passa primeiro por Supabase branch com migration e testes transacionais.
Após as provas, produção recebe uma única semântica global, sem feature flag por
organização.

Ordem de produção:

1. deploy de `process-workflow-executions` com matcher TypeScript novo;
2. aplicar migration que instala matcher SQL, novo emissor e proteção da
   exclusão de etapa;
3. smoke controlado com workflow sem ação externa;
4. publicar frontend por último.

Rollback pareado restaura o trigger antigo em `deals`, remove o emissor novo e
reverte as funções SQL alteradas. Nenhum smoke pode usar o único workflow ativo
de produção: seu DAG envia WhatsApp e movimenta Negócio.

Alternativa rejeitada: feature flag por organização. Criaria simultaneamente
dois significados para `deal_created` dentro do mesmo motor e manteria branches
temporários no trigger de banco.

## Contrato final de configuração

Campos novos em `TriggerConfigDealCreated`:

```ts
pipeline_ids?: string[];
stage_ids?: string[];
```

Campos existentes permanecem:

```ts
require_lead?: boolean;
source?: "any" | "human" | "workflow" | "api" | "import";
filter_owner_id?: string;
min_value?: number;
```

Todas as dimensões preenchidas combinam com `E`. Dentro de `pipeline_ids` e
`stage_ids`, os valores combinam com `OU`.

| Config | Resultado |
|---|---|
| `{}` | qualquer nascimento operacional com posição completa |
| `pipeline_ids: [A, B]` | qualquer etapa inicial em A ou B |
| `pipeline_ids: [A, B]`, `stage_ids: [A1, B2]` | A/A1 ou B/B2 |
| `pipeline_ids: [A, B]`, `stage_ids: [A1]` | somente A/A1 |
| filtro configurado + campo correspondente ausente no contexto | não casa |

Campo ausente ou lista vazia significa “sem filtro”. Valor presente com tipo
inválido não pode ser normalizado para vazio: config malformada falha fechada e
deve aparecer como inválida no editor.

## Emissão do evento

Uma função de trigger em `pipeline_entries` detecta a primeira transição de
posição incompleta para completa:

```text
NEW.deal_id     existe
NEW.pipeline_id existe
NEW.stage_id    existe
E
(INSERT completo OU OLD ainda não estava completo)
```

A função lê o `deals` da mesma organização, recusa linha ausente/excluída,
ignora as três procedências técnicas de D7 e chama `fire_workflow_trigger` com
o snapshot completo. Atualizações posteriores de etapa ou funil não emitem
`deal_created` novamente.

O contexto preserva os campos atuais e acrescenta:

```ts
{
  trigger: "deal_created",
  lead_id: string,
  deal_id: string,
  pipeline_entry_id: string,
  pipeline_id: string,
  stage_id: string,
  deal_title: string,
  deal_value: number,
  owner_id: string | null,
  deal_source: string,
  created_by_workflow: boolean,
  negocio_id: string,
  negocio_titulo: string,
  negocio_valor: number
}
```

`metadata.workflow_execution_id` continua alimentando
`triggered_by_execution_id` e `chain_depth`. Trocar a fonte não pode reabrir o
laço `create_deal → deal_created → create_deal`.

## Matching e persistência

`matches_workflow_trigger_config` e `matchesTriggerConfig` implementam a mesma
tabela-verdade. O matcher SQL decide se nasce execução; o matcher TypeScript
revalida o contexto congelado antes do primeiro nó.

`fire_workflow_trigger` persiste `pipeline_entry_id` e `deal_id` também nas
colunas de sujeito de `workflow_executions`. A chave de dedup inclui o sujeito
do Negócio, permitindo dois Negócios do mesmo Lead e colapsando eventos
concorrentes do mesmo Negócio.

## Exclusão de etapa

A exclusão/desativação deixa de ser uma sequência de writes no cliente. Uma RPC
transacional precisa:

1. validar organização, etapa e destino dos cards;
2. mover cards quando necessário;
3. desativar workflows ativos cujo `trigger_config` cite o UUID da etapa;
4. desativar a etapa;
5. devolver impacto, incluindo `automacoes_desativadas`.

O painel de exclusão mostra esse impacto antes da confirmação e o resultado
depois da operação.

## Interface

`DealCreatedConfig` reutiliza `useFunisDaOrg()` e `useAllPipelineStages()`.
Funis desativados só aparecem quando já salvos na configuração. Etapas exibidas
pertencem aos funis marcados; desmarcar funil remove suas etapas da config.

Ordem do painel:

1. somente Negócios com Lead;
2. procedência;
3. valor mínimo;
4. responsável;
5. funis de nascimento;
6. etapas de nascimento;
7. resumo da regra.

## Provas obrigatórias

### Banco, em Supabase branch

- `INSERT pipeline_entries` já completo emite uma vez;
- `UPDATE deal_id: null → uuid` em entrada com etapa emite uma vez;
- `UPDATE stage_id: null → uuid` em entrada com deal emite uma vez;
- movimentação posterior não emite novamente;
- materialização e dois backfills não emitem;
- config `{}` preserva workflow existente;
- funis e etapas aplicam `OU` interno e `E` entre dimensões;
- contexto e colunas de sujeito carregam IDs corretos;
- dois Negócios do mesmo Lead disparam separadamente;
- evento concorrente do mesmo Negócio deduplica;
- org cruzada e Negócio excluído falham fechados;
- exclusão de etapa move cards, desativa workflows afetados e devolve impacto;
- rollback restaura contrato anterior.

### TypeScript

- paridade da tabela-verdade do matcher;
- contexto ausente ou malformado falha fechado;
- filtros existentes de procedência, dono, valor e Lead não regressam;
- revalidação aceita exatamente o snapshot persistido.

### Interface

- config vazia mostra “qualquer funil”;
- seleção acumula vários funis;
- etapas só aparecem depois de funil;
- etapas ficam agrupadas pelo nome exibido pela organização;
- desmarcar funil limpa apenas suas etapas;
- estágio global segue D5;
- resumo distingue qualquer etapa de etapas específicas;
- funil inativo já salvo continua removível;
- exclusão de etapa informa e desativa automações afetadas.

## Arquivos esperados

- nova migration e rollback em `supabase/migrations/`;
- teste SQL em `supabase/tests/`;
- `supabase/functions/_shared/workflow-trigger.ts`;
- `supabase/functions/process-workflow-executions/index.ts`, apenas se o contrato
  de persistência exigir ajuste;
- `src/types/workflow.ts`;
- `src/modules/workflows/components/sidebar-panels/TriggerPanel.tsx`;
- teste colocalizado de `TriggerPanel`;
- hook/painel de exclusão de etapa em `src/modules/pipelines/`;
- documentação da feature `automacoes/negocio-criado.md`.

## Fora de escopo

- disparar por posição atual;
- disparar ao mover Negócio já existente para outro funil;
- criar novo tipo de funil ou depender de slug;
- reescrever histórico das execuções antigas;
- adicionar procedências sem escritor real no banco.

## Invariantes herdadas

- A execução declara `pipeline_entry_id` como chave do sujeito e também carrega
  `deal_id` (ADR-0031).
- Deduplicação de gatilho de funil é por Negócio, não apenas por Lead; dois
  Negócios do mesmo Lead podem disparar independentemente.
