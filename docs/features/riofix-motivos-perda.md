# Edição dos motivos de perda — Riofix

Administradores da Riofix encontram o cadastro em **Configurações → Geral →
Motivos de perda**. Endereço direto:
`/configuracoes/geral?secao=motivos-perda`.

Cada motivo tem uma ação **Editar**, com **Salvar** e **Cancelar**. O nome é
obrigatório, tem limite de 120 caracteres e perde espaços nas extremidades.
Durante o envio, os controles ficam bloqueados. Uma falha mantém o rascunho
para nova tentativa; falha de carregamento oferece **Tentar novamente**.

A tela fica restrita ao UUID da Riofix e ao administrador. A mesma restrição
existe na mutation antes da chamada de rede. Leituras e atualizações filtram
explicitamente `organization_id`; a gravação também filtra o ID do motivo e
respeita as políticas RLS já existentes. Uma resposta sem linha atualizada é
tratada como erro.

A atualização envia somente `name` à linha existente em `loss_reasons`.
Os IDs, categorias, ordem e marcação de motivo padrão continuam os mesmos.
Perdas anteriores conservam seu texto snapshotado; novas seleções usam o nome
atualizado. Não há criação, exclusão, migration ou alteração de dados em
produção nesta entrega.

## Validação

- Testes do formulário: autorização, salvar, cancelar, falha, nome vazio,
  envio pendente e descarte do rascunho ao trocar de organização.
- Testes dos hooks: filtro da organização, cache isolado, payload de
  renomeação, validação e falha de linha ausente/RLS.
- Regressão do seletor obrigatório de perda e da resolução do histórico.

Para conferir manualmente, entre como administrador da Riofix, abra Geral,
renomeie um motivo e confirme o novo nome no seletor de perda. Confira que
cancelar não grava e que a seção não aparece para membros ou em outra org.
Use dados locais de teste; publicar a PR não executa a renomeação.
