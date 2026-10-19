-- 20271127000000_google_calendar_access_token_cache.sql
--
-- Perf onda 2, F5c (RAM 64–93% + pool do PostgREST, 19/10). Uma coluna
-- nullable, nenhuma RLS, grant ou função tocada.
--
-- `_shared/google-calendar-utils.ts#getValidAccessToken` renovava o access
-- token no Google e fazia UPDATE na linha do dono em TODA leitura de agenda —
-- em série por dono no GET de eventos (`google-calendar-events/index.ts`), com
-- disputa de lock na mesma linha. Medido: ~1,7% do tempo do banco, ~64 mil
-- UPDATEs na janela de medição.
--
-- O access token do Google vale ~1 h. A edge fn passa a guardá-lo aqui,
-- CIFRADO com a mesma chave AES-256-GCM do refresh token
-- (`GOOGLE_CALENDAR_ENCRYPTION_KEY`, só no env da edge), no formato
-- `<nonce_b64>.<ciphertext_b64>` de um JSON `{ t, exp, rn }`, e reaproveita
-- até `exp - 5 min`. `rn` é o `encryption_nonce` do refresh token que gerou o
-- access token: a reconexão (callback de OAuth regrava o refresh token com
-- nonce novo) invalida o cache sem precisar tocar nesta coluna.
--
-- Visibilidade: a policy "Users can view own connection status" já expõe a
-- linha (inclusive o refresh token cifrado) ao próprio dono. Esta coluna segue
-- a mesma regra: só o dono lê, e só cifrado — sem a chave da edge, inútil.
--
-- Ordem de deploy indiferente: a edge fn, se subir antes desta migration, cai
-- no UPDATE antigo quando o PostgREST recusa a coluna (PGRST204) e segue
-- renovando a cada leitura, como hoje.

ALTER TABLE public.google_calendar_tokens
  ADD COLUMN IF NOT EXISTS access_token_cache text;

COMMENT ON COLUMN public.google_calendar_tokens.access_token_cache IS
  'Access token do Google cifrado (AES-256-GCM, chave da edge): <nonce_b64>.<ciphertext_b64> de {t,exp,rn}. Reaproveitado até exp-5min; rn amarra ao refresh token vigente. Escrito só por getValidAccessToken.';

-- PostgREST precisa enxergar a coluna nova para o UPDATE da edge fn.
NOTIFY pgrst, 'reload schema';
