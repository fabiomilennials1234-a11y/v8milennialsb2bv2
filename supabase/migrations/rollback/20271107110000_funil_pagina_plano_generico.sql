-- rollback/20271107110000_funil_pagina_plano_generico.sql
--
-- Devolve as duas funções ao `plan_cache_mode` herdado da sessão (`auto`).
-- RESET remove só essa entrada do proconfig; `search_path=''`, corpo e ACL
-- ficam como estão.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamp with time zone,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,text[],text[],boolean,text[],text[],integer,integer,uuid)
  RESET plan_cache_mode;

ALTER FUNCTION public.get_pipeline_stage_counts_by_id(uuid,uuid,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,text[],text[],boolean,text[],text[],integer,integer)
  RESET plan_cache_mode;

COMMIT;
