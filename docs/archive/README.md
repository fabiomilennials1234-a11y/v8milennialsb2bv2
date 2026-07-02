# Archive

Documentos e SQL históricos de resolução de problema one-time, movidos do root
em 2026-06-30 para reduzir poluição de contexto (glob/grep de agente varria o root).

Valor histórico, **não operacional**. Nada aqui é referenciado por código vivo
(verificado via `git grep`). SQL aqui são patches pontuais antigos — migrations
reais vivem em `supabase/migrations/`.

Para contexto operacional atual: `CLAUDE.md`, `AGENTS.md`, `llms.txt`, `CONTEXT.md`
no root, e o vault Obsidian.

## sql/

Patches/diagnósticos avulsos. Não são migrations. `ADD_USER_SEPARATION.sql` é
cópia redundante de `supabase/migrations/20260128000000_add_user_separation_complete.sql`.
