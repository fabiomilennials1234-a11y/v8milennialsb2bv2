# 05 — Enviar imagem fixa com a pergunta e seus botões

## What to build

Selecionar uma imagem no painel, conferir a prévia e enviar essa imagem junto aos botões, mantendo resposta e destino corretos. A imagem é opcional, fixa por node e protegida por organização.

## Acceptance criteria

- [ ] Upload direto, prévia, substituir e remover funcionam; não exigir URL manual nem oferecer imagem dinâmica por contato/produto.
- [ ] Imagem selecionada atravessa persistência, gateway e adapter e aparece junto aos botões nos clientes validados; clique mantém correlação com a pergunta.
- [ ] Validar conteúdo/tipo e tamanho segundo limites comprovados; rejeição aparece no painel e também é imposta no servidor.
- [ ] Ativo e consulta respeitam organização/permissões; acesso necessário ao provedor não expõe arquivo permanentemente nem expira antes de envio futuro na fila.
- [ ] Trocar ou remover imagem no rascunho não destrói ativo referenciado por execução já iniciada; a versão pertinente permanece disponível.
- [ ] Pergunta somente texto continua funcional; falha de upload não salva configuração aparentemente válida com referência inexistente.
- [ ] Testes cobrem upload até envio/resposta e acesso cruzado negado; fixtures não substituem a comprovação real de renderização.

## Blocked by

- 03 — Configurar três botões e validar todas as saídas.
