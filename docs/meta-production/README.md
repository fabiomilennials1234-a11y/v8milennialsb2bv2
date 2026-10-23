# Meta CRM: preparação para produção

Data da inspeção: 2026-10-23. **Lançamento do novo app ainda bloqueado.** Este pacote corrige a identidade pública e prepara o recebimento auditável de solicitações de privacidade; não certifica OAuth, anúncios ou chat em produção.

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

## Bloqueios de lançamento encontrados no código herdado

Não trocar os IDs/segredos globais atuais para o novo app enquanto estes pontos não estiverem resolvidos e testados:

| Bloqueio | Evidência | Critério para liberar |
| --- | --- | --- |
| Login não usa configuração Business | `src/modules/communication/hooks/useMetaConnection.ts` constrói diálogo v21.0 com `scope`, sem `config_id` | Cliente usa a configuração `2300126890775486`; backend valida app/configuração e concessões correspondentes |
| Token de sistema tratado como token de usuário | `meta-oauth-callback` sempre troca por long-lived e inventa validade de 60 dias; schema exige timestamp | Fluxo suporta tipo real de token e ausência de expiração, sem conversão indevida; refresh não tenta renovar token de sistema |
| Tokens expostos ao navegador | `useMetaConnections` seleciona `*, meta_pages(*)`; `useMetaPages` seleciona `*`; baseline concede SELECT de tabela a authenticated | Credenciais em armazenamento acessível só ao backend; respostas e grants não expõem tokens, inclusive a membros autenticados |
| Prova do segredo ausente | App novo exige appsecret_proof; helpers Graph usam tokens sem prova | Requests autenticados implementam a prova correta; teste real do novo app passa |
| Estado OAuth com nonce sem consumo | `_shared/meta-oauth-state.ts` valida assinatura/TTL, mas não consome nonce no banco | Callback revalida permissão atual, consome nonce uma vez, nega replay e membro removido |
| Associação de dados ao app é ambígua | `meta_connections` não registra app_id | Desautorização/exclusão identifica app + autorização + organização, sem atingir outro cliente ou conexão de outro app |
| Webhook pode perder eventos | `meta-webhook` captura erro por entry e ainda retorna 200 | Persistência/idempotência e retry cobrem erro de processamento; cenários de recuperação testados |
| Credenciais globais compartilhadas | Meta legado/WhatsApp usa META_APP_SECRET | Segredo do novo app isolado; rollout não invalida canais já ativos |
| Privacidade requer operação real | Callbacks deste pacote apenas enfileiram | Responsável, rotina, monitoramento e execução de exclusão/reconciliação definidos e exercitados antes de habilitar callbacks |

Não se deve publicar dados de clientes em um app que apenas passou nos testes de recebimento do callback. Esses bloqueios são parte do plano de cutover, não uma aprovação de produção.

## Inventário de deploy observado (somente leitura)

Supabase `jsjsmuncfkbsbzqzqhfq` retornou:

- `meta-oauth-callback`: ACTIVE, versão 104, verify_jwt=false.
- `meta-webhook`: ACTIVE, versão 111, verify_jwt=false.
- `meta-oauth-start`: ACTIVE, versão 46, verify_jwt=false.
- `refresh-meta-tokens`: ACTIVE, versão 99.
- Novos `meta-data-deletion` e `meta-deauthorize`: não constavam na listagem.

Uma função ACTIVE não prova que está configurada para este app. Não foram lidos valores de secrets, gerados tokens ou alterados recursos de produção.

## Sequência de rollout

1. Revisar e aprovar o PR. Frontend é publicável separadamente dos callbacks; validar `/termos` e identidade no domínio público após deploy. Preparar aprovação final sobre o diff concreto; não fazer merge/deploy automático nesta tarefa.
2. Resolver e testar os bloqueios OAuth/credenciais da tabela acima antes do novo fluxo por cliente. Usar fixtures de dois tenants e conta de teste, com revogação, replay, token inválido e erros de Graph.
3. Validar migration da fila em ambiente isolado. Comparar ledger e dry-run: não usar `db push` indiscriminado em produção. A numeração posterior às migrations existentes evita reordenar ledger.
4. Após autorização explícita de produção, aplicar só a migration aprovada e conferir no alvo real:

   ```sql
   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.meta_privacy_requests'::regclass;
   SELECT has_table_privilege('anon', 'public.meta_privacy_requests', 'SELECT') AS anon_read,
          has_table_privilege('authenticated', 'public.meta_privacy_requests', 'SELECT') AS authenticated_read,
          has_table_privilege('authenticated', 'public.meta_privacy_requests', 'INSERT') AS authenticated_write,
          has_table_privilege('service_role', 'public.meta_privacy_requests', 'INSERT') AS backend_write;
   ```

   Esperado: RLS true; false, false, false, true. Checar também grants por coluna e roles herdadas no ambiente real. O teste local não substitui essa conferência.

5. Cadastrar no secret manager do backend (nunca VITE_, git ou chat): `META_CRM_APP_ID=2095970848458119` e `META_CRM_APP_SECRET` do novo app. Usuário copia o App Secret diretamente do painel para o gerenciador; agente não revela nem copia o segredo. Os nomes são exclusivos dos novos callbacks, não substituem META_APP_ID/META_APP_SECRET legados.
6. Deploy separado das duas novas edge functions, sem `--no-verify-jwt` (config.toml já declara false; HMAC é a autenticação). Sem o secret dedicado, callbacks devolvem 503 e não aceitam pedidos.
7. Exercitar POST assinado de teste e consulta do protocolo; assinatura adulterada deve retornar 401, falha de banco 503, assinatura válida status pending. Atender pedido de teste e só então marcar completed. Nunca usar um usuário real para teste destrutivo.
8. Manter callbacks configurados na Meta somente quando o teste e a rotina operacional estiverem confirmados. Os endereços são os já preparados no painel: `/functions/v1/meta-data-deletion` e `/functions/v1/meta-deauthorize`.
9. Quando `meta-webhook` estiver certificado com o segredo correto do novo app, configurar callback e verify token manualmente. Page: `leadgen`, `messages`; Instagram: `messages`, `messaging_postbacks`, `messaging_referral`. Não configurar antes da validação.
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

## Rollback

Frontend: reverter o PR restaura rotas anteriores. Callbacks: desabilitar/retirar endpoints antes de desfazer configuração. Não apagar fila nem protocolos; rollback de schema mantém a tabela e o histórico. Reverter uma página não reverte concessões de acesso na Meta.

## Referências primárias

- https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/
- https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/
- https://developers.facebook.com/docs/development/release/tech-providers/

A leitura automatizada das duas primeiras páginas recebeu HTTP 429 nesta execução. O contrato de callback foi implementado e testado localmente; requisitos atuais de revisão e token devem ser reconferidos no painel/documentação oficial antes do cutover.
