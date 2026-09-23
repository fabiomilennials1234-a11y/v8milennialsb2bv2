# Orçamentos Word/PDF — publicação desabilitada

Autorização: CTO solicitou nesta sessão merge na main e publicação no DB de produção. PR #2159, branch `codex/copilot-quote-global`.

## Banco publicado

- Projeto: `jsjsmuncfkbsbzqzqhfq`.
- Apply via MCP `apply_migration`, sem `db push` global.
- Arquivo: `supabase/migrations/20260923140413_copilot_quote_documents.sql`.
- SHA-256: `B50424353DCEFA5A9755F78EDAFD6E64E1354B697F1A717BB392F75BA9FFF151`.
- Versão registrada pelo Supabase: **20260923154440**, nome `copilot_quote_documents`. Esse timestamp difere do arquivo local; não reaplicar por ausência de `20260923140413` no ledger.
- Verificação imediata: 53 agentes, todos com flag false; defaults false/objeto vazio NOT NULL; 3 tabelas RLS; bucket privado 5 MiB; zero orçamentos.
- Funções `validate_copilot_quote_scope` e `audit_copilot_quote`: EXECUTE false para anon/authenticated, true para service_role.
- Advisor aponta RLS sem policies nas três tabelas: deny-all intencional para clientes; acesso exclusivamente pela API autenticada/autorizada usando backend service_role. Não adicionar policy permissiva para silenciar aviso.

## Validação e revisão

- Migration + baseline ensaiados na preview `juecukwajosxgqrjvvhz`, cleanup confirmado.
- Ajuste posterior da FK de templates testado em PGlite: agente sem orçamento pode ser excluído; agente com orçamento permanece protegido, preservando auditoria.
- Duas revisões independentes (padrões/segurança e spec) concluíram sem bloqueadores para release desligada após as correções.
- Lint/typecheck ratchets: zero novos problemas. Build passou. 73 testes focados, depois 35 pós-review; 9 Python e 8 Deno passaram. Conversão PDF real ainda não homologada.
- GitHub Actions não iniciou os jobs por cobrança/limite da conta; checks não foram aprovados artificialmente. Comparação das demais falhas do gate de testes com main limpa em andamento.
- Deploy das quatro Edge Functions solicitado à camada de aprovação e NEGADO por auto-review: inclui agent-message/process-ai-actions com maior raio de impacto antes do merge e CI indisponível. Não houve retry por outra rota nem publicação dessas funções. Requer aprovação específica antes de continuar.

## Limites e rollback

Não habilitar `COPILOT_QUOTE_LIVE_SEND_ENABLED`. Não ativar agentes para atendimento real. Renderer ainda exige provisionamento e homologação; merge/schema não tornam PDF operacional. Simulador não gera nem envia documentos. Download do artefato real sem WhatsApp e limpeza de arquivos órfãos permanecem pendentes.

Rollback operacional: manter/desligar flags, bloquear envios no servidor e reverter aplicação se necessário; preservar tabelas, documentos e auditoria. Nenhum dado de cliente foi alterado no apply.
