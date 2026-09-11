# Reconstrução UAZAPI — estado verificável

Data: 2026-09-11.

## Base e ambientes

- Pedido CTO: reconstruir conforme documentação, em branches GitHub/Supabase baseadas em main/produção; validar com instância da organização TorqueCRM.
- Git: `codex/uazapi-rebuild`, criada de `origin/main` em `23cbd6796004113c24684dd394a7e2b2db5114c6`.
- Supabase pai: `jsjsmuncfkbsbzqzqhfq` (produção). Nenhuma escrita em produção autorizada por esta implementação.
- Supabase branch criada: `uazapi-rebuild`, ref `qtkohfnephshaxgtzksz`, ID `bcec3def-0873-4144-98ac-6fdc7856440a`. Custo US$ 0,01344/hora confirmado; CTO autorizou explicitamente manter durante reconstrução. Persistent=true. Não excluir ao fim da rodada; encerrar cobrança quando reconstrução terminar.
- Já existe branch `condicional-guiado`, pertencente a outro trabalho; não reutilizar, resetar ou excluir.
- Organização de validação: TorqueCRM, `b2ad1ffb-e136-4356-846b-9f210f902573`.
- Instância identificada por SELECT: TorqueSDR, `3ea9d185-62bb-4efd-a9b4-b557938ba9e6`, provider UAZAPI, conectada.
- Credencial da instância recuperável via consulta restrita no backend; não registrada em artefatos. Servidor informado pelo CTO: https://milennialstech.uazapi.com. Identidade remota confirmada por /instance/status; estado connected. Webhook remoto não alterado. Nenhuma mensagem enviada.
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

1. Sincronizar schema completo da branch com produção atual. Branch foi criada do projeto pai, porém replay automático falhou. Baseline real do repo restaurado (256 tabelas); ainda NÃO é snapshot completo da produção atual.
2. Expandir homologação para app/Edge Functions e permissões por usuário. Seed mínimo pronto: uma organização, uma instância e uma credencial; zero mensagens importadas e zero crons ativos.
3. Expandir contrato medido do servidor: seis endpoints de leitura já responderam HTTP 200; operações de escrita seguem sem homologação.
4. Implementar e homologar demais lacunas confirmadas: estados hibernated, recuperação de histórico, filtros de monitor e normalização de respostas.
5. Validar interface, permissões por organização, envio/recebimento, mídia, reações/leitura, menus, PIX, sender e reconexão em ambiente isolado.
6. Testes que enviam exigem destinatário controlado; testes de logout/exclusão não devem usar sessão ativa sem janela acordada.
7. Registrar prova real e critérios de aceite; PR continua draft até concluir. Nenhum merge/deploy em produção nesta etapa.

Inventário de 139 operações é referência documental; **não significa 139 funcionalidades implementadas**. Expansão de produto além dos fluxos existentes precisa de fatias próprias, sem proxy genérico que exponha operações administrativas.

## Validação local registrada

- Baseline antes das mudanças: 108 passaram, 1 teste antigo de historySync falhou por mock/rota desatualizados. Esse teste foi corrigido para /message/find.
- Suite direcionada: 164 testes passaram em 10 arquivos; mais 2 casos de conexão/credenciais passaram na rodada final do contrato (14 casos no arquivo).
- Build de produção local: passou. Sem deploy.
- Lint ratchet: passou, zero problemas introduzidos.
- Tipos: ratchet passou, zero erros introduzidos. Suite global: baseline salvo reportou 152 candidatos. Comparação com main limpa confirmou zero falhas introduzidas: main 12.862 testes / 296 falhas; branch 12.874 testes / 295 falhas. Falhas de coleta: 7 em ambos. Evidência em `test-comparison.json`. Baseline não foi ampliado.
- Testes frontend de whatsappApi têm duas falhas de localStorage indisponível no harness; arquivo de teste não alterado.
- `scripts/uazapi-readonly-probe.mjs`: preparado e verificado com transporte simulado (operações de leitura, omissão de conteúdo e rejeição de identidade incorreta); executado com sucesso contra TorqueSDR. Exige identidade remota esperada antes de consultar limites/webhooks/pastas/chats/mensagens; saída exclui credenciais, números, URLs de webhook e QR.

## Revisão de segurança do diff

Sem novos endpoints, grants, tabelas ou bypass de autorização. Tokens permanecem no servidor. Testes provam que falha de uma credencial/servidor não bloqueia outra e que criação ambígua não duplica instância. Proteções de não repetir envios já presentes na main foram mantidas. Nenhuma alteração remota na TorqueSDR.

## Validação real — TorqueSDR

- Seis endpoints responderam HTTP 200: status, limites, webhook, pastas sender, chats e mensagens. Estruturas sem valores sensíveis em `tests/fixtures/uazapi/torquesdr-live-shapes-2026-09-11.json`.
- Webhook habilitado com messages, messages_update e connection; nenhuma configuração alterada.
- /chat/find usa pagination.totalRecords. Consulta individual devolveu 455 registros; quatro trazem wa_isGroup=false apesar do JID @g.us. Grupo=true devolveu 388 registros, todos com flag e JID de grupo.
- Adapter agora percorre todas as páginas e filtra após normalizar JID. Evita retorno incompleto silencioso e loop de página repetida. Limite defensivo de 1.000 páginas falha explicitamente.
- /message/find respeitou chatid; hasMore/nextOffset produziram segunda página distinta. Adapter passou a respeitar cursor/última página do fornecedor, preservando fallback para respostas legadas sem metadados.
- Nenhum envio, mudança de webhook, reconexão, migração ou deploy em produção. Credencial administrativa fornecida pelo CTO não foi necessária nem persistida.

- Rodada final: 59 testes direcionados passaram; lint ratchet sem problemas introduzidos. Adapter real devolveu 451 chats individuais únicos após excluir os quatro JIDs de grupo inconsistentes.

## Branch Supabase provisionada — 2026-09-11

- URL: https://supabase.com/dashboard/project/qtkohfnephshaxgtzksz
- Organização QA mantém UUID da TorqueCRM; apenas name/slug/plano de teste semeados. Não é cópia completa dos dados da organização.
- TorqueSDR vinculada pelo mesmo UUID interno e identidade remota. Token guardado somente em whatsapp_instance_secrets, recuperado diretamente do backend de produção com filtro de organização/instância. Webhook secret QA independente; webhook ativo do fornecedor não foi alterado.
- Variável UAZAPI_BASE_URL definida na branch. Token administrativo não necessário para esta verificação nem persistido.
- RPC get_uazapi_credentials testada pela REST API da branch: anon HTTP 401; service_role HTTP 200. ACL nega tabela e RPC para anon/authenticated. Credencial lida da branch validou identidade remota e 451 chats individuais únicos no adapter.
- Replay automático continua sinalizado MIGRATIONS_FAILED; projeto ACTIVE_HEALTHY. Não mascarar esse status como migrações completas: baseline foi restaurado manualmente e pós-baseline ainda pendente.
- Comparação limitada de seis tabelas encontrou 23 colunas de produção ausentes no baseline. Outras diferenças de funções, políticas e tabelas ainda precisam auditoria. Não usar este banco para afirmar paridade integral de produção nem realizar merge de migrations para prod.
- Evidência: `branch-verification.json`. Sem deploy de Edge Functions nesta rodada; leitura realizada por adapter local com credencial recuperada da branch.
- Retenção persistente autorizada pelo CTO na resposta “Manter durante a reconstrução”; exceção explícita ao cleanup por rodada do runbook. Custo segue ativo.
