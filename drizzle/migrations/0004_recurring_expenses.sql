-- Optional supplementary description. Keep old descriptions unchanged.
ALTER TABLE public.transactions DROP CONSTRAINT transactions_description_check;
ALTER TABLE public.transactions ALTER COLUMN description SET DEFAULT '';
ALTER TABLE public.transactions ADD CONSTRAINT transactions_description_check
  CHECK (char_length(btrim(description)) <= 100);

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  ledger_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL CHECK (currency IN ('TWD','EUR','KRW')),
  category_id uuid NOT NULL,
  payment_method_id uuid NOT NULL,
  frequency_months integer NOT NULL CHECK (frequency_months IN (1,12)),
  start_date date NOT NULL,
  next_date date NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,user_id),
  FOREIGN KEY (ledger_id,user_id) REFERENCES public.ledgers(id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (category_id,user_id) REFERENCES public.categories(id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY (payment_method_id,user_id) REFERENCES public.payment_methods(id,user_id) ON DELETE RESTRICT
);
CREATE INDEX recurring_ledger_idx ON public.recurring_expenses(ledger_id,user_id);
CREATE INDEX recurring_category_idx ON public.recurring_expenses(category_id,user_id);
CREATE INDEX recurring_payment_idx ON public.recurring_expenses(payment_method_id,user_id);
CREATE INDEX recurring_due_idx ON public.recurring_expenses(next_date) WHERE enabled;
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_select ON public.recurring_expenses FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
CREATE POLICY own_insert ON public.recurring_expenses FOR INSERT TO authenticated WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY own_update ON public.recurring_expenses FOR UPDATE TO authenticated
  USING (user_id=(SELECT auth.uid())) WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY own_delete ON public.recurring_expenses FOR DELETE TO authenticated USING (user_id=(SELECT auth.uid()));
REVOKE ALL ON public.recurring_expenses FROM anon, authenticated;
GRANT SELECT, DELETE ON public.recurring_expenses TO authenticated;
GRANT INSERT (id,user_id,ledger_id,name,amount,currency,category_id,payment_method_id,frequency_months,start_date,enabled)
  ON public.recurring_expenses TO authenticated;
GRANT UPDATE (enabled) ON public.recurring_expenses TO authenticated;
GRANT ALL ON public.recurring_expenses TO service_role;

ALTER TABLE public.transactions ADD COLUMN recurring_expense_id uuid,
  ADD COLUMN recurring_date date,
  ADD CONSTRAINT transactions_recurring_owner_fk FOREIGN KEY (recurring_expense_id,user_id)
    REFERENCES public.recurring_expenses(id,user_id) ON DELETE SET NULL (recurring_expense_id),
  ADD CONSTRAINT transactions_recurring_once UNIQUE(recurring_expense_id,recurring_date);

-- Retain the original anchor day: Jan 31 -> Feb 28 -> Mar 31.
CREATE FUNCTION private.next_recurring_date(p_date date,p_anchor date,p_months integer)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT (date_trunc('month',p_date)+make_interval(months=>p_months))::date
    + (least(extract(day from p_anchor)::int,
        extract(day from (date_trunc('month',p_date)+make_interval(months=>p_months+1)-interval '1 day'))::int)-1);
$$;
REVOKE ALL ON FUNCTION private.next_recurring_date(date,date,integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.validate_recurring_expense()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE l public.ledgers%ROWTYPE; today date; following date;
BEGIN
  SELECT * INTO l FROM public.ledgers WHERE id=NEW.ledger_id AND user_id=NEW.user_id;
  IF NOT FOUND OR NEW.currency<>l.base_currency THEN
    RAISE EXCEPTION '帳本或幣別不正確。' USING ERRCODE='23514';
  END IF;
  IF NEW.currency='KRW' AND NEW.amount<>trunc(NEW.amount) THEN
    RAISE EXCEPTION '韓元金額必須是整數。' USING ERRCODE='23514';
  END IF;
  today := (now() AT TIME ZONE l.timezone)::date;
  IF TG_OP='INSERT' THEN
    IF NEW.start_date<today OR NEW.start_date>today+3660 THEN
      RAISE EXCEPTION '首次記帳日期請選今天起十年內的日期。' USING ERRCODE='23514';
    END IF;
    NEW.name:=btrim(NEW.name);
    NEW.next_date:=NEW.start_date;
    NEW.last_error:=NULL;
  ELSIF NOT OLD.enabled AND NEW.enabled THEN
    -- Skip paused periods. Resume on the next scheduled date, including today.
    following:=NEW.next_date;
    WHILE following<today LOOP
      -- Inline so the user-facing trigger needs no access to the private schema.
      following:=(date_trunc('month',following)+make_interval(months=>NEW.frequency_months))::date
        +least(extract(day from NEW.start_date)::int,
          extract(day from (date_trunc('month',following)+make_interval(months=>NEW.frequency_months+1)-interval '1 day'))::int)-1;
    END LOOP;
    NEW.next_date:=following;
    NEW.last_error:=NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_recurring_expense() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER recurring_validate BEFORE INSERT OR UPDATE ON public.recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.validate_recurring_expense();

-- A ledger with a schedule cannot silently change currency before its first charge.
CREATE FUNCTION public.protect_recurring_currency()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.base_currency<>NEW.base_currency AND EXISTS
    (SELECT 1 FROM public.recurring_expenses WHERE ledger_id=OLD.id) THEN
    RAISE EXCEPTION '請先停止固定支出，再更改帳本幣別。' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_recurring_currency() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER recurring_currency BEFORE UPDATE OF base_currency ON public.ledgers
  FOR EACH ROW EXECUTE FUNCTION public.protect_recurring_currency();

-- Cron only. No browser-accessible elevated RPC and no secrets needed.
CREATE FUNCTION private.generate_recurring_expenses(p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.recurring_expenses%ROWTYPE; l public.ledgers%ROWTYPE;
  due date; today date; generated integer:=0; caught_up integer;
BEGIN
  FOR r IN SELECT * FROM public.recurring_expenses
    WHERE enabled AND next_date<=(p_now AT TIME ZONE 'Pacific/Kiritimati')::date
    ORDER BY next_date,id LIMIT 500 FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT * INTO STRICT l FROM public.ledgers WHERE id=r.ledger_id AND user_id=r.user_id FOR SHARE;
      today:=(p_now AT TIME ZONE l.timezone)::date;
      due:=r.next_date;
      caught_up:=0;
      WHILE due<=today AND caught_up<120 LOOP
        INSERT INTO public.transactions(user_id,ledger_id,description,category_id,payment_method_id,
          original_amount,original_currency,amount_twd,exchange_rate_to_twd,occurred_at,notes,
          recurring_expense_id,recurring_date)
        VALUES(r.user_id,r.ledger_id,r.name,r.category_id,r.payment_method_id,r.amount,r.currency,
          CASE WHEN r.currency='TWD' THEN r.amount ELSE NULL END,
          CASE WHEN r.currency='TWD' THEN 1 ELSE NULL END,
          due::timestamp AT TIME ZONE l.timezone,'固定支出自動記帳',r.id,due)
        ON CONFLICT (recurring_expense_id,recurring_date) DO NOTHING;
        due:=private.next_recurring_date(due,r.start_date,r.frequency_months);
        caught_up:=caught_up+1;
      END LOOP;
      UPDATE public.recurring_expenses SET next_date=due,last_error=NULL WHERE id=r.id;
      generated:=generated+caught_up;
    EXCEPTION WHEN OTHERS THEN
      -- Roll back this rule's work; one bad rule must not block other owners.
      UPDATE public.recurring_expenses SET last_error='自動記帳失敗，請檢查帳本與匯率，或停止後重新建立。' WHERE id=r.id;
    END;
  END LOOP;
  RETURN generated;
END $$;
REVOKE ALL ON FUNCTION private.generate_recurring_expenses(timestamptz) FROM PUBLIC,anon,authenticated;
