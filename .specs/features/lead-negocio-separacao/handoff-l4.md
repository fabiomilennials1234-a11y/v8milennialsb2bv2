# Handoff — aba de Leads (L4), fatia 2 lead-negócio

Cole isto num contexto limpo. Escrito em 2026-08-04.

---

Você está retomando o **L4 da fatia 2** (separação Lead ↔ Negócio) no Torque CRM.

O motor da fatia está **pronto e mergeado em `develop`** (PR #1366). O que sobrou é a aba de Leads: duas correções entregues, **uma correção pendente** e **um desenho pendente**.

## Onde o trabalho está

Branch **`feat/aba-leads-l4`**, cortada de `origin/develop`, dois commits, **sem PR aberta ainda**:

- `1769d010` — o cluster "Dados" saiu da lista e foi para o drawer
- `ef67fa3b` — os stat cards do topo passaram a contar a org, não a página

As decisões que governam isso estão em **`docs/adr/0024-leads-page-surface.md`** (PR #1404 → develop, só documento). Leia esse ADR antes de tocar em qualquer coisa — ele traz o número de produção que sustenta cada escolha.

## O que falta

### 1. Ordenação por clique no cabeçalho da lista

Hoje a ordem é fixa por criação, sem UI. A decisão (ADR-0024 §2, segunda metade) é: **a ordenação entra no cabeçalho da coluna**, não num menu à parte.

⚠️ **Isto é delicado, não difícil.** Toca `src/modules/leads/hooks/useLeads.ts`, que o `src/modules/leads/CLAUDE.md` marca como **área frágil**: 975 linhas, paginação infinita, filtros multifacetados e realtime com debounce de 2s, com aviso explícito de *"NÃO refatorar sem slice dedicada"*. A ordem tem de entrar na `queryKey` junto com os filtros — errar ali quebra a paginação de um jeito que só aparece na página 3.

O cabeçalho vive em `LeadListHeader`, em `src/modules/leads/components/leads/LeadListRow.tsx`. As colunas hoje: Nome · Contatos · Tags · Negócios · Dono da conta · Data de criação.

### 2. O desenho de Relação + Situação

É o que a **ADR-0023 §6** pede e ainda não existe na tela. O CTO quer **aprovar o desenho antes de você construir** — traga proposta, não implementação.

- **Relação**: `Lead` / `Cliente` — já comprou alguma vez; monotônico.
- **Situação**: `Em negociação` (mostrando a etapa do negócio aberto mais avançado) / `Sem negócio aberto`.
- **As duas lado a lado, nunca colapsadas numa só.** Medido: 26.982 leads têm um negócio, **4.380 têm vários todos abertos**, **170 têm um ganho e um aberto ao mesmo tempo**. Qualquer status de valor único esconderia metade da verdade exatamente nos 170 casos que a feature existe para representar — o cliente que voltou e está sendo trabalhado de novo é `Cliente · Em negociação`.
- O orçamento de espaço são os **290px** que a saída do cluster "Dados" liberou.

## Coisas que vão te fazer perder tempo se você não souber

**O `CLAUDE.md` da raiz pode estar desatualizado sobre deploy.** A versão correta está em `origin/main` e diz: **merge em `main` DEPLOYA o front sozinho** (webhook `push` do EasyPanel, medido em 2026-08-02 — PR mergeada 23:05:53, imagem construída 23:07:55). Cópias antigas afirmam o contrário. Merge em `develop` **não** deploya: o workflow `Build Image` roda só em `push: branches: [main]`.

**A CI está vermelha na `main` e na `develop`.** O job `Tests` roda `npm run test:unit` cru contra ~157 testes de dívida herdada, sem ratchet. **Check vermelho numa PR não é sinal.** Os gates que valem são locais e medem delta: `npm run typecheck:ratchet`, `npm run lint:ratchet`, `npm run build`, e `test:unit` comparado por **conjunto de arquivos que falha**, não por contagem — receita na memória `reference_test_unit_inherited_failures_baseline`.

**`npm run lint` cru não serve** — sai 0 e imprime ~29 mil warnings. Use o ratchet.

**Validação de banco é branch efêmera de prod**, nunca Docker, nunca o projeto dev (aposentado). Runbook: `.specs/project/runbook-validacao-local.md`. Custa US$ 0,01344/h — **encerre no mesmo dia**, e ao encerrar derrube também a porta 8080: `TaskStop` num `npm run dev` mata o shell pai e deixa o `vite` filho vivo.

## O que é botão do humano, não seu

Nada disso está aplicado em produção, e a ordem não é preferência:

1. `scripts/m6-limpeza-cross-org.sql` — limpar os responsáveis cross-org (14 pares, backup automático).
2. Só então acender o M6. ⚠️ Ele cria gatilho `UPDATE OF … claimed_by`, e `leads.claimed_by` **não existe em prod** — quem cria é `20270730000020`, também pendente. Aplicar o M6 avulso falha.
3. Backfill org a org (`scripts/backfill-lead-negocio-m4.mjs`), Milennials primeiro. **Basic4u aborta** até alguém reconciliar 1 card.
4. Depois do apply em prod: regenerar `types.ts` e remover as pontes `as never`.

Também do humano: patchar os **5 nós n8n** de ingest + disparar o aviso operacional (`aviso-operacional-milennials.md`) **no mesmo dia** — sozinho, qualquer um dos dois vira chamado de "sumiu lead".

🔴 E há uma **service_role key de produção em texto plano** num nó do n8n (`bUHokUwk8Brv4xNo`, "Mover → agendado"). Chave que ignora RLS no banco inteiro, não só na org da piloto. Herdada, não tocada, e não melhora sozinha.

## Decisões ainda abertas

- **Passo 5c** — mover negócio para funil **customizado**. Atravessa de `pipeline_entries` para `custom_pipe_entries`, que são espelho por primary key e nunca trocam de `pipeline_id`: obriga delete+insert, e o card perde o id junto com a âncora de histórico. A função `mover_negocio` **recusa** esse destino de propósito, em vez de resolver errado.
- **Fusão de identidade com a Carteira** (ADR-0023 §8) — a outra metade da aba de Leads, não decidida.

## Como o CTO trabalha

Ele decide, você executa. Quer o número medido, não a suposição — se um documento afirma algo, confirme contra produção antes de agir, porque neste repo doc desatualizado já custou meses. Diga o que está quebrado mesmo quando não foi pedido, e não feche escopo sozinho: se algo é decisão dele, pare e pergunte com a evidência na mão.
