-- Synchronize product designations from CSV/PDF imports.
-- Product identity remains product_ref. This function updates name only.

CREATE OR REPLACE FUNCTION public.admin_sync_product_designations(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH incoming AS (
    SELECT DISTINCT ON (upper(trim(x.product_ref)))
      trim(x.product_ref) AS product_ref,
      trim(x.name) AS name
    FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
      AS x(product_ref text, name text)
    WHERE nullif(trim(x.product_ref), '') IS NOT NULL
      AND nullif(trim(x.name), '') IS NOT NULL
    ORDER BY upper(trim(x.product_ref))
  )
  UPDATE public.products p
  SET name = i.name
  FROM incoming i
  WHERE upper(trim(p.product_ref)) = upper(i.product_ref)
    AND p.name IS DISTINCT FROM i.name;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_sync_tapis_product_designations(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH incoming AS (
    SELECT DISTINCT ON (upper(trim(x.product_ref)))
      trim(x.product_ref) AS product_ref,
      trim(x.name) AS name
    FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
      AS x(product_ref text, name text)
    WHERE nullif(trim(x.product_ref), '') IS NOT NULL
      AND nullif(trim(x.name), '') IS NOT NULL
    ORDER BY upper(trim(x.product_ref))
  )
  UPDATE public.tapis_products p
  SET name = i.name
  FROM incoming i
  WHERE upper(trim(p.product_ref)) = upper(i.product_ref)
    AND p.name IS DISTINCT FROM i.name;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_sync_product_designations(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_sync_tapis_product_designations(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_sync_product_designations(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_sync_tapis_product_designations(jsonb) TO authenticated;
