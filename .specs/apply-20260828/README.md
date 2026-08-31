# Apply em produção — 2026-08-28

Registro do apply de **7 migrations** em `jsjsmuncfkbsbzqzqhfq` (prod), autorizado
pelo CTO na sessão. Este diretório guarda as consultas que foram efetivamente
rodadas, para que a verificação seja reproduzível e não uma afirmação.

## O que foi aplicado, na ordem

| # | Versão | Nome | O que provou que funcionou |
|---|---|---|---|
| 1 | `20270903000000` | `metrica_por_etapa_para_de_degradar` | Chique Distribuidora passou a ter `Prospecção Ativa › Lista Importada` e `Prospecção Mercos › Importados` como baldes **separados** — antes as duas etapas `novo` somavam numa só |
| 2 | `20270903000010` | `metrica_valor_por_etapa` | `Propostas › Futuro` = **R$ 391.334,00**, batendo o `SELECT` rodado antes de a migration existir |
| 3 | `20270903000020` | `etapa_exige_valor` | 382 + 85 = **467** etapas de ganho com `requires_sale_value`; guarda de etapa-de-ganho-sem-flag em **0** |
| 4 | `20270904000000` | `desfecho_do_negocio` | Backfill **casou exatamente** com a previsão; `sale_events` inalterado |
| 5 | `20270904000010` | `desfecho_pela_ui` | RPC existe, `authenticated` = true, `anon` = false |
| 6 | `20270902000000` | `funil_sistema_deixa_de_nascer_sozinho` | `ensure_pipeline_display_config` virou no-op; 420 linhas de config **intactas** |
| 7 | `20270902000010` | `delete_system_pipeline_hard` | Funções criadas; 47.314 entries e 57.514 leads **intactos** |

As 6 e 7 são de outra frente (funis de sistema excluíveis) e foram aplicadas por
último, depois de autorização específica.

## A verificação que mais importava

**`sale_events` = 1.871 antes e 1.871 depois da migration 4.**

35.116 negócios mudaram de desfecho (`outcome`) sem emitir **um único** evento de
venda. Isso não foi sorte: o backfill roda na seção 2 da migration e o trigger só
nasce na seção 5. A ordenação é deliberada, e é o que separa "backfill" de
"35 mil vendas fantasma num caderno append-only que não aceita `DELETE`".

Backfill previsto × real:

| `outcome` | Previsto | Real |
|---|---|---|
| `open` | 33.578 | **33.578** |
| `lost` | 1.234 | **1.234** |
| `won` | 304 | **304** |

Guardas depois do apply, todas em zero: espelho `won` divergindo de `outcome`;
`lost` sem `closed_at`; `won` ainda `NULL`.

E em prod, não só no arquivo: `fn_capture_sale_event` tem **0** ocorrências de
`INSERT INTO public.sale_events` — o escritor único do caderno é real.

## Erro cometido no caminho, e como foi corrigido

A migration 1 foi aplicada e o `INSERT` no ledger logo em seguida foi **bloqueado**
por permissão. Prod ficou com objeto aplicado e ledger sem a linha — exatamente o
drift que o `CLAUDE.md` alerta e que o SCRUM-560 descreve para o
`20270901000010`.

Foi corrigido ao retomar, antes de qualquer outra coisa. **A ordem certa é
registrar no ledger antes de seguir para a próxima migration**, não no fim do
lote: se o processo é interrompido no meio, o que fica é drift.

## Achado: 1 org perde funil ao fechar a auto-semeadura

Medido **antes** de aplicar a migration 6 (`risco-902.sql`, `quem-902.sql`):

- 108 orgs, 105 com linha em `pipeline_display_config`
- **1 org com funil de sistema ativo e NENHUMA linha no registro**

É a **TorqueCRM** (`b2ad1ffb-e136-4356-846b-9f210f902573`), criada em 27/08, com
4 leads, 4 cards e **0 membros ativos**. Org de teste — ninguém sente.

Mas o efeito é real: depois deste apply, os 3 funis de sistema dela ficam
invisíveis, porque o registro passou a ser a verdade e diz que ela não tem
nenhum. **Conserto, se algum dia importar:** uma chamada de
`enable_system_pipeline(org_id, tipo)` por funil — o caminho deliberado que a
própria migration 6 criou. Não foi feito porque seria escrever em org alheia sem
necessidade.

## Registro de rollback

`deals-won-null-antes.json` guarda os **149 ids** de negócios que tinham
`won = NULL` antes da migration 4. É o único dado que a normalização
(`UPDATE deals SET won = false WHERE won IS NULL`) destrói sem reconstruir — o
rollback pareado devolve o schema, não a distinção entre `NULL` e `false`.

> Nota de precisão: durante a sessão esse número apareceu como 147, depois 148 e
> por fim **149**. Não é inconsistência — é prod se movendo entre uma consulta e
> outra. O arquivo é o valor no instante imediatamente anterior ao apply, que é o
> que serve para reverter.

## Uma armadilha de SQL que custou uma verificação

`final.sql` usa `version LIKE '2027090[34]%'` e devolveu `NULL`. **`LIKE` não tem
classe de caractere** — `[34]` é literal, não alternativa. A verificação correta
está em `ver-final-ledger.sql`, com `IN (...)` explícito.

O erro é barato quando se percebe; é caro quando um `NULL` é lido como "não tem
nada aplicado".

## Como reproduzir qualquer verificação

```bash
PYTHONIOENCODING=utf-8 python scripts/mgmt_query_ref.py jsjsmuncfkbsbzqzqhfq .specs/apply-20260828/<arquivo>.sql
```

Os `led-*.sql` são **escritas** (inserem no ledger) e já rodaram — são
idempotentes (`ON CONFLICT DO NOTHING`), mas não há motivo para rodar de novo.
Os `ver-*`, `risco-*`, `quem-*` e `pre-*` são leitura pura e podem ser repetidos
à vontade.
