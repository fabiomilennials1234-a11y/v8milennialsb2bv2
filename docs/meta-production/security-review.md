# Revisão de segurança — OAuth Business e privacidade Meta

Data: 2026-10-23. Base main 56d8753ca. Revisão local do diff completo; não certifica ambiente remoto.

## Segurança

Bloqueia no delta: nenhum defeito conhecido após testes locais; resultado final de suíte e revisão de grants constam no PR. Produção segue bloqueada para ativação até piloto real, grants no alvo, secrets e cron confirmados.

Herdado: app Meta/WhatsApp legado mantém versão/credenciais próprias e caminho de processamento anterior. Riscos herdados fora do novo fluxo são identificados pelo app_id NULL e não recebem credenciais CRM. Não usar o PR como certificação geral de WhatsApp, Copilot ou autorização de todos os módulos.

## Checklist aplicado

- Admin atual (ou master ativo) emite consentimento; Gestor é negado para gestão de credenciais. Callback revalida autoridade no consumo de nonce e na transação final.
- State HMAC vincula org, usuário, app, configuração, canal, TTL e nonce. Consumo atômico impede corrida/replay; RPC service-only.
- Tokens debugados como SYSTEM_USER, app/subject corretos, validade real; sem troca long-lived ou expiração inventada.
- AES-256-GCM com nonce aleatório e AAD por app/tenant/ativo. Key V1 independente do App Secret; nenhum plaintext novo armazenado. Segredos nunca em bundle, resposta ou log.
- Tabelas expõem somente projeções não secretas; grants de tabela e de colunas de token são revogados. Browser não pode inserir/editar tokens ou desconectar por update direto.
- Novas RPCs SECURITY DEFINER usam search_path fixado e revogam PUBLIC/anon/authenticated, inclusive defaults permissivos simulados no teste PostgreSQL.
- Service role não serve como backstop: endpoints autenticam ator, resolvem organização validada, filtram registros por org e verificam app/ativo antes do Graph.
- Graph CRM tem appsecret_proof por token e app; origem fixa, Bearer, redirects recusados, timeout e paginação limitada.
- Envio exige conversa pertencente à org, destinatário/canal iguais aos persistidos, permissão send_message e janela de 24h. Mídia exige HTTPS.
- Ads somente leitura/admin, conta proveniente do consentimento; range de datas limitado e cursor não controla URL/fields.
- Webhook CRM: assinatura específica do app, corpo com limite de bytes reais, inbox privado antes do ACK, retries com lease. CRM não roteia para WhatsApp.
- Mensagem+conversa numa transação, deduplicação por ID externo e contador unread idempotente. Leadgen tem chave app/org/evento e tombstone contra recriação após exclusão.
- Configurações de campanha verificam tenant antes de distribuição; queries de leads filtram org e excluem soft-deleted.
- Filas de privacidade somente recebem/acompanham pedidos; resolução exige operador e escopo confirmado. Não há DELETE cross-tenant baseado apenas no user_id Meta.

## Evidência e limites

PGlite confere grants/EXECUTE negativos, nonce único, remoção de admin, isolamento de app/tenant, rollback atômico, duplicatas, unread e replay após exclusão. Testes Web Crypto cobrem cifra, adulteração e troca de contexto. Handler tests cobrem state inválido, app/token incorretos, recusa, persistência e falha de banco. Deno check cobre endpoints alterados.

Ainda não exercitado em Supabase remoto: PostgREST/relacionamentos, RLS com JWT real, grants no apply, entrega/cron real e consentimento Meta. Nenhuma migration, deploy, submissão ou segredo de produção foi alterado nesta tarefa. Testes locais não substituem esses gates. Não foi criada branch Supabase paga.
