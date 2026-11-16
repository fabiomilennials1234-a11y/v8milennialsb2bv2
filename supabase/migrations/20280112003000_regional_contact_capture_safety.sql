-- Customers may provide city, UF and CNPJ in separate WhatsApp messages.
-- A conversational word such as "se" must not overwrite the UF with Sergipe.
CREATE OR REPLACE FUNCTION private.regional_capture_contact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.regional_sales_config%ROWTYPE; normalized text; state_codes text[]; city text; cities text[]; taxes text[]; tax text; f record; val text; lookup_uf text;
BEGIN
 IF NEW.direction<>'incoming' OR NEW.lead_id IS NULL OR coalesce(NEW.is_group,false) OR nullif(NEW.content,'') IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM private.regional_sales_config WHERE organization_id=NEW.organization_id AND instance_id=NEW.instance_id AND routing_enabled;
 IF NOT FOUND OR coalesce(NEW.timestamp,NEW.created_at)<c.enabled_at OR coalesce(NEW.timestamp,NEW.created_at)<now()-interval '10 minutes' OR coalesce(NEW.timestamp,NEW.created_at)>now()+interval '5 minutes' THEN RETURN NEW; END IF;
 normalized:=private.regional_normalize(NEW.content);
 SELECT array_agg(DISTINCT upper(m[1])) INTO state_codes FROM regexp_matches(normalized,'\m(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\M','g') m
 WHERE normalized=m[1] OR NEW.content ~ ('\m'||upper(m[1])||'\M')
   OR EXISTS(SELECT 1 FROM private.regional_sales_cities ci WHERE ci.uf=upper(m[1]) AND strpos(' '||normalized||' ',' '||ci.city_key||' ')>0);
 lookup_uf:=CASE WHEN cardinality(state_codes)=1 THEN state_codes[1] ELSE private.regional_contact_data(NEW.lead_id)->>'uf' END;
 SELECT array_agg(DISTINCT ci.name) INTO cities FROM private.regional_sales_cities ci
 WHERE (nullif(lookup_uf,'') IS NULL OR ci.uf=upper(lookup_uf)) AND strpos(' '||normalized||' ',' '||ci.city_key||' ')>0
 AND NOT EXISTS(SELECT 1 FROM private.regional_sales_cities longer WHERE longer.uf=ci.uf AND length(longer.city_key)>length(ci.city_key) AND strpos(' '||longer.city_key||' ',' '||ci.city_key||' ')>0 AND strpos(' '||normalized||' ',' '||longer.city_key||' ')>0);
 IF cardinality(cities)=1 THEN city:=cities[1]; END IF;
 SELECT array_agg(DISTINCT m[1]) INTO taxes FROM regexp_matches(upper(NEW.content),'\m([A-Z0-9]{2}[.]?[A-Z0-9]{3}[.]?[A-Z0-9]{3}[/]?[A-Z0-9]{4}[-]?[0-9]{2})\M','g') m WHERE private.regional_valid_cnpj(m[1]);
 IF cardinality(taxes)=1 THEN tax:=taxes[1]; END IF;
 FOR f IN SELECT id,field_name FROM public.lead_custom_fields WHERE organization_id=NEW.organization_id AND field_name IN ('cidade','jrtex_estado','cnpj') LOOP
   val:=CASE f.field_name WHEN 'cidade' THEN city WHEN 'jrtex_estado' THEN CASE WHEN cardinality(state_codes)=1 THEN state_codes[1] END WHEN 'cnpj' THEN tax END;
   IF val IS NOT NULL THEN
     INSERT INTO public.lead_custom_field_values(lead_id,field_id,value) VALUES(NEW.lead_id,f.id,val)
     ON CONFLICT(lead_id,field_id) DO UPDATE SET value=EXCLUDED.value,updated_at=now();
   END IF;
 END LOOP;
 PERFORM private.regional_assign(NEW.lead_id);
 RETURN NEW;
END $$;
