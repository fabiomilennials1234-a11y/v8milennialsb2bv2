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

⚠️ **Pré-requisito de L2 descoberto junto**: o passo 5 de L2 acende o gatilho que zera `leads.pipe_whatsapp`. Fora do Copilot ainda existem **cinco leitores** dessa coluna, todos no BC de workflows, e todos passam a ler vazio no mesmo instante: `_shared/workflow-executor.ts:1005`, `_shared/workflow-action-handler.ts:72,89`, `_shared/workflow-condition-evaluator.ts:25,69` e `_shared/action-handlers/whatsapp-helpers.ts:324,340`. Os três primeiros preenchem a variável de template `{estagio}` — a mensagem sai com o campo em branco; o evaluator é pior: condição de automação que compara etapa passa a nunca casar. Repontar **antes** do passo 5, não depois.

🔴 **Segurança, achado ao abrir os nós (herdado, nada mexido):** o nó `Mover → agendado` carrega a **service_role key do projeto de produção** em texto plano nos headers, em `apikey` e `Authorization` — chave que ignora RLS no banco inteiro, não só na Milennials. Os quatro nós de ingest carregam a anon key mais um `x-webhook-key` de segredo compartilhado, curto e adivinhável (o valor não vai para este documento de propósito — está nos nós). Rotacionar é decisão do CTO e quebra os fluxos vivos no ato: não fiz.

---

## L2 — banco

Ordem interna obrigatória, cada passo depende do anterior.

1. **Limpar os responsáveis cross-org** (zerar, com backup antes). **Antes** de acender a trava — com ela no ar, os 1.091 cards ficam imóveis. Script executável: `scripts/m6-limpeza-cross-org.sql` (backup em tabela + guarda que recusa rodar com a trava já acesa + verificação que desfaz a transação se sobrar sujeira). O rascunho que vivia no fim do `m6-inventario.sql` terminava em `...`, não rodava, e cobria 5 das 9 colunas.

   ⚠️ **O inventário cresceu de 9 para 14 pares** (medido em prod 2026-08-03). A varredura "genérica" do catálogo exigia `organization_id` na própria tabela, e **oito tabelas referenciam `team_members` sem ter essa coluna** — a org vem do pai. Duas delas estão sujas e eram invisíveis: `campanha_leads` (**503 linhas × 4 colunas**, 79% da tabela) e `campanha_members` (1). Ambas as varreduras agora rodam no inventário e na verificação da limpeza.

   Predicados conferidos contra prod, um a um, e batem exato: leads 1.594 · pipeline_entries 1.091 · custom_pipe_entries 1.091 · campanha_leads 503 · campanha_members 1. `webhooks` ativos = 0, então a limpeza não dispara entrega.
2. **Acender o M6** (`20270731000010`, já escrita e provada).

   ⚠️ **Dependência de ordem descoberta agora:** o M6 cria `CREATE TRIGGER ... UPDATE OF ... claimed_by` em `leads`, e **`leads.claimed_by` não existe em prod** — quem a cria é `20270730000020_leads_claim.sql`, que também ainda não foi aplicada. Aplicar o M6 sozinho falha. Por timestamp a ordem já sai certa num `db push` sequencial, mas isso é coincidência de numeração, não garantia: aplicar migration avulsa aqui quebra.
3. **Apagar `/negocios`** — 8 arquivos, ~1.485 linhas, mais 3 edições que saem juntas (rota em `App.tsx`, `feature-registry:101` e `:195`; remover só uma quebra).
4. **`DROP COLUMN deals.pipeline_id, deals.stage_id`** (M3b). Só depois do passo 3 — são os únicos leitores no repo.
5. **Migration nova: mover em vez de duplicar.** O `compareceu` passa a `UPDATE pipeline_entries SET pipeline_id, stage_key` em vez de inserir em Orçamentos. Cuidado nomeado: o `DELETE` de `pipeline_entries` dispara o gatilho que zera `leads.pipe_whatsapp` — com o `UPDATE` esse caminho não é usado, e é mais um motivo para mover a linha em vez de recriá-la.
6. **Índice único em `pipeline_entries.deal_id`** — a garantia de "um negócio, uma posição". Criar **depois** do backfill de L3, senão ele recusa o estado intermediário.
7. **Título derivado** no caminho de criação (decisão 9).

---

## L3 — backfill, org a org

**Antes de rodar, revisar o M4** contra as decisões 9 e 11:

- fundir os cards de funis de sistema do mesmo lead num negócio só, posicionado no mais avançado — **597 leads, 926 negócios a menos** que a versão atual;
- cada funil customizado continua sendo um negócio à parte;
- título `Negócio de <mês>/<ano>` a partir de `created_at`, no lugar do nome do funil;
- as guardas atuais continuam valendo e a prova de 1:1 vira prova de 1:1 **por jornada** — a guarda precisa ser reescrita junto, senão ela aborta o comportamento novo.

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
