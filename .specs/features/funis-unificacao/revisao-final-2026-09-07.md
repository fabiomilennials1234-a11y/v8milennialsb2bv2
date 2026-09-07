# Revisão final — Funil é Funil

Data: 2026-09-07  
Escopo: SCRUM-638, SCRUM-639 e épico SCRUM-614.

## Veredito pré-demolição

Gate técnico aprovado para cutover. A aprovação final depende do CI do PR,
apply da migration, regeneração de tipos e smoke pós-apply.

## Produção revisada

- Frontend da `main` responde HTTP 200 e foi publicado depois do merge #2010.
- 17 Edge Functions da fatia estão publicadas.
- Migration `20271008000000` aplicada atomicamente e registrada no ledger.
- Zero função/procedure SQL ou PL/pgSQL lê ou escreve as seis views.
- Zero view/rule externa depende das seis views.
- Catálogo pré-DROP: seis views, 18 triggers, 18 funções de trigger e oito
  wrappers RPC.

## Paridade de dados

| Espelho | Linhas comparadas | Divergências |
|---|---:|---:|
| `pipe_whatsapp` | 30.183 | 0 |
| `pipe_confirmacao` | 547 | 0 |
| `pipe_propostas` | 987 | 0 |
| `custom_pipe_entries` | 16.802 | 0 |
| `custom_pipelines` | 87 | 0 |
| `custom_pipeline_stages` | 597 | 0 |
| **Total** | **49.203** | **0** |

`negocio_projetado` contém 48.519 linhas para 48.519 entradas canônicas,
incluindo 42 sem `stage_id`. A view usa `security_invoker=on`;
`authenticated` e `service_role` leem; `anon` não lê.

## Código e integrações

- Gate AST cobre todo `src/` e `supabase/functions/`: zero leitor.
- Tipos legados ficam isolados no arquivo gerado e na projeção temporária.
- 108/108 workflows n8n ativos inspecionados. Um workflow continha os nomes
  apenas em notas e valores de negócio; as chamadas executáveis usam Edge/API.
- Erros n8n encontrados em 2026-09-04 pertencem a workflow desativado e
  payload sem telefone/e-mail. Nenhum erro após o rollout.

## Rollback e incidente de ensaio

O primeiro ensaio revelou que o rollback antigo continha duas transações.
O primeiro bloco chegou a restaurar as views enquanto o segundo bloco foi
revertido pela asserção do ensaio. Os oito wrappers foram restaurados
imediatamente; os dois adaptadores alterados pela `20271008000000` foram
reaplicados a partir da migration mergeada. O catálogo voltou a 6/18/18/8
antes de continuar.

O rollback foi corrigido para uma única transação e recapturado após a
`20271008000000`. Novo ensaio destrutivo/restaurador:

- seis view definitions idênticas;
- 26 function definitions idênticas;
- 18 trigger definitions idênticas;
- ACLs, owners e comments idênticos;
- transação final revertida.

A migration de DROP também compilou e executou integralmente dentro de uma
transação revertida. `lock_timeout=5s`, `statement_timeout=120s`,
`DROP VIEW ... RESTRICT` e reload do schema PostgREST fazem parte do apply.

## Telemetria

`pg_stat_statements` não serve como prova temporal nesta instância:

- versão 1.11 sem `last_call`;
- eviction LRU observada, com regressão de contadores;
- `track=top` não expõe statements internos de RPC;
- histórico mistura clientes anteriores e posteriores ao rollout.

Por decisão do CTO, o cutover usa o conjunto técnico acima no lugar da espera
de sete dias.
