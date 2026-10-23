# Revisão de segurança do delta Meta

Data: 2026-10-23. Base: origin/main `56d8753ca`. Revisão local; não é certificação do app em produção.

## Segurança

Bloqueia no delta: nenhum defeito conhecido após testes locais. Aplicação da migration/deploy ainda exige revisão e conferência de grants no alvo real. Callbacks implementam recebimento, não a operação de exclusão ou revogação; isso está explícito na resposta pública e no runbook.

Herdado — `src/modules/communication/hooks/useMetaConnection.ts`: projeção com `*` inclui access_token e page_access_token. Não habilitar novo fluxo até isolar credenciais no backend.

Herdado — `supabase/functions/meta-oauth-callback/index.ts`: troca incondicional por token de usuário long-lived, aceita termos Lead Ads programaticamente, persiste tokens sem criptografia de aplicação e não consome nonce. O novo app exige fluxo Business próprio e teste real.

Herdado — `supabase/functions/_shared/meta-api.ts`: Graph v21.0 e ausência de appsecret_proof nas chamadas existentes. O app novo tem a exigência ligada; não fazer cutover de secrets globais.

Herdado — `supabase/functions/meta-webhook/index.ts`: falhas de processamento por entry são capturadas antes do ACK 200; entrega precisa de persistência e retry antes de produção certificada.

Esses caminhos legados não foram habilitados nem expostos por este delta. A preparação da integração completa permanece bloqueada neles; não interpretar merge dos documentos como autorização para ligar o app.

## Checklist aplicado

- HMAC-SHA256 verificado com Web Crypto sobre o payload codificado, antes de confiar no user_id.
- Algoritmo explícito, formato de ID limitado, assinatura inválida/malformada rejeitada.
- Limite de bytes reais do corpo, independendo de Content-Length.
- Nenhum token, segredo ou payload bruto persistido/logado pelos novos handlers.
- Credenciais dedicadas META_CRM_*, separadas do app Meta/WhatsApp legado.
- Fila não aceita organization_id do cliente; não infere exclusão de tenant por um usuário Meta.
- RLS habilitado e todos os grants de PUBLIC, anon e authenticated revogados. Teste PostgreSQL local simula defaults permissivos e confere negativa; service_role consegue gravar.
- Sem novas funções SQL SECURITY DEFINER ou novos EXECUTE grants.
- Protocolo opaco por evento; retry preserva conclusão, novo evento não herda conclusão antiga.
- Resposta de status sem PII, no-store, no-referrer, noindex; consulta filtrada também por app_id e tipo.
- Persistência falhou: 503, nunca confirmação falsa de recebimento.
- completed exige timestamp e nota. Não expõe nota ao solicitante.
- HTML institucional funciona sem autenticação e sem JavaScript, sem publicação de secrets.

## Limites de validação

Testes da tabela executam em PGlite (PostgreSQL), não em branch Supabase. Nenhum recurso temporário pago foi criado. Integração PostgREST, configurações de JWT do gateway, entrega real pela Meta, SLA de atendimento e fluxos de exclusão/reconciliação ainda precisam do ensaio descrito no runbook antes de ativação.
