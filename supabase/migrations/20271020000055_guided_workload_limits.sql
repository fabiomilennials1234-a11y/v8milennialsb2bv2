-- Bound one published condition tree and its sequential data-reader workload.
BEGIN;

CREATE FUNCTION public.validate_guided_workload_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public
AS $$
DECLARE
  v_complexity integer;
  v_sequential_readers integer;
BEGIN
  WITH RECURSIVE conditions(condition) AS (
    SELECT node->'data'->'guidedCondition'
    FROM jsonb_array_elements(NEW.definition->'nodes') node
    WHERE node->>'type'='condition'
    UNION ALL
    SELECT child
    FROM conditions
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN conditions.condition->>'kind'='group'
        AND jsonb_typeof(conditions.condition->'children')='array'
      THEN conditions.condition->'children' ELSE '[]'::jsonb END
    ) child
  )
  SELECT
    count(*) + coalesce(sum(CASE
      WHEN condition->>'kind'='business_exists' AND jsonb_typeof(condition->'children')='array'
      THEN jsonb_array_length(condition->'children') ELSE 0 END),0),
    count(*) FILTER (WHERE
      condition->>'field' IN ('message.period.exists','message.waiting.elapsed','activity.follow_up','product.relationship')
      OR (condition->>'field'='message.search.text' AND condition->'source'->>'kind'<>'trigger'))
  INTO v_complexity,v_sequential_readers
  FROM conditions;

  IF v_complexity>100 OR v_sequential_readers>20 THEN
    RAISE EXCEPTION 'invalid_configuration' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_guided_workload_version() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER validate_guided_workload_version
BEFORE INSERT OR UPDATE OF definition ON public.workflow_guided_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_guided_workload_version();

NOTIFY pgrst,'reload schema';
COMMIT;
