# Plano de execução — fatia 2

**Data:** 2026-08-01 · **Decisões:** [ADR-0023](../../../docs/adr/0023-negocio-is-the-funnel-unit.md) · **Glossário:** `CONTEXT.md` (Lead, Negócio, Pipeline, Relação, Situação, Carteira)

Este documento é **ordem de execução**. O *porquê* de cada decisão está no ADR e não se repete aqui; o *o quê* do produto está no `spec.md` ao lado.

---

## O que a sessão de grilling mudou no plano anterior

Onze decisões, das quais **quatro alteram trabalho já escrito**:

| | Decisão | Efeito no que já existe |
|---|---|---|
| 4 | Negócio **move**, não duplica | trabalho novo: o `compareceu` deixa de criar entry em Orçamentos e passa a mover |
| 5 | Posição no card + índice único por negócio | destrava o M3b, que dependia de decisão sobre `/negocios` |
| 9 | Título derivado `Negócio de mês/ano` | **muda o M4** — hoje ele herda o nome do funil |
| 11 | Um negócio por **jornada**, no ponto mais avançado | **muda o M4** — hoje é um por card; são 926 negócios de diferença |

O restante confirma ou fecha o que já estava previsto.

---

## Escopo desta fatia (decisão 9 da sessão)

**Dentro:** o modelo inteiro + a aba de Leads + a fusão de **identidade** com a Carteira + piloto Milennials no ar.

**Fora, para a fatia 3:** o "Assumir" · o celular · a **funcionalidade** de Carteira migrando de casa · `DROP COLUMN leads.pipe_whatsapp` · "venda ganha → cliente de carteira" (feature nova, não conserto).

**Fora por redundância:** o lembrete D-5/D-3/D-1. Medido morto — nunca disparou para ninguém — e já aposentado por outra decisão: as 6 etapas de lembrete estão sendo dobradas em Meeting Confirmation Status, e o herdeiro já tem nome no glossário (`Follow-up Situation → meeting reminder`).

---

## L0 — feito e provado (3 commits, nada pushado)

| Commit | O quê | Estado |
|---|---|---|
| `e3d20145` | 26 leitores do par (funil, lead) toleram N negócios; Copilot/workflow incluídos | pronto, gates verdes |
| `ce1775c7` | M6 — trava de responsável cross-org (8 colunas, provada em 6 casos) | escrita, **não acesa** |
| `c296455b` | M4 — backfill, provado por contrafactual em branch efêmera | **precisa de revisão** (decisões 9 e 11) |

---

## L1 — primeira leva de produção: frontend e integrações

**Nada de banco nesta leva.** Se o schema for primeiro, a entrada por formulário quebra em silêncio e 45.678 pares duplicados ficam a um clique de merge.

1. **Push + PR** dos três commits de L0 (o M4 e o M6 são arquivos, não `apply` — entram sem tocar o banco).
2. **Copilot repontado** (decisão 10): ✅ **feito**. Seis arquivos do BC deixaram de ler `leads.pipe_whatsapp` e passaram a ler a posição do Negócio via `getPipeEntry(..., "whatsapp")` — `decide-action.ts`, `build-prompt.ts`, `copilot/context-loader.ts` (roteamento **e** `loadLeadData`), `copilot/agent-router.ts`, `copilot/lead-profile-builder.ts`, `process-copilot-followups`. A coluna saiu dos `SELECT` para que ninguém caia nela sem perceber; sobrevive no banco como espelho legado. Achado do caminho: sem negócio, `enqueuePipelineStageUpdate` enfileirava `update_pipeline_stage`, e o executor faz `upsertPipeEntry`, **que INSERE a entry quando não existe** — o agente criava o Negócio, contra a decisão 3. Agora sai sem enfileirar.
3. **Nós n8n de ingest** deixam de posicionar o Lead em funil (decisão 3). ⚠️ **Corrigido pela medição de 2026-08-03 — a versão anterior deste item estava errada em número e em tabela.** Não são dois nós, e nenhum escreve em `custom_pipe_entries`:

   | Workflow (n8n) | Nó | Estado | O que faz |
   |---|---|---|---|
   | `ceVGTTgVH4vnf5u8` Lead Form → CRM | Enviar pro CRM | ativo | `place_in_pipe: {whatsapp, novo}` no `lead-webhook` |
   | `KdzbN6NBqkWVDdKt` LP VSL A → CRM | Enviar pro CRM | ativo | idem |
   | `nUPBNVNIz1vxCUzR` LP Nicolodi → CRM | Enviar pro CRM | ativo | idem |
   | `6QL9uRtbe88k1fII` LP Acelerar → CRM | Enviar pro CRM | **inativo** | idem — armadilha armada, patchar junto |
   | `bUHokUwk8Brv4xNo` Sweep Reunião → Agendado | Mover → agendado | ativo | `PATCH` direto em `pipeline_entries` a cada 3 min |

   Os quatro primeiros **criam** o Negócio a partir do ingest — remover `place_in_pipe` resolve. O quinto **move** um Negócio de fora do app; ele não viola a decisão 3 (não cria), mas escreve na posição sem passar por nenhuma guarda do produto, e é o candidato natural a virar automação de dentro.
4. **Aviso operacional** para a Milennials sobre o dia da virada. Sem código.

**Saída de L1:** produção tolerante a N negócios, agente lendo da fonte certa, ingest sem escrever em funil. Nada mudou para o usuário.

⚠️ **Pré-requisito de L2, e ele piorou depois de medido.** Fora do Copilot existem **cinco leitores** de `leads.pipe_whatsapp`, em 4 arquivos do BC de workflows: `_shared/workflow-executor.ts:1005`, `_shared/workflow-action-handler.ts:72,89`, `_shared/workflow-condition-evaluator.ts:25,69` e `_shared/action-handlers/whatsapp-helpers.ts:324,340`.

A versão anterior desta nota dizia que eles "passam a ler vazio". **Errado** — pelo achado do passo 5, a coluna congela em vez de zerar. Então: `{estagio}` não sai em branco, sai com a etapa velha; e a condição de automação que compara etapa não deixa de casar, passa a casar **sempre**, contra um estado que não existe mais. Isso é envio errado, não envio faltando. Repontar **antes** do passo 5.

Boa notícia da medição: o repoint é mais barato do que o plano supunha. `evaluateCondition` **já é `async` e já recebe `supabase`**, e os quatro call sites já têm o org id em mãos (`lead.organization_id` no mesmo SELECT, ou `organizationId` no escopo). **Nenhuma assinatura precisa mudar.**

🔴 **Segurança, achado ao abrir os nós (herdado, nada mexido):** o nó `Mover → agendado` carrega a **service_role key do projeto de produção** em texto plano nos headers, em `apikey` e `Authorization` — chave que ignora RLS no banco inteiro, não só na Milennials. Os quatro nós de ingest carregam a anon key mais um `x-webhook-key` de segredo compartilhado, curto e adivinhável (o valor não vai para este documento de propósito — está nos nós). Rotacionar é decisão do CTO e quebra os fluxos vivos no ato: não fiz.

---

## L2 — banco

Ordem interna obrigatória, cada passo depende do anterior.

1. **Limpar os responsáveis cross-org** (zerar, com backup antes). **Antes** de acender a trava — com ela no ar, os 1.091 cards ficam imóveis. Script executável: `scripts/m6-limpeza-cross-org.sql` (backup em tabela + guarda que recusa rodar com a trava já acesa + verificação que desfaz a transação se sobrar sujeira). O rascunho que vivia no fim do `m6-inventario.sql` terminava em `...`, não rodava, e cobria 5 das 9 colunas.

   ⚠️ **O inventário cresceu de 9 para 14 pares** (medido em prod 2026-08-03). A varredura "genérica" do catálogo exigia `organization_id` na própria tabela, e **oito tabelas referenciam `team_members` sem ter essa coluna** — a org vem do pai. Duas delas estão sujas e eram invisíveis: `campanha_leads` (**503 linhas × 4 colunas**, 79% da tabela) e `campanha_members` (1). Ambas as varreduras agora rodam no inventário e na verificação da limpeza.

   Predicados conferidos contra prod, um a um, e batem exato: leads 1.594 · pipeline_entries 1.091 · custom_pipe_entries 1.091 · campanha_leads 503 · campanha_members 1. `webhooks` ativos = 0, então a limpeza não dispara entrega.
2. **Acender o M6** (`20270731000010`, já escrita e provada).

   ⚠️ **Dependência de ordem descoberta agora:** o M6 cria `CREATE TRIGGER ... UPDATE OF ... claimed_by` em `leads`, e **`leads.claimed_by` não existe em prod** — quem a cria é `20270730000020_leads_claim.sql`, que também ainda não foi aplicada. Aplicar o M6 sozinho falha. Por timestamp a ordem já sai certa num `db push` sequencial, mas isso é coincidência de numeração, não garantia: aplicar migration avulsa aqui quebra.
3. **Apagar `/negocios`** — 8 arquivos, **1.485 linhas cravadas** (conferido com `wc -l`), todos provadamente exclusivos. Mas são **5 sítios de edição em 4 arquivos**, não 3 — e os dois que faltavam quebram o **build**, não um teste:
   - `App.tsx:70` — o `const Negocios = lazy(...)`. Apagar o arquivo e deixar a linha = import de módulo inexistente.
   - `carteira/index.ts:150-177` — o bloco "Hooks — Deal (legado)" do barril público. Deixar o bloco com os hooks apagados quebra todo consumidor de `@/modules/carteira`. (Zero consumidores usam símbolo Deal hoje.)
   - Mais `App.tsx:524-533` (rota), `feature-registry:195` (ROUTE_FEATURE_MAP) e `:101` (FEATURES).
   - Extras não listados: `TopNavigation.tsx:233` (`"/negocios": "deals.view"` — chave morta, aparece **1 vez em todo o repo**, sem enforcement server-side) e o `| "deals"` do union em `feature-registry:24`.
   - Correção ao plano: remover **só** `feature-registry:101` passa nos testes. O acoplamento duro é rota ↔ `:195`. O gate é `tests/unit/route-feature-map.test.ts`, que lê `App.tsx` como texto — nenhum teste precisa ser apagado.
   - Medido ao vivo: 96 orgs, gate aberto em 89 (bate com o ADR ao dígito); as 7 fechadas são todas de teste/free — **100% das orgs reais alcançam a rota por URL**.
4. **`DROP COLUMN deals.pipeline_id, deals.stage_id`** (M3b). Só depois do passo 3. Dependentes no banco: `idx_deals_pipeline`, `idx_deals_stage` e a FK `deals_stage_id_fkey` — os três caem sozinhos, **sem `CASCADE`** (`pipeline_id` nunca teve FK). Zero leitores em edge functions, testes, views, RPCs ou triggers.

   ⚠️ Correção: o ADR dizia que `/negocios` é o único leitor dessas colunas. Na letra é falso — `/negocios` **nunca lê `pipeline_id`** (só `stage_id`, e o **escreve** em `Negocios.tsx:144`), e quem lê `pipeline_id` é `carteira/hooks/useDeals.ts:104`. No efeito se sustenta: esse hook só tem um importador, que é a própria página, e morre no passo 3.
5. **Migration nova: mover em vez de duplicar.** Hoje a ponte é **100% frontend + configuração** — nenhum trigger de banco e nenhuma edge function a implementam. A config vive em `pipeline_stages` (`is_final_positive` + `target_pipe_type='propostas'` + `target_stage_key='marcar_compromisso'`), semeada por padrão em toda org nova; **quatro telas** leem essa config e chamam `useCreatePipeProposta`, que termina num `INSERT` cru em `pipeline_entries`. A linha de origem nunca é tocada — é daí que nasce o gêmeo.

   🔴 **O cuidado nomeado estava invertido.** O plano dizia: "o `DELETE` dispara o gatilho que zera `leads.pipe_whatsapp`; com o `UPDATE` esse caminho não é usado". A primeira metade é verdade, a conclusão não. `sync_pipeline_entry_to_lead_pipe_whatsapp` resolve o slug por `NEW.pipeline_id` no UPDATE: movendo para Orçamentos o slug deixa de ser `whatsapp` e a função **não escreve nada**. A coluna não fica vazia — **congela no último valor, para sempre**.

   Consequência: **esta migration precisa zerar a coluna ela mesma** ao tirar a linha do funil WhatsApp. E o pré-requisito abaixo muda de natureza — os leitores não passam a ler vazio, passam a ler errado em silêncio.
6. **Índice único em `pipeline_entries.deal_id`** — ✅ **escrito** (`20270803000030`). A garantia de "um negócio, uma posição".

   ⚠️ Correção: o plano dizia "criar **depois** do backfill de L3, senão ele recusa o estado intermediário". Isso valia enquanto o backfill fundia jornadas. Com a decisão 11 revertida — um negócio por card —, dois cards nunca apontam para o mesmo negócio e não existe estado intermediário a recusar. O índice é **parcial** (`WHERE deal_id IS NOT NULL`), então nasce vazio sobre as 38.156 entries de hoje e passa a proteger cada org conforme o backfill roda. Chegar antes é melhor que chegar depois. Provado em branch: aceito sobre estado já backfillado, e recusou (`unique_violation`) a tentativa de pôr dois cards no mesmo negócio.
7. **Título derivado** no caminho de criação (decisão 9). A coluna é `deals.title` — `text NOT NULL`, **obrigatória no Insert**; `pipeline_entries` não tem coluna de título nenhuma.

   🔴 **Achado que muda o passo: depois do passo 3 não sobra caminho de criação.** Existe hoje exatamente **um** `INSERT` real em `deals` no repo — `carteira/hooks/useDeals.ts:236` — e ele morre junto com `/negocios`. A "porta única de criação" da UI (`NewDealDialog` + `CrossPipePanel`) **não cria linha em `deals`**: cria card nas views legadas, e o título que o usuário vê é derivado **na leitura** (`useLeadsDeals.ts:180` → `LeadListRow.tsx:281`) a partir do nome do funil — exatamente o que a decisão 9 rejeita. Nenhum trigger cria negócio: os três triggers de `deals` são todos de UPDATE.

   Ou seja, o passo 7 não é "trocar o default de um campo": é **escrever a porta de criação que a decisão 3 pressupõe** ("negócio nasce só por clique humano") e que ainda não existe. O backfill M4 (`scripts/backfill-lead-negocio-m4.sql:172`) grava `p.name`, o nome do funil, e precisa da mesma correção.

---

## L3 — backfill, org a org

**M4 revisado (2026-08-03)** — ✅ feito:

- título `Negócio de <mês>/<ano>` a partir de `created_at`, no fuso da org, no lugar do nome do funil (decisão 9);
- **um negócio por card**, e não por jornada. ⚠️ **A decisão 11 foi revertida pelo CTO**, e a medição do dia é o motivo: dos **801 leads** com mais de um card de sistema (933 cards a mais), **795 envolvem a Qualificação** — o par Oportunidades+Orçamentos, que era a premissa da decisão, são **6 leads**. Fundir apagaria 933 cards que, na maioria, não são gêmeos de uma venda só. Um lead pode ter mais de um negócio ao mesmo tempo (decisão 2) — é o motivo da fatia existir. Detalhe no ADR-0023 §11;
- a prova de 1:1 continua sendo 1:1 por card, como estava;
- cada funil customizado continua sendo um negócio à parte.

**Ordem de execução:** Milennials primeiro (2.358 cards, 914 custom, 86 ganhos, 0 órfãos, pré-condição limpa). Depois as demais.

⚠️ **Basic4u aborta** até alguém reconciliar 1 card (`dd91cd35…`, fonte no funil custom "Reativação", espelho em `propostas/vendido`). É a única org bloqueada; a guarda 0b para antes de escrever.

---

## L4 — a aba de Leads (maior peça, e a única sem projeto visual)

O grilling deu a ela a **primeira especificação funcional real**:

- **Relação** (`Lead` / `Cliente`) e **Situação** (`Em negociação` + etapa do mais avançado / `Sem negócio aberto`), lado a lado, nunca colapsadas.
- **A lista de negócios do lead**, com título, valor, etapa e estado — é onde a recompra fica visível.
- **Identidade de Carteira**: o cliente aparece na mesma lista, com Relação `Cliente`, sem segunda tela de gente.

**Ainda falta decidir para poder desenhar** (não bloqueia L1–L3):

1. **Destino do cluster "Dados"** — 290px, a coluna mais larga, **vazia em 97,8% dos leads**. Sair para o drawer, colapsar quando vazio, ou ficar só nas ~12 orgs com ERP.
2. **Ordenação e os stat cards** — hoje a ordem é fixa por criação, sem UI, e 3 dos 4 cards do topo contam a página, não a org, ao lado de um total global.
3. **Permissão de abrir negócio** — todo mundo, só admin, ou só quem atende. A separação cria um lugar novo onde a pergunta importa.

---

## Fatia 3 (registrado para não se perder)

Assumir (depende do apply em prod para os tipos existirem) · celular (hoje a entrega da fatia 1 não existe abaixo de 768px) · funcionalidade de Carteira migrando para a aba Leads · `DROP COLUMN leads.pipe_whatsapp` · venda ganha → cliente de carteira.

---

## Riscos com nome

| Risco | Estado |
|---|---|
| Ordem invertida do deploy | mitigado por L1 → L2 → L3, escrito acima e no ADR |
| Voltar atrás deixa de ser limpo assim que o piloto usar | sem plano. Reversível **enquanto ninguém criar negócio novo**; depois, desfazer é perder trabalho de gente |
| Fronteira com o outro dev (redesenho de funis) | sem acordo escrito. Os dois trabalhos tocam as mesmas 4 páginas |
| QA logado com admin / membro / master | nunca exercitado com gente dentro — e a correção de RLS de `deals` é exatamente sobre isso |
| 6 dos 8 fluxos n8n da piloto | não abertos. Dois foram auditados e quebram |
