# PLANO-1854 — Colisão de versão: `produtos_do_negocio` nunca aplica por `db push`

Issue: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1854
Branch: `fix/1854-renumera-produtos-do-negocio` (cortada de `origin/main`, 0 commits à frente na abertura)

## 1. Premissas do brief — conferidas antes de escrever qualquer linha

| Premissa | Verificação | Resultado |
|---|---|---|
| Dois arquivos no mesmo prefixo em `origin/main` | `git ls-tree -r origin/main` filtrado ao diretório RAIZ de migrations | ✅ `20270901000010` é a **única** duplicata da main |
| A guarda mede em duas metades | leitura de `scripts/check-migration-versions.sh` | ✅ (a) duplicata no checkout · (b) mesma versão na base sob outro nome |
| Meu checkout já dá 0 hoje | branch == main, então (a) dá **1** aqui também | ⚠️ **premissa do brief corrigida**: a branch está *em cima* da main, sem commits, logo ela herda a duplicata. A guarda reprova no meu checkout AGORA — é o vermelho que vou consertar, não preciso do merge ref para vê-lo |
| Prod tem o schema, ledger não tem a versão | brief + issue (medição em prod, só leitura) | aceito como dado — **não vou reconferir tocando prod** |

Prefixos livres conferidos: `20270901000011` **não existe** em lugar nenhum do repo
(`git ls-tree -r origin/main --name-only | grep -c 20270901000011` → `0`), nem em
`rollback/`, nem em `archive/`, nem em nenhum PR aberto.

## 2. Decisão: renumerar para `20270901000011`

Por quê essa e não outra:

- **Livre** em `main`, em `rollback/`, em `archive/` e em todos os PRs abertos.
- **Preserva a ordem de execução de hoje.** Com as duas no mesmo prefixo, o
  `db push` ordena por nome de arquivo: `erp_pedidos_itens` < `produtos_do_negocio`.
  Indo para `...011`, a ordem relativa é idêntica, e continua **antes** de
  `20270901000020_erp_order_items_revoga_anon.sql`.
- **Não há dependência entre as duas.** `erp_pedidos_itens` cria `erp_order_items`
  (+ colunas em `upsell_orders`/`toth_connections`); `produtos_do_negocio` mexe em
  `deal_items` e nas 5 funções (`fn_deal_won_populate_lead_products`,
  `fn_deal_items_tenant_coerente`, `deal_item_lancar/atualizar/remover`). Conjuntos
  disjuntos — a ordem entre elas é indiferente, e mesmo assim foi mantida.

Alternativa descartada: jogar para depois de tudo (`20270903000000`). Não ganha nada —
`...011` já é livre — e afasta o arquivo do bloco a que ele pertence cronologicamente.

## 3. Escopo do diff

1. `git mv supabase/migrations/20270901000010_produtos_do_negocio.sql` →
   `supabase/migrations/20270901000011_produtos_do_negocio.sql` (`git mv` para o
   histórico seguir; não há `rollback/` correspondente — conferido).
2. `src/modules/leads/components/lead-card/useProdutosPorNegocio.ts:27` — o comentário
   cita a migration **pela versão** (“a migration `20270901000010` cria, mas como
   NOT VALID…”). Passa a citar `20270901000011`, senão o comentário passa a apontar
   para `erp_pedidos_itens`, que não cria FK nenhuma de `deal_items`.
3. Nada mais. `20270901000020_erp_order_items_revoga_anon.sql:7` também cita
   `20270901000010` — e ali está **correto**, é a `erp_pedidos_itens`. Não encostar.

Fora de escopo, deliberado: prod, `blast/`, `.eslint-baseline.json`.

## 4. A prova — as duas metades, e o merge ref

- **Metade (a), no checkout:** `bash scripts/check-migration-versions.sh` →
  `Duplicate version prefixes inside the checkout: 0`.
- **Metade (b), branch × base:** o mesmo comando imprime
  `Versions colliding with origin/main under another name: 0`. E **não** imprime linha de
  `Versions renumbered` — medido: o par `20270901000010 erp_pedidos_itens` casa com o
  homônimo de mesmo nome na base e sai por `continue` antes do ramo de renumeração, e
  `20270901000011` não tem homônimo nenhum na base. Os dois caminhos silenciosos são o
  resultado certo; a classificação explícita de renumeração é para outro formato de caso
  (a base tem o arquivo sob a versão que ESTA branch reocupou).
- **Merge ref — o que o CI de verdade testa:** worktree descartável, `git merge` da
  branch dentro de `origin/main`, e a guarda rodada LÁ. É o único lugar onde o
  vermelho de hoje e o verde de depois aparecem no mesmo formato que o CI vê.
- **Self-test da guarda:** `bash scripts/check-migration-versions.test.sh` (roda no CI
  logo antes, e é o controle positivo de que a guarda não está lendo árvore vazia).

**Contagem manual de duplicatas: só o diretório raiz.** `rollback/` e `archive/` repetem
prefixos de propósito, então um `sed 's|.*/||' | uniq -d` sobre a árvore inteira colapsa os
três diretórios e devolve ~180 falsos positivos. Isso vale para a CONTAGEM à mão — não para
a metade (b) da guarda, que usa o mesmo `sed` de propósito e não sofre disso: ela compara
pares `(versão, nome)` dos DOIS lados, e o colapso acontece igual em ambos, então os
homônimos de `rollback/`/`archive/` casam entre si e saem como iguais.

## 5. O ledger de prod — preparado, NÃO executado

Prod tem os objetos (aplicados fora do ledger, prática de apply cirúrgico deste
projeto) e o ledger só tem `20270901000010 = erp_pedidos_itens`. Depois do rename, o
`db push` vai enxergar `20270901000011` como pendente e tentar reaplicar uma migration
cujos objetos já existem.

O SQL fica no `HANDOFF-1854.md`, **pronto e não executado**. Escrita em prod é botão do
humano; não estou autorizado e não vou pedir autorização no meio do trabalho.

## 6. Achado colateral — reportar, não consertar

**PR #1837** (`fix/agenda-source5-renumera`, OPEN, não-draft) renumera o par da agenda
para `20270901000000` e `20270901000010` — **os dois já ocupados na main** por
`erp_ultima_compra_e_marcas` e `erp_pedidos_itens`. Se entrar como está, cria DUAS
colisões novas no mesmo bloco que este ticket está limpando. Não é meu escopo e não
toco. Vai para o handoff e para o Despachante.

## 7. Ciclo

Plano (aqui) → rename + comentário → prova nas duas metades → `/code-review` → push →
`HANDOFF-1854.md` com o SQL do ledger → fecha #1854 → avisa o Despachante.
