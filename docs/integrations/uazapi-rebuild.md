# Contrato UAZAPI

Referência: [OpenAPI uazapiGO 2.1.1](https://docs.uazapi.com/openapi-bundled.json), consultado em 2026-09-11.

A fronteira entre domínio e fornecedor continua em `UazapiProvider`/`UazapiClient`. Nome de arquivo e legenda internos são traduzidos para `docName`/`text`; eventos de menu preservam rodapé, botão de lista e multisseleção. Criação de instância usa `/instance/create`; configuração de dispositivo pertence à conexão, webhook a `/webhook`.

Falhas de transporte em envios e criação não autorizam repetição automática: fornecedor pode ter aceitado operação antes de perder resposta. Circuito de falhas inclui servidor, credencial e grupo de endpoint. Chave do circuito permanece apenas em memória; nunca registrar seu conteúdo.

Quota desconhecida permanece `null`. `can_send_new_messages=false` gera aviso explícito. Limite de novas conversas não deve ser apresentado como limite universal de mensagens.

`tests/fixtures/uazapi/operations-2.1.1.json` registra campos/requisitos das 139 operações e hash do documento fonte. `tests/unit/uazapi-openapi-contract.test.ts` verifica chamadas do adapter contra esse documento. A fixture não valida todos os schemas de resposta e não substitui ensaio real contra o servidor contratado.

Estado, ambiente e pendências: `.specs/uazapi-rebuild/STATE.md`. A reconstrução ainda não está homologada para produção.
