# Excel dos negócios da Ventimais

## Escopo aprovado

Ao exportar Excel de qualquer kanban selecionado da Ventimais, incluir informações,
observações, campos personalizados do lead e comentários. Funciona no kanban inteiro
e na exportação de uma etapa ou seleção em lote. A seleção atual do kanban é por
lead: todos os cards dos leads selecionados nesse funil são exportados.
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

### Resultado local em 10/09/2026

- Build final: aprovado (Vite + service worker).
- Lint dos arquivos alterados: zero erros; avisos `any` preexistentes.
- Testes focados e regressão das configurações/disparos: 44 aprovados.
- Suíte ampla: 987 arquivos, 12.280 testes aprovados na execução completa.
  A execução começou antes dos últimos ajustes de mocks; os testes afetados foram
  corrigidos/repetidos sobre o código final e estão entre os 44 aprovados.
  Restam 40 suítes com falhas preexistentes, reproduzidas na base `e1d629f4a`
  em checkout separado (34 suítes com 149 testes falhando + 6 erros de importação).
- Typecheck: a checagem final e a base reproduzem a mesma falha adicional ao
  baseline em `WaitBusinessWindowNode.test.tsx` (TS2352), sem alteração nesse arquivo.
- Consultas de leitura: UUID/flags, schema e vínculos de comentários conferidos.
  Qualificação: 306 cards, 1 comentário de negócio e 12 gerais. Propostas: 4 cards,
  1 comentário geral. Nenhuma gravação feita no banco.

### Standards

Zero achados acionáveis. Isolamento, tipos e limites entre módulos seguem AGENTS.md
e os documentos locais. Revisão estática por agente independente.

### Spec

Zero achados pendentes, incluindo revisão incremental da seleção em lote. UUID +
flag, recorte por kanban e vínculos dos comentários foram conferidos. Revisão
estática por agente independente; navegador autenticado não foi usado.

O envio da branch e a abertura da PR para `main` foram autorizados. Merge,
publicação e ativação da flag em produção permanecem pendentes de autorização.
