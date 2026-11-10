-- Hand-entered KRW→TWD rates. Run once after 0001, before deploying the KRW UI.
BEGIN;
ALTER TABLE public.ledgers DROP CONSTRAINT ledgers_supported_currency;
ALTER TABLE public.ledgers ADD CONSTRAINT ledgers_supported_currency CHECK (base_currency IN ('TWD','EUR','KRW'));
ALTER TABLE public.ledgers ADD COLUMN default_exchange_rate_to_twd numeric(20,10);
ALTER TABLE public.ledgers ADD CONSTRAINT ledgers_manual_rate_check CHECK (
  (base_currency = 'KRW' AND default_exchange_rate_to_twd IS NOT NULL AND default_exchange_rate_to_twd > 0)
  OR (base_currency <> 'KRW' AND default_exchange_rate_to_twd IS NULL)
);
ALTER TABLE public.transactions DROP CONSTRAINT transactions_currency_values;
ALTER TABLE public.transactions DROP CONSTRAINT transactions_amount_twd_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_nonnegative_twd CHECK (amount_twd IS NULL OR amount_twd >= 0);
ALTER TABLE public.transactions ADD CONSTRAINT transactions_currency_values CHECK (
  (original_currency = 'TWD' AND exchange_rate_to_twd IS NOT NULL AND exchange_rate_to_twd = 1 AND amount_twd IS NOT NULL AND amount_twd = original_amount)
  OR (original_currency = 'EUR' AND amount_twd IS NULL AND exchange_rate_to_twd IS NULL)
  OR (original_currency = 'KRW' AND original_amount = trunc(original_amount) AND exchange_rate_to_twd IS NOT NULL
    AND exchange_rate_to_twd > 0 AND amount_twd IS NOT NULL AND amount_twd = round(original_amount * exchange_rate_to_twd, 2))
);

-- Every new KRW transaction snapshots the ledger's current rate. Editing an
-- existing transaction always keeps its saved rate, even after rate changes.
-- Exact numeric arithmetic and rounding happen in PostgreSQL, not JS floats.
CREATE FUNCTION public.apply_krw_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE ledger_currency text; ledger_rate numeric;
BEGIN
  IF NEW.original_currency <> 'KRW' THEN RETURN NEW; END IF;
  SELECT base_currency, default_exchange_rate_to_twd INTO ledger_currency, ledger_rate
  FROM public.ledgers WHERE id = NEW.ledger_id AND user_id = NEW.user_id FOR SHARE;
  IF ledger_currency IS DISTINCT FROM 'KRW' OR ledger_rate IS NULL OR ledger_rate <= 0 THEN
    RAISE EXCEPTION '帳本不存在或尚未設定韓元匯率' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.original_currency = 'KRW' THEN
    IF NEW.ledger_id <> OLD.ledger_id THEN RAISE EXCEPTION '無法將韓元紀錄移至其他帳本' USING ERRCODE = '23514'; END IF;
    NEW.exchange_rate_to_twd := OLD.exchange_rate_to_twd;
  ELSE
    NEW.exchange_rate_to_twd := ledger_rate;
  END IF;
  NEW.amount_twd := round(NEW.original_amount * NEW.exchange_rate_to_twd, 2);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_krw_rate() FROM PUBLIC, anon;
CREATE TRIGGER transactions_apply_krw_rate BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.apply_krw_rate();

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
    'total_twd', CASE WHEN currency = 'EUR' THEN NULL ELSE (SELECT COALESCE(SUM(amount_twd),0)::text FROM t) END,
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


CREATE FUNCTION public.ledger_total(p_ledger uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE currency text; result jsonb;
BEGIN
  SELECT base_currency INTO currency FROM public.ledgers WHERE id = p_ledger AND user_id = auth.uid();
  IF currency IS NULL THEN RAISE EXCEPTION 'ledger not found'; END IF;
  SELECT jsonb_build_object('total', COALESCE(SUM(original_amount),0)::text,
    'total_twd', CASE WHEN currency = 'EUR' THEN NULL ELSE COALESCE(SUM(amount_twd),0)::text END,
    'count', count(*)) INTO result FROM public.transactions
  WHERE ledger_id = p_ledger AND user_id = auth.uid();
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ledger_total(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_total(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
