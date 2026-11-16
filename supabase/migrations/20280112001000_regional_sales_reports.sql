-- Scoped reports reuse the existing Metrics Studio and its XLSX exporter.
-- Configuration is private: a browser cannot grant itself a reporting scope.
CREATE TABLE IF NOT EXISTS private.regional_sales_config (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  pipeline_ids uuid[] NOT NULL CHECK (cardinality(pipeline_ids) > 0),
  report_user_ids uuid[] NOT NULL DEFAULT '{}',
  triage_member_id uuid NOT NULL REFERENCES public.team_members(id),
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  work_start time NOT NULL DEFAULT '08:00',
  work_end time NOT NULL DEFAULT '18:00',
  break_start time DEFAULT '12:00',
  break_end time DEFAULT '13:00',
  work_days integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  response_minutes integer NOT NULL DEFAULT 180 CHECK (response_minutes > 0),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_end > work_start)
);
ALTER TABLE private.regional_sales_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.regional_sales_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.regional_sales_config TO service_role;

CREATE OR REPLACE FUNCTION private.regional_reports_allowed(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM private.regional_sales_config c JOIN public.team_members t ON t.organization_id=c.organization_id
   WHERE c.organization_id=p_org AND t.user_id=auth.uid() AND t.is_active AND t.user_id=ANY(c.report_user_ids))
$$;
REVOKE ALL ON FUNCTION private.regional_reports_allowed(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.regional_reports_allowed(uuid) TO authenticated,service_role;
CREATE POLICY regional_sales_reports_read_scope ON public.metrics_studio_panels AS RESTRICTIVE FOR SELECT TO authenticated
USING (template_key IS DISTINCT FROM 'regional-sales' OR private.regional_reports_allowed(organization_id));

CREATE OR REPLACE FUNCTION private.regional_sales_metric(
  p_org_id uuid, p_measure_ref jsonb, p_recorte text, p_period text,
  p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c private.regional_sales_config%ROWTYPE;
  v_ids uuid[]; v_bounds tstzrange; v_id text; v_kind text;
  v_result jsonb; v_num jsonb; v_den jsonb; v_unit text; v_anchor text;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  SELECT * INTO c FROM private.regional_sales_config WHERE organization_id = p_org_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT (auth.uid() = ANY(c.report_user_ids))
    OR NOT EXISTS (SELECT 1 FROM public.team_members t WHERE t.organization_id = p_org_id
      AND t.user_id = auth.uid() AND t.is_active) THEN
    RAISE EXCEPTION 'Relatórios restritos à gestão autorizada' USING ERRCODE = '42501';
  END IF;
  -- Always intersect configured pipelines with the caller's group, on the server.
  SELECT array_agg(p.id) INTO v_ids FROM public.pipelines p
    WHERE p.organization_id = p_org_id AND p.id = ANY(c.pipeline_ids)
      AND (NOT private.jrtex_pipeline_scoped() OR p.id = ANY(private.jrtex_visible_pipeline_ids()));
  IF coalesce(cardinality(v_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Nenhum funil autorizado para este relatório' USING ERRCODE = '42501';
  END IF;
  p_filters := coalesce(p_filters, '{}'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_filters) k WHERE k NOT IN ('pipeline_id','member_id','origin','stream')) THEN
    RAISE EXCEPTION 'Filtro não disponível neste relatório' USING ERRCODE = '22023';
  END IF;
  IF p_filters->>'pipeline_id' IS NOT NULL THEN
    IF NOT ((p_filters->>'pipeline_id')::uuid = ANY(v_ids)) THEN
      RAISE EXCEPTION 'Funil fora do grupo autorizado' USING ERRCODE = '42501';
    END IF;
    v_ids := ARRAY[(p_filters->>'pipeline_id')::uuid];
  END IF;
  IF p_filters->>'member_id' IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.team_members WHERE id = (p_filters->>'member_id')::uuid AND organization_id = p_org_id
  ) THEN RAISE EXCEPTION 'Representante fora da organização' USING ERRCODE = '42501'; END IF;
  v_kind := coalesce(p_measure_ref->>'kind', 'leaf');
  IF v_kind = 'ratio' THEN
    v_num := private.regional_sales_metric(p_org_id,jsonb_build_object('kind','leaf','id',p_measure_ref->>'num'),'total',p_period,p_ref,p_start,p_end,p_filters);
    v_den := private.regional_sales_metric(p_org_id,jsonb_build_object('kind','leaf','id',p_measure_ref->>'den'),'total',p_period,p_ref,p_start,p_end,p_filters);
    v_unit := CASE WHEN v_num->>'unit' = 'currency' THEN 'currency' ELSE 'percent' END;
    RETURN jsonb_build_object('kind','ratio','unit',v_unit,'currency',CASE WHEN v_unit='currency' THEN 'BRL' END,
      'value', CASE WHEN (v_den->>'value')::numeric > 0 THEN round((v_num->>'value')::numeric / (v_den->>'value')::numeric * CASE WHEN v_unit='percent' THEN 100 ELSE 1 END,2) END,
      'series',NULL,'target',NULL,'empty_reason',CASE WHEN coalesce((v_den->>'value')::numeric,0)=0 THEN 'no_rows' END,
      'provenance',jsonb_build_object('note','Somente funis comerciais autorizados'));
  ELSIF v_kind <> 'leaf' THEN
    RAISE EXCEPTION 'Tipo de indicador não disponível neste relatório' USING ERRCODE = '22023';
  END IF;
  v_id := p_measure_ref->>'id';
  IF v_id NOT IN ('receita','num_vendas','num_vendas_pre_venda','leads_criados','negocios_perdidos','reunioes_marcadas','reunioes_realizadas','negocios_abertos')
    OR v_id IS NULL OR p_recorte NOT IN ('total','closer','sdr','origem','pipeline','tempo','stream') OR p_recorte IS NULL THEN
    RAISE EXCEPTION 'Indicador ou recorte não disponível neste relatório' USING ERRCODE = '22023';
  END IF;
  v_bounds := public.metric_period_bounds(p_org_id,p_period,p_ref,p_start,p_end);
  v_unit := CASE WHEN v_id='receita' THEN 'currency' ELSE 'count' END;
  v_anchor := CASE WHEN v_id='negocios_abertos' THEN 'hoje' WHEN v_id IN ('receita','num_vendas','num_vendas_pre_venda','negocios_perdidos') THEN 'fechamentos' ELSE 'entradas' END;
  WITH scoped_leads AS (
    SELECT l.* FROM public.leads l WHERE l.organization_id=p_org_id AND l.deleted_at IS NULL
      AND NOT coalesce(l.is_shadow,false) AND NOT coalesce(l.excluded_from_metrics,false)
      AND EXISTS (SELECT 1 FROM public.pipeline_entries e WHERE e.organization_id=p_org_id AND e.lead_id=l.id AND e.pipeline_id=ANY(v_ids))
  ), events AS (
    SELECT s.lead_id, s.pipeline_id, s.sale_responsible_id AS closer, s.pre_sale_responsible_id AS sdr,
      l.origin, s.sold_at AS occurred_at, s.revenue_stream AS stream,
      CASE WHEN v_id='receita' THEN coalesce(s.sale_value,0) ELSE 1 END::numeric AS amount
    FROM public.sale_events s LEFT JOIN public.leads l ON l.id=s.lead_id AND l.organization_id=p_org_id
    WHERE v_id IN ('receita','num_vendas','num_vendas_pre_venda','negocios_perdidos')
      AND s.organization_id=p_org_id AND s.pipeline_id=ANY(v_ids) AND s.sold_at <@ v_bounds
      AND s.event_type=CASE WHEN v_id='negocios_perdidos' THEN 'sale_lost' ELSE 'sale' END
      AND (v_id <> 'num_vendas_pre_venda' OR s.pre_sale_responsible_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.organization_id=p_org_id AND r.reversed_event_id=s.id AND r.event_type IN ('sale_reversed','sale_lost_reversed'))
    UNION ALL
    SELECT l.id, NULL::uuid,coalesce(l.sale_responsible_id,l.closer_id),coalesce(l.pre_sale_responsible_id,l.sdr_id),l.origin,coalesce(l.metrics_period_at,l.created_at),NULL::text,1::numeric
    FROM scoped_leads l WHERE v_id='leads_criados' AND coalesce(l.metrics_period_at,l.created_at) <@ v_bounds
    UNION ALL
    SELECT m.lead_id,e.pipeline_id,l.sale_responsible_id,m.pre_sale_responsible_id,l.origin,
      CASE WHEN v_id='reunioes_realizadas' THEN coalesce(m.meeting_date,m.occurred_at) ELSE m.occurred_at END,NULL::text,1::numeric
    FROM public.meeting_events m JOIN public.leads l ON l.id=m.lead_id AND l.organization_id=p_org_id
    JOIN public.pipeline_entries e ON e.id=m.source_entry_id AND e.organization_id=p_org_id AND e.pipeline_id=ANY(v_ids)
    WHERE v_id IN ('reunioes_marcadas','reunioes_realizadas') AND m.organization_id=p_org_id
      AND m.event_type=CASE WHEN v_id='reunioes_realizadas' THEN 'meeting_held' ELSE 'meeting_booked' END
      AND (CASE WHEN v_id='reunioes_realizadas' THEN coalesce(m.meeting_date,m.occurred_at) ELSE m.occurred_at END) <@ v_bounds
    UNION ALL
    SELECT d.source_lead_id,e.pipeline_id,d.owner_id,l.pre_sale_responsible_id,l.origin,d.created_at,NULL::text,1::numeric
    FROM public.deals d JOIN LATERAL (SELECT pe.pipeline_id FROM public.pipeline_entries pe WHERE pe.organization_id=p_org_id AND pe.deal_id=d.id AND pe.pipeline_id=ANY(v_ids) ORDER BY pe.entered_at DESC LIMIT 1) e ON true
    LEFT JOIN public.leads l ON l.id=d.source_lead_id AND l.organization_id=p_org_id
    WHERE v_id='negocios_abertos' AND d.organization_id=p_org_id AND d.deleted_at IS NULL AND d.outcome IS NULL
  ), filtered AS (
    SELECT * FROM events WHERE (p_filters->>'member_id' IS NULL OR closer=(p_filters->>'member_id')::uuid OR (v_id IN ('leads_criados','reunioes_marcadas','reunioes_realizadas') AND sdr=(p_filters->>'member_id')::uuid))
      AND (p_filters->>'origin' IS NULL OR origin=p_filters->>'origin')
      AND (p_filters->>'stream' IS NULL OR stream=p_filters->>'stream')
  ), grouped AS (
    SELECT CASE p_recorte WHEN 'closer' THEN closer::text WHEN 'sdr' THEN sdr::text WHEN 'origem' THEN origin
      WHEN 'pipeline' THEN pipeline_id::text WHEN 'tempo' THEN to_char(occurred_at AT TIME ZONE c.timezone,'YYYY-MM-DD') WHEN 'stream' THEN stream ELSE 'total' END key,
      sum(amount) amount FROM filtered GROUP BY 1
  ) SELECT jsonb_build_object('value',CASE WHEN p_recorte='total' THEN coalesce((SELECT sum(amount) FROM filtered),0) END,
    'series',CASE WHEN p_recorte<>'total' THEN coalesce((SELECT jsonb_agg(jsonb_build_object('key',g.key,'value',g.amount,
      'label',coalesce(CASE WHEN p_recorte IN ('closer','sdr') THEN (SELECT t.name FROM public.team_members t WHERE t.organization_id=p_org_id AND t.id=g.key::uuid)
        WHEN p_recorte='pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.organization_id=p_org_id AND p.id=g.key::uuid) ELSE g.key END,'Não informado')) ORDER BY g.amount DESC,g.key) FROM grouped g),'[]'::jsonb) END,
    'empty_reason',CASE WHEN NOT EXISTS(SELECT 1 FROM filtered) THEN 'no_rows' END) INTO v_result;
  RETURN v_result || jsonb_build_object('kind','leaf','measure_id',v_id,'unit',v_unit,'currency',CASE WHEN v_unit='currency' THEN 'BRL' END,
    'anchor',v_anchor,'recorte',p_recorte,'target',NULL,'provenance',jsonb_build_object('note','Somente funis comerciais autorizados'));
END $$;
REVOKE ALL ON FUNCTION private.regional_sales_metric(uuid,jsonb,text,text,date,date,date,jsonb) FROM PUBLIC,anon,authenticated;

-- Preserve the live engine body and ACLs; change only its scoped-account branch.
DO $migration$
DECLARE d text; old_guard text := E'  IF private.jrtex_pipeline_scoped() THEN\n    RAISE EXCEPTION ''Acesso restrito aos funis do seu grupo'' USING ERRCODE = ''42501'';\n  END IF;';
BEGIN
  IF to_regprocedure('private.jrtex_pipeline_scoped()') IS NULL THEN
    RAISE NOTICE 'No scoped-account engine installed; leaving the standard engine unchanged';
    RETURN;
  END IF;
  d := pg_get_functiondef('public.fn_metric_measure(uuid,jsonb,text,text,date,date,date,jsonb)'::regprocedure);
  IF position('RETURN private.regional_sales_metric(' IN d)>0 THEN RETURN; END IF;
  IF position(old_guard IN d)=0 THEN
    RAISE EXCEPTION 'Expected scoped-report guard is missing; review live engine before applying';
  END IF;
  EXECUTE replace(d,old_guard,E'  IF private.jrtex_pipeline_scoped() THEN\n    RETURN private.regional_sales_metric(p_org_id,p_measure_ref,p_recorte,p_period,p_ref,p_start,p_end,p_filters);\n  END IF;');
END $migration$;
NOTIFY pgrst, 'reload schema';
