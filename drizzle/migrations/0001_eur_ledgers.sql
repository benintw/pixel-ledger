-- Apply once after 0000, before deploying the EUR UI or importing foreign records.
-- Existing TWD data and RLS policies remain unchanged.
BEGIN;

ALTER TABLE public.ledgers ADD CONSTRAINT ledgers_supported_currency
  CHECK (base_currency IN ('TWD', 'EUR'));
ALTER TABLE public.transactions DROP CONSTRAINT transactions_m0_twd_only;
ALTER TABLE public.transactions ALTER COLUMN amount_twd DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN exchange_rate_to_twd DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN exchange_rate_to_twd DROP DEFAULT;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_currency_values CHECK (
  (original_currency = 'TWD' AND amount_twd IS NOT NULL
    AND exchange_rate_to_twd IS NOT NULL
    AND exchange_rate_to_twd = 1 AND amount_twd = original_amount)
  OR
  (original_currency = 'EUR' AND amount_twd IS NULL AND exchange_rate_to_twd IS NULL)
);

-- A single-currency ledger prevents mixed totals. Locking also serializes ledger
-- currency changes against inserts/moves. Composite owner FKs remain in place.
CREATE OR REPLACE FUNCTION public.validate_transaction_currency()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE currency text;
BEGIN
  SELECT base_currency INTO currency FROM public.ledgers
  WHERE id = NEW.ledger_id AND user_id = NEW.user_id FOR SHARE;
  IF currency IS NULL OR currency <> NEW.original_currency THEN
    RAISE EXCEPTION '交易幣別必須與所屬帳本相同' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_transaction_currency() FROM PUBLIC, anon;
CREATE TRIGGER transactions_validate_currency BEFORE INSERT OR UPDATE
ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.validate_transaction_currency();

CREATE OR REPLACE FUNCTION public.validate_ledger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'invalid timezone: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_default <> NEW.is_default THEN
    RAISE EXCEPTION 'is_default cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.base_currency <> NEW.base_currency
     AND EXISTS (SELECT 1 FROM public.transactions WHERE ledger_id = OLD.id) THEN
    RAISE EXCEPTION '有交易的帳本不可變更幣別' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.ledger_report(p_ledger uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE tz text; currency text; s timestamptz; e timestamptz; result jsonb;
BEGIN
  SELECT timezone, base_currency INTO tz, currency FROM public.ledgers WHERE id = p_ledger AND user_id = auth.uid();
  IF tz IS NULL THEN RAISE EXCEPTION 'ledger not found'; END IF;
  IF p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'invalid range'; END IF;
  s := (p_from::timestamp) AT TIME ZONE tz;
  e := ((p_to + 1)::timestamp) AT TIME ZONE tz;
  WITH t AS (
    SELECT * FROM public.transactions
    WHERE ledger_id = p_ledger AND user_id = auth.uid() AND occurred_at >= s AND occurred_at < e
  )
  SELECT jsonb_build_object(
    'currency', currency,
    'total', (SELECT COALESCE(SUM(original_amount),0)::text FROM t),
    'count', (SELECT count(*) FROM t),
    'by_category', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'total',x.total::text,'count',x.cnt) ORDER BY x.total DESC)
        FROM (SELECT category_id, SUM(original_amount) total, count(*) cnt FROM t GROUP BY category_id) x JOIN public.categories c ON c.id = x.category_id), '[]'::jsonb),
    'by_payment', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'total',x.total::text,'count',x.cnt) ORDER BY x.total DESC)
        FROM (SELECT payment_method_id, SUM(original_amount) total, count(*) cnt FROM t GROUP BY payment_method_id) x JOIN public.payment_methods p ON p.id = x.payment_method_id), '[]'::jsonb),
    'by_day', (SELECT jsonb_agg(jsonb_build_object('date', d::date::text, 'total', COALESCE(x.total,0)::text, 'count', COALESCE(x.cnt,0)) ORDER BY d)
        FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
        LEFT JOIN (SELECT (occurred_at AT TIME ZONE tz)::date ld, SUM(original_amount) total, count(*) cnt FROM t GROUP BY 1) x ON x.ld = d::date)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ledger_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_report(uuid, date, date) TO authenticated;


NOTIFY pgrst, 'reload schema';
COMMIT;
