# Backfill dos pedidos de Carteira (#1202) — provas locais

**NÃO EXECUTADO EM PRODUÇÃO.** Construído e provado no stack local. Escrever
270 linhas de dinheiro no livro-razão é decisão do CTO, igual foi no #1209.

Gerado em 2026-07-22.

---

## 1. Alvo declarado ANTES de rodar

Projeção read-only sobre produção, já com a decisão do CTO aplicada (emitir
tudo menos o pedido de valor idêntico, `f6d01a1d…`, Basic4u, R$ 638,40).

| | Hoje | Alvo depois |
|---|---:|---:|
| Linhas vivas | 205 | **475** |
| Receita viva | R$ 751.020,71 | **R$ 1.587.172,15** |
| Etiquetadas `carteira` | 0 | **55** (R$ 447.641,37) |
| Não-atribuído | R$ 58.713,90 | **R$ 762.115,57** |

Entram **270** pedidos, R$ 836.151,44.

> **Correção de um número meu.** O relatório da #1200 declarou o não-atribuído
> consolidado como R$ 761.294,49. O correto é **R$ 762.115,57** — erro de soma
> meu, R$ 821,08. Os números por organização estavam certos; o consolidado não.
> Registrado aqui porque é o alvo contra o qual o pós-backfill será conferido, e
> conferir contra número errado é pior que não conferir.

**Critério de aborto: se a receita depois não bater com R$ 1.587.172,15, não
sobe.**

## 2. A cascata provada — e por que o ensaio não serve para conferir rótulo

Fixture local desenhada para exercitar os três casos: um cliente com 3 compras em
datas distintas, um cliente com 2 compras **no mesmo instante** (empate), um
cliente com 1 compra, e um pedido a excluir.

| Execução | Avaliados | Emitidos | Excluídos | `carteira` | `novo_negocio` |
|---|---:|---:|---:|---:|---:|
| **Ensaio** (`dry_run`) | 7 | 6 | 1 | **0** | 6 |
| **Real** | 7 | 6 | 1 | **2** | 4 |

O ensaio diz 0 `carteira`; a execução real diz 2. **É o fenômeno 1-vs-55 da
#1200 reproduzido em miniatura**: sem as inserções anteriores no livro, a
cascata não acontece e todo pedido parece primeira compra.

Consequência prática: **o ensaio serve para conferir volume e exclusões, nunca
distribuição de rótulo.** Está escrito no corpo da função para que ninguém
interprete o ensaio como previsão do resultado.

### 2.1 Rótulo linha a linha

| Pedido | Data | Etiqueta | Por quê |
|---|---|---|---|
| P1 | 2026-01-10 | `novo_negocio` | 1ª compra do cliente |
| P4 | 2026-02-01 | `novo_negocio` | **empate** com P5 — empate não conta como anterior (#1198) |
| P5 | 2026-02-01 | `novo_negocio` | **empate** com P4 |
| P2 | 2026-03-10 | `carteira` | tem P1 antes |
| P6 | 2026-04-01 | `novo_negocio` | única compra do cliente |
| P3 | 2026-05-10 | `carteira` | tem P1 e P2 antes |
| P7 | — | *não emitido* | na lista de exclusão |

O par empatado sair como duas primeiras compras é o comportamento decidido, não
um efeito colateral: duas vendas no mesmo instante não podem ser recompra uma da
outra. Em produção isso vale para **131 pedidos (48% do conjunto)**.

## 3. Idempotência

| Execução | Emitidos | Já existiam |
|---|---:|---:|
| 1ª | 6 | 0 |
| 2ª | **0** | 6 |

Rodar duas vezes produz o mesmo que rodar uma. É a chave de idempotência da
#1199 trabalhando — a função não tem lógica própria de deduplicação, ela apenas
não consegue duplicar.

## 4. Comissão: zero, e o guard morde

| Verificação | Resultado |
|---|---|
| Comissões projetadas por linha de backfill | **0** |
| Tentativa direta de inserir comissão sobre linha de Carteira | **bloqueada** |

Mensagem do guard, literal:

> `comissão bloqueada para produtor "carteira" (#1201): a decisão de desde quando
> e para quem Carteira gera comissão é do CTO, em fatia própria`

Duas camadas: o guard por produtor (#1201) e `source='backfill'`, que não
dispara a projeção (que roda `WHEN source='trigger'`).

## 5. Reversão — testada ANTES, não depois

Sequência executada, nesta ordem:

1. **Rollback rodado com o livro limpo** → removeu 0. Prova que a função existe
   e é segura antes de qualquer escrita.
2. Impressão digital **antes**.
3. Backfill.
4. Impressão digital **depois**.
5. Rollback.
6. Impressão digital **de volta**.

| Momento | Linhas | Vendas | Bruto | Impressão digital |
|---|---:|---:|---:|---|
| Antes | 33 | 30 | 258.871,95 | `f78a9e788b4c5a806905936db2127873` |
| Depois do backfill | 39 | 36 | 279.871,95 | `33f5d14f27551e0acbbe872885833f7a` |
| **Depois da reversão** | **33** | **30** | **258.871,95** | **`f78a9e788b4c5a806905936db2127873`** |

Hash pós-reversão **idêntico** ao inicial. O rollback removeu exatamente 6
linhas e o gatilho de imutabilidade voltou habilitado (`tgenabled = 'O'`).

### 5.1 Sobre desabilitar o gatilho de imutabilidade

`fn_rollback_carteira_backfill` desabilita `trg_sale_events_immutable` dentro da
transação. Isso merece ser dito em voz alta em vez de ficar escondido:

- Não é furo na imutabilidade. Ela protege o livro de **edição casual**;
  desfazer um backfill identificado por produtor + origem é operação de
  administração, deliberada e auditável.
- A alternativa seria não ter como voltar atrás de uma escrita de 270 linhas de
  dinheiro — pior.
- Só `service_role` executa; `authenticated` e `anon` foram revogados.
- Remove **apenas** `producer='carteira' AND source='backfill'`. Linhas do
  gatilho vivo (#1201, `source='trigger'`) não são tocadas.

## 6. O que NÃO foi feito

- **Nada em produção.** Nem o backfill, nem a migration.
- A migration **cria a função e não a executa**. Rodar é ato deliberado:
  `SELECT public.fn_backfill_carteira_orders(org, exclusões, false)`.
- `p_dry_run` é `true` por padrão — chamar sem pensar não escreve.

## 7. Procedimento sugerido para quando o CTO autorizar

1. Capturar impressão digital de prod.
2. Ensaio: `fn_backfill_carteira_orders(NULL, ARRAY['f6d01a1d-8768-4947-ba5a-d31214059c59']::uuid[], true)`
   → conferir **270 emitidos, 1 excluído** (ignorar a coluna de rótulo).
3. Real, com `false`.
4. Conferir contra o alvo: **475 linhas, R$ 1.587.172,15, 55 `carteira`**.
5. Divergiu? `fn_rollback_carteira_backfill(NULL)` e reportar.

O piloto decidido é a **Milennials** — passar o `org_id` dela no passo 2 e 3
restringe o backfill a essa organização.

### Pré-requisito registrado para testevideo e Basic4u

Antes do piloto dessas duas, alguém precisa preencher `sale_responsible_id` nos
pedidos: elas saem de zero para **86% e 67%** de receita não-atribuída. É
trabalho de dado, fatia própria, fora desta.
