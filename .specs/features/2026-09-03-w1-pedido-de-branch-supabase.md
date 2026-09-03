# Pedido de branch do Supabase — W1 da Caixa de Entrada Unificada

**Épico** SCRUM-648 · **Onda** SCRUM-649 · **Subtarefa deste pedido** SCRUM-657
**Branch git** `feat/caixa-unificada-chat`
**Data** 2026-09-03

---

## O que precisa rodar lá

Duas coisas, nesta ordem, e só isso:

1. **Aplicar a migration**
   `supabase/migrations/20270921000000_caixa_unificada_lista_por_conjunto.sql`
   Cria TRÊS funções novas e não toca em nenhuma existente (`DROP: 0` no arquivo
   inteiro):
   - `public.whatsapp_readable_instance_ids(uuid, uuid[])`
   - `public.get_whatsapp_conversation_list_multi(16 args)`
   - `public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamptz)`

   Sem índice novo e sem `ANALYZE` — a decisão está medida e justificada na
   seção 4 do próprio arquivo.

2. **Rodar a suíte pgTAP**
   `supabase/tests/caixa_unificada_lista_por_conjunto_test.sql` — 70 asserções,
   `BEGIN … ROLLBACK`, não deixa linha nenhuma para trás.

---

## Por que não dá para rodar sem banco

A suíte inteira mede **comportamento de função SECURITY DEFINER sob role
`authenticated` com claims de JWT**. Não há dublê que substitua isso:

- **`SECURITY DEFINER` só é testável executando.** As três funções não sofrem a
  RLS das tabelas por dentro — o recorte é o código do corpo. Ler o arquivo não
  distingue uma guarda que funciona de uma que compila.
- **O gate de acesso depende de `auth.uid()` e `auth.role()`,** que saem de
  `request.jwt.claims`. Sem sessão, `SET ROLE` sozinho não testa nada: nenhuma
  guarda casa e a asserção passa por não ter rodado.
- **Metade da fixture é escrita por trigger.** `normalized_phone` sai de
  `trg_normalize_whatsapp_message_phone` e a tabela que a RPC lê
  (`whatsapp_conversation_summary`) sai de `trg_whatsapp_conversation_summary`.
  Isso é motor de banco, não de aplicação.
- **`tsc`, `eslint`, `vitest` e `build` não alcançam nada disso.** Não há uma
  linha de TypeScript nesta fatia.

Docker e Supabase local estão banidos neste projeto (decisão do CTO,
2026-08-20), então a única forma de exercitar é uma branch de preview.

---

## Como rodar

```bash
# 1. criar a branch a partir de um worktree LIMPO de origin/main
#    (o script existe justamente porque o provisionamento nasce com 3 linhas
#     fantasma no ledger; ver scripts/supabase-branch.sh)
bash scripts/supabase-branch.sh create w1-caixa-unificada

# 2. aplicar SÓ esta migration, com --db-url EXPLÍCITA
#    ⚠️ nunca com o checkout linkado: config.toml aponta para PRODUÇÃO
psql "$BRANCH_DB_URL" \
  --no-psqlrc --quiet --variable ON_ERROR_STOP=1 \
  --file supabase/migrations/20270921000000_caixa_unificada_lista_por_conjunto.sql

# 3. rodar a suíte
DATABASE_URL="$BRANCH_DB_URL" \
  pg_prove --verbose --ext .sql -d "$BRANCH_DB_URL" \
    supabase/tests/caixa_unificada_lista_por_conjunto_test.sql

#    sem pg_prove instalado, o equivalente que o run.sh usa:
#    (-t -A é load-bearing: sem eles o `not ok` sai indentado e o grep não casa)
psql "$BRANCH_DB_URL" --no-psqlrc --quiet -t -A \
  --variable ON_ERROR_STOP=1 \
  --file supabase/tests/caixa_unificada_lista_por_conjunto_test.sql
```

Se a branch de preview nascer com o schema base já aplicado, o passo 2 é a única
migration a rodar à mão — as outras 20270918* e anteriores já estão no baseline.
Se a branch nascer vazia, o caminho é `db push` a partir do worktree de
`origin/main`, e SÓ dele (checkout defasado quebra na 167ª migration).

---

## Critério de aprovação

**Verde é literalmente isto, e nada menos:**

```
1..70
# … 70 linhas `ok N - …`
```

- `plan(70)` e **70 asserções executadas**. Suíte que aborta antes das asserções
  conta como verde em qualquer runner que só olhe o exit code — a contagem final
  é parte do critério, não enfeite.
- **Zero `not ok`.**
- A suíte roda dentro de `BEGIN … ROLLBACK`: ao final, `whatsapp_instances`,
  `leads`, `team_members` e `conversation_read_state` da branch têm que estar
  como estavam.

**Reprova, sem discussão, se qualquer um destes falhar** — são os asserts que
existem porque a ausência deles já custou incidente neste repo:

| Assert | O que ele impede |
|---|---|
| W1 / W14 / W20 / W27 / O1 / O10 | Os **controles positivos**. Lista vazia passa por segura sendo bug — foi assim que o furo do isolamento sobreviveu no caminho social. Se qualquer um destes ficar verde por acaso, os negativos ao lado não mediram nada. |
| W26 **e** W27 juntos | `chat_restrict_to_owner` nos DOIS sentidos. Um lado só é falso verde. |
| W21 / W22 | Bypass de admin e de **master em shadow**. Medido na Alamaster: sem o bypass, a função TIRARIA caixas de quem hoje as tem. |
| W23 / W24 / W25 | Não-lida contada no chip da própria caixa. Sem isso o badge manda a pessoa abrir conversa vazia. |
| R1–R11 | As funções ANTIGAS intactas — assinatura, sobrecarga única, grants, `instance required`, `instance not in org`. É a decisão D2 inteira. |
| S (grants) | `anon` e PUBLIC sem EXECUTE nas três novas. Função nasce com EXECUTE para PUBLIC se ninguém revogar. |

---

## Depois

**Branch criada é branch para derrubar.** Toda preview é projeto Supabase
separado e **custa por hora**.

```bash
supabase branches list  --project-ref jsjsmuncfkbsbzqzqhfq
supabase branches delete <nome> --project-ref jsjsmuncfkbsbzqzqhfq
```

Nada desta fatia vai para produção nesta rodada. A migration é aplicada em prod
por decisão separada, e a ordem de entrega é **(1) migration, (2) deploy do
front** — invertendo, o front chama função que não existe e leva `PGRST202`.

---

## Uma decisão que fica com o CTO

`supabase/tests/run.sh` tem a lista de suítes escrita à mão **duas vezes** (uma
para `pg_prove`, outra para o laço de `psql`). A suíte nova já foi registrada nas
duas — sem isso ela nasceria fora do portão do CI.

Continuam **fora das duas listas**, e portanto sem rodar no CI hoje:

- `supabase/tests/official_whatsapp_conversation_list_test.sql`
- `supabase/tests/get_conversas_do_lead_test.sql`
- `supabase/tests/oraculo_onda1_test.sql`
- `supabase/tests/sensitive_access_log_test.sql`

(medido agora, varrendo `supabase/tests/*_test.sql` contra o `run.sh`: são
exatamente estes quatro, e nenhum outro)

Os dois primeiros são exatamente os testes das duas funções que o W1 clonou.
Registrá-los é uma linha em cada lista — mas pode acender vermelho pré-existente
que não é desta fatia, então ficou fora deste PR de propósito. É pedido, não
feito.
