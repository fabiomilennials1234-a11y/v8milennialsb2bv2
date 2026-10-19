-- Rollback do Telefone N:N PR3 passo 1 (20271130000000): remove o indice v2.
-- Statement unico, fora de transacao (DROP INDEX CONCURRENTLY nao roda em BEGIN).
-- Seguro se a 20271130000010 NAO foi aplicada (o indice antigo segue valendo).
-- Se a 20271130000010 ja foi aplicada, o v2 ja nao existe sob esse nome (virou
-- idx_leads_org_phone_unique): reverta a B primeiro. O IF EXISTS torna no-op.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_leads_org_phone_unique_v2;
