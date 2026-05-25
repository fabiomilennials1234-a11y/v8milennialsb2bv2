# How-to: Debug Meta Chat

## Mensagem inbound não aparece em /atendimento/meta
1. Logs `meta-webhook`: `supabase functions logs meta-webhook --project-ref <ref>`
2. Verificar `channel_messages` para a org: `SELECT * FROM channel_messages WHERE organization_id = '<org>' AND channel IN ('messenger','instagram') ORDER BY timestamp DESC LIMIT 5;`
3. Verificar `meta_conversations` recebeu upsert: mesma query trocando tabela.
4. Se row em `channel_messages` existe mas `meta_conversations` não → conferir `meta_pages` (`page_id` string bate com `channel_messages.page_id`).
5. Conferir trigger ativo: `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_meta_conv_upsert';`

## Composer não envia (24h fechada)
- `MetaWindowWarning` mostra banner. Cliente precisa enviar nova msg ou usar message tags (não suportado FASE 0).

## Profile sem nome/foto
- Chamar manualmente: `curl -X POST .../functions/v1/meta-conversation-profile -d '{"conversationId":"<id>"}' -H Authorization: Bearer <jwt>`
- Se 404 Graph API → conversa de usuário que bloqueou ou conta deletada.

## Webhook silently unsubscribe
- `GET https://graph.facebook.com/v21.0/<page_id>/subscribed_apps?access_token=<page_token>` deve listar o app Torque.
- Se não listar → desconectar + reconectar a page em Settings.

## Smoke test manual (Task 33 / Sub-fase 0.7)

Runbook para validar Meta Chat FASE 0 contra a sandbox real da Meta. Pré-requisito: dev org com `meta_pages` conectada (IG + Messenger) e secrets dev populados.

1. **Deploy das migrations em dev**

   ```bash
   supabase db push --linked
   ```

   > Nota: dev `bcfadphgsibjzivtbjvc` tem ~28 migrations não aplicadas em relação a prod (ver memory `project_dev_baseline_divergent`). `db push --include-all` pode falhar — se for o caso, aplicar somente as migrations FASE 0 via Supabase Management API (curl/python com token `sbp_*`, User-Agent header obrigatório, ver memory `reference_supabase_mgmt_api`).

2. **Deploy da edge function de enriquecimento**

   ```bash
   supabase functions deploy meta-conversation-profile --project-ref bcfadphgsibjzivtbjvc
   ```

3. **Inbound real (Instagram)**

   - Abrir conta IG sandbox associada a uma `meta_pages` da dev org.
   - Enviar `smoke test 1` para a conta.
   - Dentro de 2 min, logar no frontend dev (https://dev.torquecrm.com.br) com usuário da org.
   - Navegar `/atendimento/meta` → confirmar que a conversa aparece com avatar + username corretos.

4. **Outbound real (Instagram)**

   - Selecionar a conversa.
   - Responder `smoke reply 1`.
   - Confirmar entrega na sandbox IG.

5. **Repetir para Messenger**

   - Mesmo fluxo a partir de uma DM da Page do Facebook.

6. **Validar gate da janela 24h**

   ```sql
   UPDATE meta_conversations
   SET last_inbound_at = now() - interval '25 hours'
   WHERE id = '<conversation_id>';
   ```

   - Recarregar a thread → composer deve ficar desabilitado e exibir `MetaWindowWarning`.

7. **Registrar o resultado no PR**

   Escrever um bloco curto no description do PR, p.ex.:

   ```
   Smoke ok para IG (✓) e Messenger (✓). Profile pic carregada.
   Janela 24h corretamente bloqueada após manipulação de last_inbound_at.
   ```

   Se algum passo falhar, abrir issue de backlog e pausar merge até resolver.
