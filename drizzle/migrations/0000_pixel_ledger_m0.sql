
CREATE TABLE public.ledgers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
  type text NOT NULL DEFAULT 'daily' CHECK (type IN ('daily','travel')),
  base_currency char(3) NOT NULL DEFAULT 'TWD' CHECK (base_currency ~ '^[A-Z]{3}$'),
  timezone text NOT NULL DEFAULT 'Asia/Taipei',
  start_date date,
  end_date date,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledgers_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT ledgers_dates_check CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT ledgers_default_is_daily CHECK (NOT is_default OR type = 'daily')
);
CREATE UNIQUE INDEX ledgers_one_default_per_user ON public.ledgers(user_id) WHERE is_default;
CREATE INDEX ledgers_user_idx ON public.ledgers(user_id);

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT categories_user_name_unique UNIQUE (user_id, name)
);

CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_methods_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT payment_methods_user_name_unique UNIQUE (user_id, name)
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  ledger_id uuid NOT NULL,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 100),
  category_id uuid NOT NULL,
  payment_method_id uuid NOT NULL,
  original_amount numeric(18,2) NOT NULL CHECK (original_amount > 0),
  original_currency char(3) NOT NULL DEFAULT 'TWD' CHECK (original_currency ~ '^[A-Z]{3}$'),
  amount_twd numeric(18,2) NOT NULL CHECK (amount_twd > 0),
  exchange_rate_to_twd numeric(20,10) NOT NULL DEFAULT 1 CHECK (exchange_rate_to_twd > 0),
  occurred_at timestamptz NOT NULL,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- M0: TWD only. Drop this constraint when travel/KRW conversion ships.
  CONSTRAINT transactions_m0_twd_only CHECK (original_currency = 'TWD' AND exchange_rate_to_twd = 1 AND amount_twd = original_amount),
  CONSTRAINT transactions_ledger_owner_fk FOREIGN KEY (ledger_id, user_id) REFERENCES public.ledgers(id, user_id) ON DELETE CASCADE,
  CONSTRAINT transactions_category_owner_fk FOREIGN KEY (category_id, user_id) REFERENCES public.categories(id, user_id) ON DELETE RESTRICT,
  CONSTRAINT transactions_payment_owner_fk FOREIGN KEY (payment_method_id, user_id) REFERENCES public.payment_methods(id, user_id) ON DELETE RESTRICT
);
CREATE INDEX transactions_ledger_time_idx ON public.transactions(user_id, ledger_id, occurred_at DESC);
CREATE INDEX transactions_category_idx ON public.transactions(category_id, user_id);
CREATE INDEX transactions_payment_idx ON public.transactions(payment_method_id, user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledgers, public.categories, public.payment_methods, public.transactions TO authenticated;
GRANT ALL ON public.ledgers, public.categories, public.payment_methods, public.transactions TO service_role;

ALTER TABLE public.ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledgers','categories','payment_methods','transactions'] LOOP
    EXECUTE format('CREATE POLICY "own_select" ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid())', t);
    EXECUTE format('CREATE POLICY "own_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())', t);
    EXECUTE format('CREATE POLICY "own_update" ON public.%I FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t);
    EXECUTE format('CREATE POLICY "own_delete" ON public.%I FOR DELETE TO authenticated USING (user_id = auth.uid())', t);
  END LOOP;
END $$;

-- default ledger cannot be deleted
CREATE POLICY "no_delete_default" ON public.ledgers AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT is_default);

CREATE OR REPLACE FUNCTION public.validate_ledger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'invalid timezone: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_default <> NEW.is_default THEN
    RAISE EXCEPTION 'is_default cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledgers_validate BEFORE INSERT OR UPDATE ON public.ledgers FOR EACH ROW EXECUTE FUNCTION public.validate_ledger();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Idempotent default provisioning
CREATE OR REPLACE FUNCTION public.provision_user_defaults(_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ledgers(user_id, name, type, base_currency, timezone, is_default)
  VALUES (_uid, '日常生活', 'daily', 'TWD', 'Asia/Taipei', true)
  ON CONFLICT (user_id) WHERE is_default DO NOTHING;
  INSERT INTO public.categories(user_id, name)
  SELECT _uid, n FROM unnest(ARRAY['餐飲','交通','購物','娛樂','生活用品','帳單','住宿','健康','其他']) n
  ON CONFLICT (user_id, name) DO NOTHING;
  INSERT INTO public.payment_methods(user_id, name)
  SELECT _uid, n FROM unnest(ARRAY['現金','信用卡','金融卡','行動支付','轉帳','其他']) n
  ON CONFLICT (user_id, name) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.provision_user_defaults(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ensure_my_defaults()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledgers WHERE user_id = auth.uid() AND is_default) THEN
    PERFORM public.provision_user_defaults(auth.uid());
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.ensure_my_defaults() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_defaults() TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.provision_user_defaults(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Report aggregation in ledger timezone. Local dates [p_from, p_to] inclusive.
-- Money returned as text to avoid float conversion in clients.
CREATE OR REPLACE FUNCTION public.ledger_report(p_ledger uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE tz text; s timestamptz; e timestamptz; result jsonb;
BEGIN
  SELECT timezone INTO tz FROM public.ledgers WHERE id = p_ledger AND user_id = auth.uid();
  IF tz IS NULL THEN RAISE EXCEPTION 'ledger not found'; END IF;
  IF p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'invalid range'; END IF;
  s := (p_from::timestamp) AT TIME ZONE tz;
  e := ((p_to + 1)::timestamp) AT TIME ZONE tz;
  WITH t AS (
    SELECT * FROM public.transactions
    WHERE ledger_id = p_ledger AND user_id = auth.uid() AND occurred_at >= s AND occurred_at < e
  )
  SELECT jsonb_build_object(
    'total', (SELECT COALESCE(SUM(amount_twd),0)::text FROM t),
    'count', (SELECT count(*) FROM t),
    'by_category', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'total',x.total::text,'count',x.cnt) ORDER BY x.total DESC)
        FROM (SELECT category_id, SUM(amount_twd) total, count(*) cnt FROM t GROUP BY category_id) x JOIN public.categories c ON c.id = x.category_id), '[]'::jsonb),
    'by_payment', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'total',x.total::text,'count',x.cnt) ORDER BY x.total DESC)
        FROM (SELECT payment_method_id, SUM(amount_twd) total, count(*) cnt FROM t GROUP BY payment_method_id) x JOIN public.payment_methods p ON p.id = x.payment_method_id), '[]'::jsonb),
    'by_day', (SELECT jsonb_agg(jsonb_build_object('date', d::date::text, 'total', COALESCE(x.total,0)::text, 'count', COALESCE(x.cnt,0)) ORDER BY d)
        FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
        LEFT JOIN (SELECT (occurred_at AT TIME ZONE tz)::date ld, SUM(amount_twd) total, count(*) cnt FROM t GROUP BY 1) x ON x.ld = d::date)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ledger_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_report(uuid, date, date) TO authenticated;
