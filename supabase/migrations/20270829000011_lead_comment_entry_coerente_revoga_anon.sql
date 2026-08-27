-- Tira o EXECUTE de `anon` em `fn_lead_comment_entry_coerente()`.
--
-- ── O que aconteceu ───────────────────────────────────────────────────────
-- A `20270829000001` criou a função com `REVOKE ALL ... FROM PUBLIC`, copiando
-- o bloco de grants das duas funções-gatilho irmãs da mesma tabela. Medido em
-- prod depois do apply, `has_function_privilege('anon', …)` voltou **true** —
-- enquanto a irmã `fn_log_lead_comment_event` está **false**.
--
-- A causa é a armadilha que o rubric de segurança documenta: o EXECUTE chega
-- por DOIS caminhos independentes, e revogar um não mexe no outro.
--   1. herança de `PUBLIC` — é o que o `REVOKE ... FROM PUBLIC` cobre;
--   2. **grant nominal a `anon`**, concedido pelo `ALTER DEFAULT PRIVILEGES`
--      do schema `public` no momento do `CREATE FUNCTION`.
-- O `REVOKE FROM PUBLIC` não toca no (2). Só um `REVOKE ... FROM anon`
-- explícito fecha.
--
-- ── Por que NÃO era explorável, e por que ainda assim se conserta ─────────
-- `prorettype` é `trigger` (medido), e o Postgres recusa chamada direta a
-- função que retorna `trigger` com `0A000: trigger functions can only be
-- called as triggers`. Nenhum grant torna isso chamável — o buraco era
-- nominal, não um caminho de dado.
--
-- Conserta-se assim mesmo por duas razões: a postura fica igual à das outras
-- duas funções da tabela (sem exceção para alguém explicar depois), e o dia em
-- que alguém copiar este bloco para uma função `SECURITY DEFINER` que retorna
-- dado, o padrão copiado já vem certo.
--
-- `authenticated` FICA: é quem cria trigger nesta tabela pelas migrations, e é
-- exatamente o que as duas irmãs têm.

REVOKE ALL     ON FUNCTION public.fn_lead_comment_entry_coerente() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_lead_comment_entry_coerente() FROM anon;

GRANT EXECUTE ON FUNCTION public.fn_lead_comment_entry_coerente() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lead_comment_entry_coerente() TO service_role;

-- Gabarito. Fica no ÚLTIMO statement de propósito: a Management API devolve só
-- o resultado dele, então quem aplicar vê a prova em vez de um "OK" mudo.
-- Esperado: anon=false, authenticated=true, service_role=true, e as duas
-- colunas de comparação iguais às da função irmã.
SELECT
  has_function_privilege('anon',          'public.fn_lead_comment_entry_coerente()', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.fn_lead_comment_entry_coerente()', 'EXECUTE') AS authenticated,
  has_function_privilege('service_role',  'public.fn_lead_comment_entry_coerente()', 'EXECUTE') AS service_role,
  has_function_privilege('anon',          'public.fn_log_lead_comment_event()',      'EXECUTE') AS anon_na_irma;
