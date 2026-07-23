-- ADR-0014 / #906 — "Subir planilha" blast source.
--
-- Leads created from an uploaded spreadsheet carry origin = 'disparo_planilha'
-- so they are distinguishable from organic WhatsApp / ads / cal ingest. The
-- lead_origin enum gains the value here; the disparo-planilha-create edge
-- function inserts it.
--
-- ADD VALUE is safe inside a migration transaction on PG12+ as long as the new
-- value is not USED in the same transaction (it is not — only declared here).
ALTER TYPE lead_origin ADD VALUE IF NOT EXISTS 'disparo_planilha';
