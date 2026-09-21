# Imagem fixa — implementação local, 2026-09-21

## Contrato

`question_buttons.data.image` é opcional: `{ bucket: 'workflow-question-images', path, mimeType, sizeBytes }`. A definição não guarda URL pública, base64 nem URL assinada. O caminho usa organização derivada no servidor e UUID aleatório; novas seleções nunca sobrescrevem o objeto anterior.

- Upload: `workflow-question-image`, POST multipart com `workflowId` e `file`; retorno `{ image, previewUrl }`.
- Prévia: mesmo endpoint, JSON `{ action: 'preview', workflowId, path }`; retorno `{ previewUrl }` assinado por 300 segundos, apenas em estado local. Reabrir painel ou primeiro erro de carregamento renova a URL; não há loop infinito de retry.
- Workflow novo precisa ser salvo antes do upload. Frontend não envia organização como autoridade.
- PNG, JPEG e WebP, no máximo **5 MiB por política operacional própria**. Não declarar esse valor como limite da Uazapi. Browser verifica tipo/tamanho; servidor verifica assinaturas binárias, tipo declarado, tamanho real e volume total do multipart (5 MiB + 64 KiB de overhead), inclusive sem Content-Length. Inspeção de container não substitui renderização real em todos os clientes.

## Acesso e retenção

Servidor consulta workflow pelo JWT do caller e RLS, deriva organização, exige `requireAuth` na organização explícita e `can_administer_guided_workflow`, além de opt-in estrito `organizations.feature_flags.workflow_question_buttons === true`. Preview rejeita caminho de outra organização.

Migration `20271020000061_workflow_question_images.sql` cria bucket privado. Policy RESTRICTIVE bloqueia acesso direto anon/authenticated, inclusive diante de policies legadas amplas. Escrita passa apenas pela API validada com service_role e `upsert:false`. Remover/substituir no editor muda apenas referência; não envia DELETE. Runtime deve assinar o ativo do snapshot imediatamente antes do envio (implementado separadamente pelo coordenador).

Assets órfãos de upload que não chegou a ser salvo permanecem retidos; esta fatia não implementa coleta destrutiva. Uma coleta futura deve respeitar definições publicadas e execuções.

## Evidência

Testes públicos UI com hooks/provider reais e HTTP externo simulado cobrem upload/prévia, rascunho salvo, substituição/remoção sem DELETE, rejeição local, reabertura/renovação e erro do servidor preservando imagem anterior. Testes HTTP do endpoint cobrem autorização positiva/negativa, RLS workflow, gate, conteúdo disfarçado, tamanho sem Content-Length, MIME incompatível, path cross-org, assinatura e ausência de overwrite.

`tests/integration/workflow-buttons/images-rollback.sql` verifica metadata privada do bucket e nega leitura/escrita/sobrescrita/exclusão direta anon/authenticated em dois paths sintéticos, dentro do envelope rollback do coordenador. Sem upload real nesse teste.

Nenhum deploy, ativação ou alteração de produção foi feito nesta fatia. O envio real anterior com imagem valida capacidade da Uazapi, não comprova ainda a nova jornada privada de upload→snapshot→assinatura→envio.
