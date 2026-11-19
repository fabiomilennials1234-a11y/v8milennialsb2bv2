-- Rollback de 20280121000000_cobranca_importar_responsavel_e_observacoes.sql
-- Volta a importação sem Responsável/Observação por linha (as colunas da planilha são ignoradas).

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.cobranca_importar(p_org uuid, p_linhas jsonb, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_linha      jsonb;
  v_idx        integer := 0;
  v_nome       text;
  v_doc        text;
  v_tel        text;
  v_numero     text;
  v_valor      numeric;
  v_venc       date;
  v_inad       uuid;
  v_tit        uuid;
  v_invalidas  jsonb := '[]'::jsonb;
  v_novos      integer := 0;
  v_existentes integer := 0;
  v_tit_novos  integer := 0;
  v_tit_atual  integer := 0;
  v_casos      integer := 0;
  v_vistos     uuid[] := '{}';
  v_chaves     text[] := '{}';
  v_chave      text;
  v_tit_chave  text;
  v_tit_vistos text[] := '{}';
  v_caso_antes uuid;
BEGIN
  PERFORM private.cobranca_exigir(p_org, 'edit');
  IF jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Formato de importação inválido.' USING ERRCODE = 'PT422', DETAIL = 'linhas_invalidas';
  END IF;
  IF jsonb_array_length(p_linhas) > 2000 THEN
    RAISE EXCEPTION 'Importe no máximo 2.000 linhas por vez.' USING ERRCODE = 'PT422', DETAIL = 'linhas_demais';
  END IF;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_idx := v_idx + 1;
    v_nome   := NULLIF(btrim(v_linha ->> 'nome'), '');
    v_doc    := private.cobranca_so_digitos(v_linha ->> 'documento');
    v_tel    := private.cobranca_so_digitos(v_linha ->> 'telefone');
    v_numero := NULLIF(btrim(v_linha ->> 'numero'), '');

    -- Só ISO: o navegador converte dd/mm/aaaa. Texto cru no ::date seria lido
    -- no DateStyle do servidor (10/11 viraria 11 de outubro) sem erro nenhum.
    IF COALESCE(v_linha ->> 'vencimento', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'vencimento ausente ou ilegível');
      CONTINUE;
    END IF;

    BEGIN
      v_valor := round((v_linha ->> 'valor')::numeric, 2);
      v_venc  := (v_linha ->> 'vencimento')::date;
    EXCEPTION WHEN others THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'valor ou vencimento ilegível');
      CONTINUE;
    END;

    IF v_nome IS NULL THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'sem nome');
      CONTINUE;
    END IF;
    IF v_doc IS NOT NULL AND length(v_doc) NOT IN (11, 14) THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'CPF/CNPJ inválido');
      CONTINUE;
    END IF;
    IF v_tel IS NOT NULL AND length(v_tel) NOT BETWEEN 10 AND 15 THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'telefone inválido');
      CONTINUE;
    END IF;
    IF v_doc IS NULL AND v_tel IS NULL THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'sem CPF/CNPJ e sem telefone');
      CONTINUE;
    END IF;
    IF v_valor IS NULL OR v_valor <= 0 OR v_venc IS NULL THEN
      v_invalidas := v_invalidas || jsonb_build_object('linha', v_idx, 'motivo', 'valor ou vencimento ausente');
      CONTINUE;
    END IF;

    -- Quem é: documento manda; sem ele, telefone.
    v_inad := NULL;
    IF v_doc IS NOT NULL THEN
      SELECT id INTO v_inad FROM public.cobranca_inadimplentes
       WHERE organization_id = p_org AND documento = v_doc AND arquivado_em IS NULL;
    ELSE
      SELECT id INTO v_inad FROM public.cobranca_inadimplentes
       WHERE organization_id = p_org AND telefone = v_tel AND arquivado_em IS NULL
       ORDER BY created_at LIMIT 1;
    END IF;

    v_chave := COALESCE('d:' || v_doc, 't:' || v_tel);
    IF v_inad IS NULL THEN
      IF NOT (v_chave = ANY (v_chaves)) THEN
        v_novos := v_novos + 1;
      END IF;
      IF NOT p_dry_run THEN
        INSERT INTO public.cobranca_inadimplentes
          (organization_id, nome, documento, telefone, email, contato_nome, cidade, origem)
        VALUES
          (p_org, v_nome, v_doc, v_tel, NULLIF(lower(btrim(v_linha ->> 'email')), ''),
           NULLIF(btrim(v_linha ->> 'contato_nome'), ''), NULLIF(btrim(v_linha ->> 'cidade'), ''), 'planilha')
        RETURNING id INTO v_inad;
        PERFORM private.cobranca_evento(p_org, v_inad, NULL, 'inadimplente_criado',
                                        jsonb_build_object('origem', 'planilha'));
      END IF;
    ELSIF NOT (v_inad = ANY (v_vistos)) AND NOT (v_chave = ANY (v_chaves)) THEN
      v_existentes := v_existentes + 1;
    END IF;
    v_chaves := array_append(v_chaves, v_chave);

    -- A mesma linha repetida no arquivo conta uma vez só (vale a primeira).
    v_tit_chave := v_chave || '|' || COALESCE('n:' || v_numero, 'v:' || v_valor || '@' || v_venc);
    IF v_tit_chave = ANY (v_tit_vistos) THEN
      CONTINUE;
    END IF;
    v_tit_vistos := array_append(v_tit_vistos, v_tit_chave);

    -- O título: por número, se houver; sem número, por (valor, vencimento).
    v_tit := NULL;
    IF v_inad IS NOT NULL THEN
      SELECT id INTO v_tit FROM public.cobranca_titulos
       WHERE inadimplente_id = v_inad
         AND ((v_numero IS NOT NULL AND numero = v_numero)
           OR (v_numero IS NULL AND numero IS NULL AND valor = v_valor AND vencimento = v_venc))
       LIMIT 1;
    END IF;

    IF v_tit IS NULL THEN
      v_tit_novos := v_tit_novos + 1;
      IF NOT p_dry_run THEN
        INSERT INTO public.cobranca_titulos
          (organization_id, inadimplente_id, origem, numero, descricao, valor, vencimento)
        VALUES
          (p_org, v_inad, 'planilha', v_numero, NULLIF(btrim(v_linha ->> 'descricao'), ''), v_valor, v_venc);
      END IF;
    ELSE
      -- Planilha nova corrige valor/vencimento de título ainda em aberto.
      IF EXISTS (SELECT 1 FROM public.cobranca_titulos
                  WHERE id = v_tit AND status = 'aberto'
                    AND (valor <> v_valor OR vencimento <> v_venc)) THEN
        v_tit_atual := v_tit_atual + 1;
        IF NOT p_dry_run THEN
          UPDATE public.cobranca_titulos SET valor = v_valor, vencimento = v_venc WHERE id = v_tit;
        END IF;
      END IF;
    END IF;

    IF NOT p_dry_run AND NOT (v_inad = ANY (v_vistos)) THEN
      v_vistos := array_append(v_vistos, v_inad);
    END IF;
  END LOOP;

  IF NOT p_dry_run THEN
    FOREACH v_inad IN ARRAY v_vistos LOOP
      SELECT id INTO v_caso_antes FROM public.cobranca_casos
       WHERE inadimplente_id = v_inad AND encerrado_em IS NULL;
      IF v_caso_antes IS NULL AND private.cobranca_garantir_caso(v_inad) IS NOT NULL THEN
        v_casos := v_casos + 1;
      END IF;
      PERFORM private.cobranca_evento(p_org, v_inad,
        (SELECT id FROM public.cobranca_casos WHERE inadimplente_id = v_inad AND encerrado_em IS NULL),
        'importado', '{}'::jsonb);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'linhas', v_idx,
    'inadimplentes_novos', v_novos,
    'inadimplentes_existentes', v_existentes,
    'titulos_novos', v_tit_novos,
    'titulos_atualizados', v_tit_atual,
    'casos_abertos', v_casos,
    'linhas_invalidas', v_invalidas
  );
END
$fn$;

COMMIT;
