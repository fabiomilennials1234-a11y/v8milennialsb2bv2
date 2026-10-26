# Meta CRM: preparação para produção

Inspeção em 23/10/2026. **Preparado para ensaio; ativação depende da validação no Supabase e na Meta.** Escopo e critérios de liberação estão descritos abaixo.

## Identidade pública

Informações fornecidas expressamente pelo proprietário nesta sessão:

- Produto: Torque CRM.
- Responsável pelo produto e app: Gabriel Aurelio Gipp.
- CNPJ: 54.384.269/0001-48 (dígitos verificadores conferidos; não é consulta cadastral).
- Domínio: torquecrm.com.br.
- Contato da integração: acesso@torquecrm.com.br.
- App: TORQUECRM Integrações — `2095970848458119`.
- Configuration ID: `2300126890775486`.
- Portfólio: Torque CRM — `958807170069615`.
- Conta de teste: `act_3123347544525501`.

`/sobre`, `/privacidade`, `/termos` e `/exclusao-de-dados` servem HTML legível sem JavaScript ou login. Worker e nginx mapeiam os novos caminhos; o rodapé liga aos documentos. Nome e CNPJ anteriores foram substituídos; endereço e telefone da empresa anterior foram retirados, pois não foram confirmados para o novo responsável. Não cadastrar endereço ou razão social presumidos na Meta. Conferir o documento oficial antes da verificação.

## O que está pronto neste pacote

- Termos públicos e instruções de exclusão; privacidade cobre Ads, Lead Ads, Messenger e Instagram Direct.
- `meta-data-deletion`: valida `signed_request` HMAC-SHA256 antes de registrar um pedido privado e devolver `{url, confirmation_code}`.
- `meta-deauthorize`: valida a mesma assinatura e registra notificação privada para reconciliação. **Não revoga conexões no banco automaticamente.**
- Consulta de status devolve apenas `pending`, `processing` ou `completed` por protocolo opaco. Não expõe usuário, organização, notas ou tokens.
- Repetição do mesmo evento não reabre pedido concluído; um novo payload assinado cria novo protocolo.
- Migration `20271215000000_meta_privacy_requests.sql`: fila com RLS, sem acesso `PUBLIC`/`anon`/`authenticated`. `service_role` é o único escritor/leitor explícito. Não altera dados de clientes nem concessões legadas.
- Status `completed` exige data de conclusão e nota de resolução. Recebimento nunca se apresenta como exclusão concluída.

## Bloqueios de código corrigidos neste PR

| Risco anterior | Implementação atual |
| --- | --- |
| Login com scope/version/IDs no cliente | `meta-oauth-start` exige admin atual da org (ou master ativo), emite URL v26 com config_id do servidor e credenciais exclusivas CRM |
| State reutilizável | Nonce privado com TTL; consumo atômico revalida autoridade no callback. App e configuração vinculados à assinatura; replay e admin removido negados |
| Token de sistema convertido para usuário | Token usado como emitido; debug_token deve confirmar app, subject, SYSTEM_USER, validade e expiração real. Nunca inventa 60 dias; expiração zero vira NULL |
| Tokens no navegador | Projeções explícitas e grants por coluna; SELECT/INSERT/UPDATE de credenciais revogados de PUBLIC/anon/authenticated, inclusive grants de coluna preexistentes |
| Tokens novos em texto no banco | AES-256-GCM com chave exclusiva versionada; AAD vincula app, organização e ativo. App Secret continua separado da chave de cifra |
| Gravação parcial / troca entre apps | RPC transacional salva conexão/páginas/contas de anúncios, desativa ativos removidos e revalida admin. Trigger nega reassociação silenciosa de página entre apps/tenants; troca de app exige desconexão local prévia, com página inativa e token antigo removido |
| Graph sem prova do segredo | Chamadas CRM recebem app explícito e appsecret_proof. Tokens vão em Bearer; origem Graph validada, redirect recusado, timeout e paginação limitados |
| Mensagem com destinatário arbitrário | Backend exige conversa do tenant, destinatário/canal correspondentes, permissão send_message e janela de 24h aberta |
| Desconexão apenas no navegador | Endpoint admin + RPC remove credenciais locais, desativa páginas e contas de anúncios numa transação. Não declara revogação remota concluída |
| Webhook confirmado antes de persistir | Eventos CRM assinados entram em inbox privado antes do ACK. Cron autenticado drena com lease/retry; erro de banco devolve 503 |
| Duplicatas de mensagens/leads | RPCs transacionais idempotentes; contador unread não duplica; leadgen usa chave app+org+evento. Replay não recria lead excluído |
| Segredos do WhatsApp compartilhados | META_CRM_* separados; legado conserva app_id NULL e credenciais atuais; evento assinado pelo app CRM não entra no handler WhatsApp |
| Renovação indevida de system token | Cron inspeciona tokens CRM, não troca por long-lived. Falha transitória não revoga; token inválido/expirado desativa autorização local |

Contas Ads selecionadas são persistidas sem expor tokens. `meta-ad-insights` fornece inventário, campanhas e insights paginados, somente para admin da organização; datas válidas até 93 dias inclusivos. Não cria/edita anúncios. `ads_management` continua configurado por decisão expressa do proprietário; não significa que existe editor de anúncios no produto.

### Pendências externas para liberar

- Aplicar migrations e verificar grants/RLS/EXECUTE no alvo real; PGlite não certifica PostgREST/gateway.
- Configurar secrets dedicados, chave de cifra, cron do inbox e alertas; validar piloto real com duas organizações.
- Confirmar token/ativos efetivos emitidos pela configuração no painel Meta, incluindo identidade do evento de desautorização. Nunca inferir tenant só pelo user_id recebido.
- Publicar documentos, verificar negócio/acesso e obter aprovações Meta necessárias. Nenhuma submissão foi realizada.
- Exercitar atendimento de privacidade. Callbacks de privacidade continuam sendo recebimento auditável, sem exclusão automática cross-tenant.

## Inventário de deploy observado (somente leitura)

Supabase `jsjsmuncfkbsbzqzqhfq` retornou:

- `meta-oauth-callback`: ACTIVE, versão 104, verify_jwt=false.
- `meta-webhook`: ACTIVE, versão 111, verify_jwt=false.
- `meta-oauth-start`: ACTIVE, versão 46, verify_jwt=false.
- `refresh-meta-tokens`: ACTIVE, versão 99.
- Novos `meta-data-deletion` e `meta-deauthorize`: não constavam na listagem.

Uma função ACTIVE não prova que está configurada para este app. Não foram lidos valores de secrets, gerados tokens ou alterados recursos de produção.

## Sequência de rollout

1. Revisar e aprovar o PR. Frontend é publicável separadamente dos callbacks; validar `/termos` e identidade no domínio público após deploy. Produção autorizada expressamente pelo proprietário; concluir revisão e gates antes do merge/deploy.
2. Para migrar uma página já vinculada a outro app, desconectar explicitamente a conexão antiga antes do consentimento novo; o sistema não sobrescreve autorização ativa de outro app. A desconexão remove credenciais locais, mas revogação remota deve ser conferida na Meta. Ensaiar o fluxo corrigido com duas organizações e conta de teste: consentimento, ativos, revogação, replay, token inválido, expiração e erros Graph. Pausar novas conexões OAuth durante a mudança do schema/callback; estados do fluxo antigo não são aceitos pelo novo callback e exigem reinício.
3. Validar migrations `20271215000000_meta_privacy_requests.sql` e `20271215010000_meta_oauth_security.sql` em ambiente isolado. Comparar ledger e dry-run: não usar `db push` indiscriminado em produção. A numeração posterior às migrations existentes evita reordenar ledger.
4. Após autorização explícita de produção, aplicar somente as migrations aprovadas e conferir no alvo real:

   ```sql
   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.meta_privacy_requests'::regclass;
   SELECT has_table_privilege('anon', 'public.meta_privacy_requests', 'SELECT') AS anon_read,
          has_table_privilege('authenticated', 'public.meta_privacy_requests', 'SELECT') AS authenticated_read,
          has_table_privilege('authenticated', 'public.meta_privacy_requests', 'INSERT') AS authenticated_write,
          has_table_privilege('service_role', 'public.meta_privacy_requests', 'INSERT') AS backend_write;
   ```

   Esperado: RLS true; false, false, false, true. Checar também grants por coluna e roles herdadas no ambiente real. O teste local não substitui essa conferência.

5. Cadastrar no secret manager do backend (nunca VITE_, git ou chat): `META_CRM_APP_ID=2095970848458119`, `META_CRM_CONFIG_ID=2300126890775486`, `META_CRM_APP_SECRET`, `META_CRM_WEBHOOK_VERIFY_TOKEN` e `META_CRM_ENCRYPTION_KEY_V1` (32 bytes aleatórios como 64 caracteres hex). Manter `META_CRM_OAUTH_ENABLED=false` durante preparação; ativar somente no piloto aprovado. App Secret é transferido diretamente entre os painéis Meta e Supabase, mediante autorização expressa do proprietário, sem aparecer em chat, logs ou arquivos. Senha e 2FA são preenchidos pelo proprietário. Esses nomes pertencem ao app CRM e não substituem META_APP_ID/META_APP_SECRET legados. A chave V1 é independente do App Secret; guardá-la no gerenciador de segredos. Não substituir nem remover uma versão da chave sem recifrar previamente as conexões correspondentes.
6. Deploy coordenado de `meta-oauth-start`, `meta-oauth-callback`, `meta-disconnect`, `meta-ad-insights`, `meta-webhook`, `send-meta-message`, `list-lead-forms`, `meta-conversation-profile`, `refresh-meta-tokens`, `meta-data-deletion` e `meta-deauthorize`, sem `--no-verify-jwt` (config.toml já declara false; HMAC é a autenticação). Sem o secret dedicado, callbacks devolvem 503 e não aceitam pedidos.
7. Exercitar POST assinado de teste e consulta do protocolo; assinatura adulterada deve retornar 401, falha de banco 503, assinatura válida status pending. Atender pedido de teste e só então marcar completed. Nunca usar um usuário real para teste destrutivo.
8. Manter callbacks configurados na Meta somente quando o teste e a rotina operacional estiverem confirmados. Os endereços são os já preparados no painel: `/functions/v1/meta-data-deletion` e `/functions/v1/meta-deauthorize`.
9. Antes de configurar webhooks, provisionar cron a cada minuto: POST vazio em `/functions/v1/meta-webhook`, header x-cron-secret com o CRON_SECRET já guardado no backend. Não publicar segredo em migration/PR/log. Verificar drenagem e recuperação após indisponibilidade. Monitorar mais de 5 tentativas, atraso maior que 5 minutos e erros 5xx. Só então configurar callback e META_CRM_WEBHOOK_VERIFY_TOKEN manualmente. Page: `leadgen`, `messages`; Instagram: `messages`, `messaging_postbacks`, `messaging_referral`. Não configurar antes da validação.
10. Preparar Business Verification, Access Verification e App Review com documentos verdadeiros, vídeo do fluxo por permissão e conta de revisão. Identificação como Provedor de Tecnologia é irreversível. Não foi executada nesta tarefa. Não submeter nem publicar app sem instrução específica.
11. Piloto com a conta Torque CRM. Critérios: OAuth, insights, lead de teste, Direct e revogação ponta a ponta; zero vazamento entre tenants; rollback e alertas exercitados. Só depois liberar outros clientes.

## Atendimento dos pedidos de privacidade

Responsável operacional: proprietário Gabriel, usando contato acesso@torquecrm.com.br. Antes de habilitar callbacks, designar cobertura operacional e alertas para falhas 5xx e pedidos pendentes. Conferir fila diariamente e atender prazo público de até 30 dias.

```sql
SELECT confirmation_code, app_id, kind, status, created_at
FROM public.meta_privacy_requests
WHERE status <> 'completed'
ORDER BY created_at;
```

A consulta acima não precisa incluir o ID pessoal nos relatórios. Para tratar um pedido, um operador autorizado consulta o registro individual no backend, verifica o app de origem e mapeia a autorização antes de qualquer alteração.

- Desautorização: confirmar revogação na Meta e interromper acessos/tarefas locais vinculados à autorização correta, limpar credenciais correspondentes e auditar resultado. Não desativar a organização inteira.
- Exclusão: localizar dados obtidos por aquela autorização e verificar direitos de terceiros e retenção legal. Excluir/anonymizar somente o escopo aprovado, inclusive mídias, logs e cópias conforme política. Não usar facebook_user_id isoladamente para uma exclusão cross-tenant.
- Mudar para processing ao assumir atendimento. Marcar completed somente depois de executar e conferir; preencher completed_at e resolution_note sem tokens ou dados pessoais desnecessários.
- A fila não executa esses passos automaticamente. Se não houver capacidade operacional comprovada, manter lançamento bloqueado e utilizar instruções públicas de contato.

## Grants adicionais e retenção operacional

Além da fila de privacidade, verificar no alvo: `has_column_privilege` de access_token/page_access_token deve ser false para anon/authenticated; leitura de page_name/id deve permanecer possível ao authenticated sob RLS. Todas as RPCs meta_consume_oauth_nonce, meta_save_business_connection, meta_disconnect_connection, meta_claim_webhooks, meta_record_message e meta_record_lead exigem EXECUTE false para PUBLIC/anon/authenticated e true para service_role. Conferir também os grants diretos e herdados; não basta ler o SQL do PR.

O cron deve limpar nonces vencidos após 24h e payloads do inbox concluídos após 7 dias, conservando pendências até resolução. Esses jobs são provisionados no ambiente aprovado; não foram criados em produção nesta tarefa. A tabela de deduplicação mantém tombstones para impedir recriação de um lead apagado por replay; incluir isso na avaliação de retenção e no atendimento de privacidade. Criptografia não dispensa minimização/retenção dos payloads. Monitorar a inspeção diária de tokens pelo cron refresh-meta-tokens.

## Rollback

Desligar META_CRM_OAUTH_ENABLED e pausar novos consentimentos antes de reverter. Não redeployar o callback legado sobre o schema novo sem plano compatível de índices. Frontend: reverter o PR restaura rotas anteriores. Callbacks: desabilitar/retirar endpoints antes de desfazer configuração. Não restaurar grants de tokens ao navegador. Não apagar fila nem protocolos; rollback de schema mantém a tabela e o histórico. Reverter uma página não reverte concessões de acesso na Meta.

## Referências primárias

- https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/
- https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/
- https://developers.facebook.com/docs/development/release/tech-providers/
- https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/session.py (SDK oficial; prova HMAC)
- https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/systemuser.py (edges assigned_pages e assigned_ad_accounts do SystemUser)

A leitura automatizada das duas primeiras páginas recebeu HTTP 429 nesta execução. O contrato de callback foi implementado e testado localmente; requisitos atuais de revisão e token devem ser reconferidos no painel/documentação oficial antes do cutover.

## Contrato de leitura Ads para ensaio

POST autenticado em `/functions/v1/meta-ad-insights`, sempre com organization_id da seleção atual e JWT real do admin:

- Inventário: `{ "action": "accounts", "organization_id": "<org>" }`.
- Campanhas: `{ "action": "campaigns", "organization_id": "<org>", "accountId": "act_<id>" }`.
- Insights: `{ "action": "insights", "organization_id": "<org>", "accountId": "act_<id>", "since": "2026-10-01", "until": "2026-10-07" }`.
- Próxima página: reenviar os mesmos filtros com o cursor after devolvido. Nenhuma URL do Graph fornecida pelo cliente é executada.

O painel Facebook de Configurações consome essa API para listar contas selecionadas e consultar métricas paginadas por período. A seleção e o cache são separados por organização; leitura fica disponível ao admin/master. Isso não substitui o painel de anúncios da agência que usa integração legada. Não apresentar a integração global da agência como prova de isolamento por cliente. Vídeo de App Review deve mostrar o consumidor real dessa API e os testes do novo fluxo.

Diagnóstico de testes: [test-diagnosis.md](./test-diagnosis.md). Revisão do delta: [security-review.md](./security-review.md).

## Rollout autorizado — execução

- Piloto restrito por `META_CRM_PILOT_ORGANIZATION_IDS` à TorqueCRM (`b2ad1ffb-e136-4356-846b-9f210f902573`). Lista vazia bloqueia consentimento; callback revalida antes de contatar Meta.
- Seis configurações CRM cadastradas no painel, sem alterar segredos legados. OAuth permanece desligado até cadastro do App Secret e ensaio real.
- Segredo do cron copiado de `cron_config` ao Vault **dentro do banco**, após conferir SHA-256 com digest do secret das funções. Nenhum valor foi retornado ao agente. Nome Vault: `meta_crm_cron_secret`.
- Ensaio remoto: baseline do repositório + pré-requisitos Meta + duas migrations novas aplicadas na branch isolada `qa-meta-pr2377`. As seis RPCs verificadas: anon/authenticated sem EXECUTE; service_role com EXECUTE; uma assinatura por nome. Limite: ensaio não replica drift de produção nem dados reais. Branch excluída, ausência confirmada.
- CI anterior: Integration tem mesmos 25 erros/3 arquivos e RLS mesmas 46 asserções vermelhas que main `56d8753ca`. Unit já comparado com main sem regressões. E2E bloqueava antes dos testes: Playwright não suporta Ubuntu 26.04; runner fixado em Ubuntu 24.04. Baselines não ampliados.

### Banco e funções em produção

Aplicadas somente `20271215000000_meta_privacy_requests` e `20271215010000_meta_oauth_security`. Ledger reconciliado com os IDs dos arquivos após apply via MCP. Sem backfill de dados de clientes. No alvo real: RLS ativo nas cinco tabelas privadas; anon/authenticated sem SELECT de tokens; authenticated lê apenas metadados; seis RPCs sem EXECUTE para clientes e com EXECUTE para service_role.

Onze funções publicadas: meta-oauth-start v48; meta-oauth-callback v106; meta-disconnect v1; meta-ad-insights v1; meta-webhook v113; send-meta-message v107; list-lead-forms v102; meta-conversation-profile v50; refresh-meta-tokens v101; meta-data-deletion v1; meta-deauthorize v1. Autenticação dentro das funções (JWT validado para ações administrativas; HMAC para callbacks; x-cron-secret para worker).

Jobs: `meta-crm-webhook-drain` #174, a cada minuto; `meta-crm-retention` #175, 03:17 UTC diariamente. Cron existente refresh-meta-tokens #23 preservado. SQL operacional em `provision-cron.sql`. Ensaio real de drenagem autenticada: HTTP 200, `{completed:0, claimed:0}`, sem timeout. Isto prova transporte/autenticação/storage da fila vazia; não prova entrega Meta nem consentimento real.

OAuth continua desligado durante preparação. Piloto exige App Secret cadastrado, liberação da flag, consentimento na organização TorqueCRM e leitura da conta autorizada; não declarar integração validada antes dessa evidência.
