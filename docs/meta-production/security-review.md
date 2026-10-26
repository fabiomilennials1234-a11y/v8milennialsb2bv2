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

Atualização de 25/10/2026: duas migrations aplicadas em produção, onze funções implantadas e grants/RLS/EXECUTE reais inspecionados. Cron do inbox ativo: 60 execuções bem-sucedidas e zero falhas na última hora consultada. Segredos CRM cadastrados, incluindo App Secret transferido diretamente entre os painéis após reautenticação manual do proprietário; valores não registrados em chat, logs ou arquivos. Ensaio remoto em branch efêmera concluído; branch excluída e ausência confirmada.

CI do commit c9d478cb0: gate RLS/pgTAP aprovado no GitHub (112 arquivos, 2.444 asserções), incluindo controles negativos e preservação/restauração do rollout. As duas suítes previamente classificadas como funcionalidades pendentes (SCRUM-415/416) continuam fora do gate, sem mudança nesta tarefa. Unit ratchet completo já passou localmente com 17.422 testes e zero falhas fora do baseline; baseline não ampliado. Integração e E2E seguem sendo conciliados com contratos atuais, sem alterar autorização de produção para satisfazer fixtures.

Ainda pendentes: consentimento Meta real, ativos efetivamente concedidos, entrega de webhook do novo app, leitura Ads e mensagens/lead de teste pelo frontend publicado. OAuth permanece desligado e allowlist restrita à organização TorqueCRM. Nenhuma submissão de revisão realizada pelo agente. Proprietário publicou app Meta; status Publicado verificado em 26/10/2026, sem equivaler a aprovação avançada de permissões. Testes sintéticos não certificam o piloto.

### Correções transversais verificadas em 26/10

Migration 20271215020000 exige vínculo com organização antes de leads.view_all/co-owner no predicado de visibilidade VoIP, preservando master e comportamento de lead órfão. Migration 20271215030000 mantém Realtime em fail-closed quando helper privado opcional está ausente, preservando fallback Postgres Changes. Ambas passaram ensaios PGlite e gates Integration/RLS no CI; aplicadas em produção, com versões alinhadas no ledger, search_path vazio e acesso anon negado confirmados. Não reaplicar.
