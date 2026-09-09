-- ═══════════════════════════════════════════════════════════════════════════
-- APPLY 1721+1722 — LEDGER e COMMIT.
--
-- Migration aplicada fora do ledger é migration que o próximo `db push` tenta
-- reaplicar, e cujo apply ninguém consegue datar depois. Escrever o ledger é
-- parte do apply, não etapa seguinte — por isso mora DENTRO da mesma transação:
-- ou entram o schema e o registro, ou não entra nada.
--
-- Forma da linha copiada da prática vigente em prod, medida em 2026-08-24: as
-- linhas recentes têm statements, created_by, idempotency_key e rollback NULL.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20270823000000', 'blast_recipient_delivery_state'),
  ('20270824000000', 'blast_official_worker');

-- O ledger tem de conter exatamente as duas, uma vez cada.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM supabase_migrations.schema_migrations
   WHERE version IN ('20270823000000', '20270824000000');
  IF n <> 2 THEN
    RAISE EXCEPTION 'LEDGER FALHOU: esperava 2 linhas, encontrei %', n;
  END IF;
  RAISE NOTICE 'ledger OK: as duas versões registradas';
END $$;

-- ─── RELATÓRIO ─────────────────────────────────────────────────────────────
SELECT
  'APPLY 1721+1722 — vai COMMITAR'                    AS resultado,
  (SELECT planos        FROM _antes)                  AS planos,
  (SELECT destinatarios FROM _antes)                  AS destinatarios,
  (SELECT pendentes     FROM _antes)                  AS pendentes,
  (SELECT count(*) FROM supabase_migrations.schema_migrations) AS ledger_total;

COMMIT;
