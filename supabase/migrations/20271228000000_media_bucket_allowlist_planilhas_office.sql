-- 20271228000000_media_bucket_allowlist_planilhas_office.sql
--
-- Templates de mensagem (Café Jurerê) precisam enviar planilha, apresentação,
-- CSV e TXT, além de PDF/Word/imagem. O bucket `media` só aceitava PDF, Word e
-- mídia: o upload de `.xlsx` voltava recusado pelo Storage (e o template ficava
-- sem arquivo, como `envaseetiqueta` em prod).
--
-- ADITIVO de propósito: junta os MIME novos ao allowlist que já existe e remove
-- duplicata. Nada é substituído por array literal, porque uma migration anterior
-- (20271211000000) já teve que acrescentar Word sem conseguir ler o valor de prod,
-- e uma substituição literal apagaria tipos que outras telas usam.
--
-- O bucket é GLOBAL (todas as orgs). Isto só libera o que o Storage aceita; quem
-- decide o que a tela oferece é a flag `template_anexos_office` em
-- organizations.feature_flags (hoje só a Café Jurerê). Não libera executável,
-- planilha com macro (.xlsm), HTML nem SVG. file_size_limit (50 MB) não muda.
--
-- Rollback: supabase/migrations/rollback/20271228000000_media_bucket_allowlist_planilhas_office.sql

UPDATE storage.buckets
SET allowed_mime_types = (
  SELECT array_agg(DISTINCT mime ORDER BY mime)
  FROM unnest(
    COALESCE(allowed_mime_types, ARRAY[]::text[]) || ARRAY[
      'application/vnd.ms-excel',                                                    -- .xls
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',            -- .xlsx
      'application/vnd.ms-powerpoint',                                               -- .ppt
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',    -- .pptx
      'text/csv',                                                                    -- .csv
      'text/plain'                                                                   -- .txt
    ]
  ) AS mime
)
WHERE id = 'media'
  AND allowed_mime_types IS NOT NULL;
