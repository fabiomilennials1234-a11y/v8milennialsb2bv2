# Reconstrução UAZAPI — estado verificável

Data: 2026-09-11.

## Base e ambientes

- Pedido CTO: reconstruir conforme documentação, em branches GitHub/Supabase baseadas em main/produção; validar com instância da organização TorqueCRM.
- Git: `codex/uazapi-rebuild`, criada de `origin/main` em `23cbd6796004113c24684dd394a7e2b2db5114c6`.
- Supabase pai: `jsjsmuncfkbsbzqzqhfq` (produção). Nenhuma escrita em produção autorizada por esta implementação.
- Supabase branch: **ainda não criada**; pendente confirmação exigida pelo conector sobre organização/custo.
- Já existe branch `condicional-guiado`, pertencente a outro trabalho; não reutilizar, resetar ou excluir.
- Organização de validação: TorqueCRM, `b2ad1ffb-e136-4356-846b-9f210f902573`.
- Instância identificada por SELECT: TorqueSDR, `3ea9d185-62bb-4efd-a9b4-b557938ba9e6`, provider UAZAPI, conectada.
- Token não exportado. Webhook remoto não alterado. Nenhuma mensagem enviada.
- Destinatário controlado e condição de uso da instância aguardam informação do CTO.

## Retificação da auditoria inicial

A auditoria anterior inspecionou workspace em `ef3554799`, não a main atual. Seus totais e lista de bugs **não descrevem a main**. Nesta base já existem correções de PIX, markread, sender, disconnect/delete, validação de números, leitura de webhook e proxy regional. Preservá-las; não reconstruir usando o relatório antigo como verdade de produção.

## Implementado nesta etapa

- Fixture com campos/requisitos das 139 operações, extraída do OpenAPI 2.1.1; URL/data/hash registrados.
- Criação usa `/instance/create`, apenas metadados documentados; nome do aparelho encaminhado em `/instance/connect`.
- Provider exige identidade/token na resposta antes de gravar credenciais.
- Mídia traduz caption/filename internos para text/docName; download solicita base64 explicitamente e normaliza base64Data.
- Reação usa text; menu preserva footerText, listButton e selectableCount.
- Histórico usa chatid e filtros diretos; rejeita importação sem chat.
- Diagnóstico de quota normaliza formato aninhado e mantém desconhecido como null. UI distingue restrição de novas conversas.
- Circuito de falhas isolado por servidor, credencial e grupo; criação/webhook não repetidos após falha ambígua.
- Testes de contrato independentes dos tipos internos, isolamento positivo/negativo e preservação dos testes existentes de sender/PIX/leitura.

## Ainda necessário para concluir pedido

1. Confirmar custo e provisionar branch Supabase derivada de produção; inspecionar schema efetivo e replay (runbook alerta sobre baseline marcador).
2. Provisionar apenas dados/configuração necessários à homologação TorqueCRM; bloquear cron/automação de saída na branch antes de inserir credenciais.
3. Medir contrato do servidor UAZAPI usado pela TorqueSDR; confrontar com OpenAPI público sem mudar webhook ativo.
4. Implementar e homologar demais lacunas confirmadas: estados hibernated, paginação completa, recuperação de histórico, filtros de monitor e normalização de respostas.
5. Validar interface, permissões por organização, envio/recebimento, mídia, reações/leitura, menus, PIX, sender e reconexão em ambiente isolado.
6. Testes que enviam exigem destinatário controlado; testes de logout/exclusão não devem usar sessão ativa sem janela acordada.
7. Registrar prova real e critérios de aceite; PR continua draft até concluir. Nenhum merge/deploy em produção nesta etapa.

Inventário de 139 operações é referência documental; **não significa 139 funcionalidades implementadas**. Expansão de produto além dos fluxos existentes precisa de fatias próprias, sem proxy genérico que exponha operações administrativas.

## Validação local registrada

- Baseline antes das mudanças: 108 passaram, 1 teste antigo de historySync falhou por mock/rota desatualizados. Esse teste foi corrigido para /message/find.
- Suite direcionada final: 164 testes passaram em 10 arquivos.
- Build de produção local: passou. Sem deploy.
- Lint ratchet: passou, zero problemas introduzidos.
- Verificações globais de tipos/testes: em execução no momento deste registro.
- Testes frontend de whatsappApi têm duas falhas de localStorage indisponível no harness; arquivo de teste não alterado.
- `scripts/uazapi-readonly-probe.mjs`: preparado e sintaticamente verificado; não executado contra fornecedor. Exige identidade remota esperada antes de consultar limites/webhooks; saída exclui credenciais, números, URLs de webhook e QR.

## Revisão de segurança do diff

Sem novos endpoints, grants, tabelas ou bypass de autorização. Tokens permanecem no servidor. Testes provam que falha de uma credencial/servidor não bloqueia outra e que criação ambígua não duplica instância. Proteções de não repetir envios já presentes na main foram mantidas. Nenhuma alteração remota na TorqueSDR.
