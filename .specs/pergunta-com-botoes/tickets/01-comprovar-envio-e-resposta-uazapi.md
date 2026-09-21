# 01 — Comprovar envio e resposta de botões pela Uazapi

## What to build

Uma demonstração controlada pelo caminho de comunicação existente: enviar opções identificadas e comprovar que o clique retorna à conversa com identidade preservada. A evidência habilita construir a Pergunta com botões sem supor formato, limite ou compatibilidade do provedor. Inclui somente o prefatoramento mínimo do adapter/ingresso necessário para preservar o contrato, sem novo motor ou nova tela de produção.

## Acceptance criteria

- [ ] Registrar versão da instância e fixtures sanitizadas de aceite, envio, clique, imagem e falha usando destinatários de teste, sem clientes reais.
- [ ] Exercitar gateway, adapter e ingresso reais; preservar IDs internos e do WhatsApp, ID da opção e contexto de conversa sem depender do rótulo.
- [ ] Comprovar opções exclusivamente de resposta, de uma a três, com e sem imagem; registrar Android, iOS, Web e Desktop disponíveis, deixando ausências explícitas.
- [ ] Determinar presença e semântica de referência à pergunta original e comportamento de resposta imediata; se faltar dado, propor correlação segura verificável em vez de aceitar pelo telefone.
- [ ] Identificar campos descartados pelo caminho atual e corrigir apenas o necessário de forma compatível; regressões de texto/menu legado permanecem verdes.
- [ ] Documentar evidência de aceite versus entrega, tratamento de resultado incerto e limites encontrados; não inferir idempotência de tracking nem limite técnico de três.
- [ ] Testes na fronteira HTTP e ingresso exercitam código real e fixtures; nenhuma cópia de algoritmo de produção dentro do teste.
- [ ] Recursos de teste ausentes são impedimentos explícitos; não marcar comprovação real concluída só com mocks e não criar infraestrutura paga sem autorização pertinente.

## Blocked by

None — can start immediately.
