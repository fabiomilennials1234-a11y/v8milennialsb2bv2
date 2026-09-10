# Excel dos negócios da Ventimais

## Escopo aprovado

Ao exportar Excel de qualquer kanban selecionado da Ventimais, incluir informações,
observações, campos personalizados do lead e comentários. Funciona no kanban inteiro
e na exportação de uma etapa ou seleção em lote. A seleção atual do kanban é por
lead: todos os cards selecionados daquele lead no mesmo funil são exportados.
Exclusivo da organização Ventimais, UUID
`56b88e32-be6a-436e-b4e6-6e1293d21659`, com `organizations.feature_flags.kanban_export_details = true`.
O UUID foi confirmado por consulta de leitura em 10/09/2026. Não identificar por nome.

## Comportamento

- Uma linha por `pipeline_entries.id`, preservando múltiplos negócios do mesmo lead.
- Aba Negócios: dados do lead, campos do funil selecionado, dados do cadastro do negócio,
  observações, campos personalizados e comentários com autor/data.
- Comentários de outro negócio não entram. `pipeline_entry_id IS NULL` é comentário
  geral do lead e fica identificado separadamente. Comentários apagados não entram.
- Aba Comentários: histórico integral, com ID do comentário, card, lead, origem,
  autor e datas. Textos longos são divididos em partes; notas/campos longos ganham
  colunas de continuação. Nenhum texto vira fórmula do Excel.
- Consultas paginadas e escopadas por organização, com RLS do usuário autenticado.
  Falha de consulta interrompe o download em vez de entregar arquivo incompleto.
- A flag é relida no clique. A mesma flag em outra org não libera o recurso.
- CSV, exportação global da lista de leads e outras organizações mantêm o caminho
  anterior. O contexto do kanban inteiro é usado somente pelo rollout.
- A aba de exportação em funis customizados só é adicionada para a Ventimais com flag.

## Liberação e reversão

Não há alteração de schema, de permissões ou de políticas RLS. Primeiro publicar o
frontend via PR/review. O script `supabase/scripts/ventimais_export_details.sql`
ativa a flag apenas no UUID confirmado, preservando as demais flags. Ativação em
produção depende da autorização de publicação conforme AGENTS.md.

Para reverter, executar o UPDATE de desativação documentado no próprio script.
Confirmar novamente a organização e o estado da flag antes e depois de aplicar.

## Validação

Testes de workbook fazem round-trip real com ExcelJS. Cobrem múltiplos cards do
mesmo lead, isolamento por org/funil, autoria, notas, campos personalizados,
exclusão de comentários apagados/de outros negócios e textos maiores que 32.767
caracteres. Testes de consulta cobrem flag desligada, outra organização, CSV/global,
kanban estrangeiro, etapa, limites, paginação com teto de servidor e erros parciais.
