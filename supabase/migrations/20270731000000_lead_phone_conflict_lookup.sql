-- 20270731000000_lead_phone_conflict_lookup.sql
--
-- PROBLEMA (Grafica Cauta, 31/07): cadastrar lead novo devolve na tela
-- "duplicate key value violates unique constraint idx_leads_org_phone_unique",
-- sem dizer QUAL lead segura o número. O usuário procura pelo número, não acha
-- (o lead pode estar na lixeira, ou com outro vendedor que a RLS esconde) e fica
-- sem saída.
--
-- Esta migration NÃO muda a regra de duplicidade. Ela só dá ao front como
-- responder "quem está com este telefone?", para trocar o erro cru do Postgres
-- por uma mensagem acionável. O bloqueio continua sendo, exatamente como hoje:
--
--   idx_leads_org_phone_unique ON leads (organization_id, normalized_phone)
--     WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL
--
-- POR QUE SOMENTE ISSO. A causa de fundo é que `normalize_brazilian_phone()`
-- insere um "9" em TODO número de 10 dígitos, inclusive fixo: o fixo
-- (19) 3527-0422 vira `19935270422`, que é a forma do celular (19) 93527-0422 —
-- e um passa a bloquear o outro. Consertar isso exige escolher entre duas
-- cirurgias (corrigir a normalização na raiz, com backfill; ou separar a chave
-- de dedup da chave de mensageria, o que quebra a unicidade de que o
-- roteamento de mensagem/IA depende). Nenhuma das duas cabe aqui, e ambas
-- ficaram registradas como decisão pendente. Esta migration é deliberadamente
-- do tamanho do sintoma: é aditiva, não dropa nem cria índice, e é revertível
-- com um DROP FUNCTION.

-- ---------------------------------------------------------------------------
-- "Este telefone já está ocupado nesta org?" — sem revelar por quem.
-- ---------------------------------------------------------------------------
-- O front já consulta `leads` direto para identificar o lead em conflito, e
-- essa consulta passa pela RLS — se o usuário pode ver o lead, ele recebe nome
-- e empresa e resolve sozinho. O buraco é o outro caso: a RLS de `leads` é
-- escopada por responsabilidade (`leads_select_by_responsibility_and_permissions`)
-- enquanto o índice único é global na org, então um vendedor pode apanhar de um
-- lead que ele não enxerga e não ter como descobrir o motivo.
--
-- Esta função cobre só esse caso, e devolve o MÍNIMO: dois booleanos. Nenhum
-- nome, nenhuma empresa, nenhum responsável — quem não pode ver o lead continua
-- não podendo, e a função não vira oráculo de enumeração de carteira alheia.
-- O SECURITY DEFINER existe para poder responder "sim, existe" sobre uma linha
-- invisível ao chamador; o gate de tenancy abaixo é o que limita esse poder.
CREATE OR REPLACE FUNCTION public.lead_phone_is_taken(
  p_organization_id uuid,
  p_phone text
)
RETURNS TABLE (
  taken boolean,
  in_trash boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.organization_id = p_organization_id
        AND l.normalized_phone = public.normalize_brazilian_phone(p_phone)
        AND l.deleted_at IS NULL
    ),
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.organization_id = p_organization_id
        AND l.normalized_phone = public.normalize_brazilian_phone(p_phone)
        AND l.deleted_at IS NOT NULL
    )
  -- Sem telefone normalizável não há o que responder; e o SECURITY DEFINER
  -- bypassa a RLS, então o pertencimento à org é checado aqui, explicitamente.
  -- Falhando qualquer um dos dois, a função devolve ZERO linhas (não `false`):
  -- o front distingue "não há conflito" de "não sei responder".
  WHERE public.normalize_brazilian_phone(p_phone) IS NOT NULL
    AND (
      public.is_master_user()
      OR p_organization_id IN (SELECT public.get_my_organization_ids())
    );
$$;

COMMENT ON FUNCTION public.lead_phone_is_taken(uuid, text) IS
  'Responde se o telefone já ocupa um lead da org (ativo e/ou na lixeira), sem '
  'expor qual. Serve para o front explicar o bloqueio de duplicidade quando a '
  'RLS esconde do usuário o lead em conflito. Casa pela MESMA chave do índice '
  'único idx_leads_org_phone_unique: leads.normalized_phone.';

REVOKE ALL ON FUNCTION public.lead_phone_is_taken(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lead_phone_is_taken(uuid, text) TO authenticated;
