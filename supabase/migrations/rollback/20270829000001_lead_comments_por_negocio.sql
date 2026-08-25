-- ROLLBACK de 20270829000001_lead_comments_por_negocio.sql
--
-- ⚠️ ORDEM: rollback roda em ordem DECRESCENTE. Este é o SEGUNDO do par —
-- rode rollback/20270829000011_lead_comment_entry_coerente_revoga_anon.sql
-- ANTES deste, porque aqui a função `fn_lead_comment_entry_coerente` deixa de
-- existir. Na ida a ordem é a oposta (…001 cria a função, …011 revoga o grant):
-- …001 < …011 é load-bearing nos dois sentidos.
--
-- ⚠️ NÃO confunda com `20270829000000` / `20270829000010`: esses dois números
-- são da AGENDA (`agenda_meeting_events_source` e `comando_revoga_anon`). Este
-- par morava neles e foi renumerado pela #1841 para desfazer uma colisão. Rodar
-- o rollback da Agenda achando que é o deste par derruba a Source 5 do
-- calendário — os arquivos existem, então o engano não dá erro, dá estrago.
--
-- Devolve `lead_comments` ao vínculo único com o lead.
--
-- CONSEQUÊNCIA CONHECIDA de rodar isto: o vínculo comentário↔negócio é APAGADO
-- e não volta — não existe outra fonte de onde recuperá-lo. Todo comentário
-- escrito dentro de um negócio passa a ser comentário do lead, o selo "escrito
-- em <outro negócio>" some do painel, e os comentários de todos os negócios do
-- mesmo lead voltam a ser uma lista só, indistinguível.
--
-- ⚠️ Rode o front ANTES: com a coluna fora, o INSERT do painel do Negócio passa
-- a mandar campo inexistente. O `useCreateLeadComment` tem fallback para esse
-- caso (repete o INSERT sem a coluna quando o Postgres devolve 42703/PGRST204),
-- então comentar continua funcionando — mas cada comentário custa duas idas ao
-- banco até o front voltar atrás.

DROP TRIGGER IF EXISTS trg_lead_comment_entry_coerente ON public.lead_comments;

DROP FUNCTION IF EXISTS public.fn_lead_comment_entry_coerente();

DROP INDEX IF EXISTS public.idx_lead_comments_pipeline_entry;

ALTER TABLE public.lead_comments
  DROP CONSTRAINT IF EXISTS lead_comments_pipeline_entry_id_fkey;

-- ⚠️ Aqui o dado morre. `DROP COLUMN` exige aprovação do CTO (regra do
-- supabase/migrations/CLAUDE.md) — deixe comentado até haver a autorização, e
-- prefira parar nos passos acima, que já desligam a feature sem perder nada.
-- ALTER TABLE public.lead_comments DROP COLUMN IF EXISTS pipeline_entry_id;
