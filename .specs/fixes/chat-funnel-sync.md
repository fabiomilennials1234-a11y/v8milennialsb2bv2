# Chat: mudanças de funil chegam ao quadro

## Planejamento

Seguir o fluxo do painel do chat até a persistência e o quadro, reproduzir o
sintoma num teste executável, corrigir o contrato de etapa e a invalidação,
validar o delta e publicar por PR. Implantação em produção solicitada pelo
usuário na sessão de 2026-09-14.

## Diagnóstico

Hipóteses: cache do quadro não invalidado; identificador de etapa incompatível;
filtros do quadro ocultando a entrada. As duas primeiras foram confirmadas.

`useLeadAllPipelines` fornece UUIDs para etapas customizadas, mas chaves para
etapas de sistema. `ContextPanelFunnels` enviava ambos como `stage_key`, tanto
para mover quanto para adicionar. O trigger `pipeline_entries_stage_mirror`,
conferido por leitura em produção, resolve `stage_key` por igualdade com a
chave da etapa; UUID diferente da chave resulta em `stage_id` nulo. O painel
aceita UUID como fallback de leitura e aparenta sucesso; a coluna do quadro
busca pela chave e não encontra a entrada.

Além disso, as mutations invalidavam `pipeline_entries` e `pipelines`, mas o
quadro usa `pipeline-page` e `pipeline-stage-counts`.

Leitura em produção encontrou cinco entradas com esse padrão; três no funil
ENVASE - NEGOCIAÇÃO EM ANDAMENTO (Café Jurerê). Não houve escrita de dados
durante o diagnóstico. Essa leitura não identifica, por si, o lead da imagem.

## Resolução

Preservar explicitamente o UUID em `stageId`/`firstStageId` nos helpers do
painel. As mutations escrevem `stage_id` para esse destino, deixando o trigger
espelhar a chave real. O contrato TypeScript distingue UUID de chave legada.
Ambas as mutations reutilizam `invalidateAfterMove`, que atualiza quadro,
contadores e superfícies do lead. Confirmação terminal e gates são mantidos.

## Testes

`tests/unit/chat-funnel-sync.test.tsx` monta o componente real com suas
mutations reais e QueryClient real. O transporte simula o contrato do trigger
consultado; Realtime fica desligado. Casos: mover custom, adicionar custom,
erro com retorno do rótulo, permissão negada, chave legada e confirmação
terminal. O quadro observa um cache separado e deve consultar novamente.

Os dois casos custom falharam antes da correção (UUID não resolvido) e passaram
depois. Helpers existentes também foram executados. Esta validação é de
componente/contrato, não um E2E autenticado nem execução do trigger PostgreSQL.

## Segurança e recuperação de dados

Sem mudança de schema, RLS, grants, auth ou integrações WhatsApp. O insert
continua obtendo a organização do contexto autenticado. A alteração não
amplia acesso; UPDATE continua sob RLS e confirmação da UI.

As cinco entradas preexistentes exigem recuperação separada e delimitada,
com verificação dos efeitos de triggers (automações, histórico e desfecho).
Não converter todas as chaves UUID indiscriminadamente. A correspondência
deve incluir organização e funil e preservar o estado posterior a mudanças
concorrentes. Nenhuma recuperação foi executada nesta etapa.

## Implementação em produção

Publicar por branch `fix/chat-funnel-sync` e PR, após os gates do delta.
Conferir a versão efetivamente servida após o merge; rollback por revert do
PR se necessário. Nenhuma migration ou edge function é necessária para o fix.
