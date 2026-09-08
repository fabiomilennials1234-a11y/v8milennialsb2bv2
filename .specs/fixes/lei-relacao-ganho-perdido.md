# Lei da Relação: ganho prevalece, somente perdas ficam em Perdido

Decisão do CTO em 2026-09-08. Complementa e substitui a regra de prova por
pedido isolado na Lei da Relação descrita no ADR-0023 §7. A Lei do ERP continua
usando `classificacao` e suas exceções manuais.

| Negócios / histórico | Relação |
| --- | --- |
| Nenhum negócio, ou somente abertos | Lead |
| Ganho atual ou venda histórica líquida de estorno | Cliente |
| Ganho e perda, com ou sem outro aberto | Cliente |
| Pelo menos um perdido e nenhum ganho/aberto | Perdido |
| Perdido e aberto, sem ganho | Lead |
| Pedido de ERP isolado, sem ganho (Lei da Relação) | Lead |

A interpretação de “somente negócios perdidos” exclui quem ainda tem negócio
aberto. A relação Cliente continua prevalecendo sobre ambos.

## Causa confirmada

`fn_lead_recalcula_primeira_venda` ignorava `sale_events.event_type` e aceitava
`sale_lost`. Consulta de leitura em produção em 2026-09-08 encontrou 1.362 leads
com `primeira_venda_at` preenchida sem qualquer evento `sale` líquido no mesmo
tenant. Isso não equivale à população de Perdido: há quem ainda tenha negócios
abertos. A derivação de métricas em TypeScript já descartava `sale_lost`.

## Implementação

- Nova migration corrige o recálculo; migrations aplicadas permanecem intactas.
- Campo calculado `relacao_negocios(leads)` consulta ganhos líquidos e negócios,
  com precedência de `deals.outcome`; cards legados usam o papel da etapa.
  Negócios soft-deletados são ignorados. Cards de funil inativo são ignorados;
  negócios vivos e ganhos históricos continuam valendo independentemente do card.
- Função `SECURITY INVOKER`, escopo de organização em todos os joins, EXECUTE
  somente para authenticated/service_role. Nenhuma policy é ampliada.
- Listagem, contagem, indicadores e exportação compartilham o filtro antes de
  paginação. A linha recebe a classificação canônica do banco. Seletor da
  Relação: Todos / Lead / Cliente / Perdido. ERP preserva Indefinido.
- Recuperação separada das marcas antigas, com backup de valores e guarda
  contra sobrescrever valores alterados posteriormente.

O campo calculado usa o recurso nativo de [filtros do PostgREST](https://docs.postgrest.org/en/stable/references/api/computed_fields.html).

## Validação e implantação

1. `SUPABASE_ACCESS_TOKEN=… node scripts/test-lead-relacao.mjs <preview-ref>`:
   migration e recuperação reais sobre fixtures PostgreSQL, transação desfeita;
   ganhos/perdas/abertos, pedidos isolados, estorno, histórico, legado, exclusão,
   vínculo entre tenants e testes positivo/negativo com RLS e ACL.
2. Aplicar **somente** `20271018000000_lead_relacao_ganho_perdido.sql` ao alvo
   autorizado; conferir grants e a disponibilidade do campo via PostgREST.
3. Executar `scripts/sql/recover-lead-first-sale-20260908.sql` após revisar a
   população. Esse passo escreve nas marcas antigas e pode disparar auditoria
   de leads; não faz parte do apply de schema. Não altera negócios nem pedidos.
4. Só então integrar o frontend. O filtro novo depende da função: não liberar
   o frontend antes da migration. Não executar `db push` com pendências alheias.

Produção não foi alterada nesta implementação. Uma branch de preview já existente
foi usada apenas com fixtures em transação desfeita; nenhuma branch nova criada.
Rollback do frontend usa o commit anterior. A recuperação inclui instrução de
rollback conservador das marcas; o campo calculado aditivo pode permanecer.

## Segurança

### Resultado dos checks locais

- Build passou; lint ratchet sem ocorrências novas; TypeScript sem erros novos
  (481 erros preexistentes cobertos pelos baselines).
- 83 testes focados da regra passaram. Migration, recuperação executada duas
  vezes, isolamento RLS e grants passaram no PostgreSQL de preview com rollback.
- Suíte completa com 3 workers identificou 18 falhas confirmadas. Seis eram mocks
  do hook da ficha, ajustados aqui; as demais vieram de bash/grep do Windows e
  varredura demorada. Os quatro arquivos envolvidos passaram em reexecuções
  direcionadas com Git bin/usr-bin no PATH e timeout ampliado. A suíte completa
  não foi repetida após esse ajuste; nenhum baseline foi alterado.

Sem ampliação de RLS; campo calculado invoker; funções de escrita continuam
vedadas a anon/authenticated. Tokens só por variável de ambiente no runner.
Backup não contém conteúdo de mensagens, nomes, telefones ou credenciais.
