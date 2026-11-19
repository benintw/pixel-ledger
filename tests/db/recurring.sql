\set ON_ERROR_STOP on
BEGIN;
-- All fixtures and generated expenses are rolled back, including in cloud checks.
INSERT INTO public.ledgers(id,user_id,name,base_currency,timezone)
VALUES ('ad410001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','固定支出測試','TWD','Asia/Taipei'),
 ('ad410001-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','隔離測試','EUR','Europe/Berlin');
INSERT INTO public.categories(id,user_id,name) VALUES
 ('ad410002-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','固定測試分類'),
 ('ad410002-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','固定測試分類');
INSERT INTO public.payment_methods(id,user_id,name) VALUES
 ('ad410003-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','固定測試付款'),
 ('ad410003-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','固定測試付款');
INSERT INTO public.ledgers(id,user_id,name,base_currency,timezone,default_exchange_rate_to_twd)
VALUES ('ad410001-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','韓元固定支出','KRW','Asia/Seoul',0.025);
INSERT INTO public.recurring_expenses(id,user_id,ledger_id,name,amount,currency,category_id,payment_method_id,frequency_months,start_date)
VALUES ('ad410004-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','ad410001-0000-4000-8000-000000000002','歐元訂閱',0.10,'EUR','ad410002-0000-4000-8000-000000000002','ad410003-0000-4000-8000-000000000002',1,'2028-01-31'),
 ('ad410004-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','ad410001-0000-4000-8000-000000000003','韓元訂閱',10000,'KRW','ad410002-0000-4000-8000-000000000001','ad410003-0000-4000-8000-000000000001',1,'2028-01-31');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
INSERT INTO public.recurring_expenses(id,ledger_id,name,amount,currency,category_id,payment_method_id,frequency_months,start_date)
VALUES ('ad410004-0000-4000-8000-000000000001','ad410001-0000-4000-8000-000000000001','月訂閱',0.30,'TWD','ad410002-0000-4000-8000-000000000001','ad410003-0000-4000-8000-000000000001',1,'2028-01-31');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.recurring_expenses(ledger_id,name,amount,currency,category_id,payment_method_id,frequency_months,start_date)
    VALUES ('ad410001-0000-4000-8000-000000000002','跨帳號',1,'EUR','ad410002-0000-4000-8000-000000000001','ad410003-0000-4000-8000-000000000001',1,'2028-01-31');
    RAISE EXCEPTION 'cross-owner ledger accepted';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN NULL; END;
  BEGIN
    UPDATE public.recurring_expenses SET next_date='2027-01-01';
    RAISE EXCEPTION 'client rewound schedule';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM private.generate_recurring_expenses();
    RAISE EXCEPTION 'client invoked scheduler';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.recurring_expenses WHERE id='ad410004-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'RLS leak'; END IF;
  UPDATE public.recurring_expenses SET enabled=false WHERE id='ad410004-0000-4000-8000-000000000001';
  IF FOUND THEN RAISE EXCEPTION 'cross-owner update'; END IF;
  DELETE FROM public.recurring_expenses WHERE id='ad410004-0000-4000-8000-000000000001';
  IF FOUND THEN RAISE EXCEPTION 'cross-owner delete'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF private.next_recurring_date('2028-01-31','2028-01-31',1)<>'2028-02-29'::date
    OR private.next_recurring_date('2028-02-29','2028-01-31',1)<>'2028-03-31'::date
    OR private.next_recurring_date('2029-02-28','2028-02-29',12)<>'2030-02-28'::date
    OR private.next_recurring_date('2031-02-28','2028-02-29',12)<>'2032-02-29'::date THEN
    RAISE EXCEPTION 'month-end or leap-year drift';
  END IF;
  PERFORM private.generate_recurring_expenses('2028-01-30T15:59:00Z');
  IF EXISTS (SELECT 1 FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'early charge'; END IF;
  PERFORM private.generate_recurring_expenses('2028-01-30T16:00:00Z');
  PERFORM private.generate_recurring_expenses('2028-01-30T16:01:00Z');
  IF (SELECT count(*) FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000001')<>1 THEN RAISE EXCEPTION 'duplicate charge'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000001' AND amount_twd=0.30 AND occurred_at='2028-01-30T16:00:00Z') THEN RAISE EXCEPTION 'exact amount or timezone'; END IF;
  DELETE FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000001';
  PERFORM private.generate_recurring_expenses('2028-01-31T10:00:00Z');
  IF EXISTS (SELECT 1 FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'deleted charge recreated'; END IF;
  PERFORM private.generate_recurring_expenses('2028-03-30T16:00:00Z');
  IF (SELECT count(*) FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'catch-up failed'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000002' AND original_amount=0.10 AND amount_twd IS NULL AND exchange_rate_to_twd IS NULL AND occurred_at='2028-01-30T23:00:00Z') THEN RAISE EXCEPTION 'EUR conversion or timezone'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000003' AND amount_twd=250 AND exchange_rate_to_twd=0.025) THEN RAISE EXCEPTION 'KRW snapshot'; END IF;
  UPDATE public.ledgers SET default_exchange_rate_to_twd=0.026 WHERE id='ad410001-0000-4000-8000-000000000003';
  PERFORM private.generate_recurring_expenses('2028-04-29T15:00:00Z');
  IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000003' AND recurring_date='2028-04-30' AND amount_twd=260 AND exchange_rate_to_twd=0.026) THEN RAISE EXCEPTION 'new KRW rate not used'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000003' AND recurring_date='2028-01-31' AND amount_twd=250 AND exchange_rate_to_twd=0.025) THEN RAISE EXCEPTION 'old KRW rate changed'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
UPDATE public.recurring_expenses SET enabled=false WHERE id='ad410004-0000-4000-8000-000000000001';
RESET ROLE;
DO $$ BEGIN
  PERFORM private.generate_recurring_expenses('2028-06-01T00:00Z');
  IF (SELECT count(*) FROM public.transactions WHERE recurring_expense_id='ad410004-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'paused rule executed'; END IF;
END $$;
-- Exercise resume's trigger with a past anchor, without generating past data.
UPDATE public.recurring_expenses SET start_date='2020-01-31',next_date='2020-01-31'
WHERE id='ad410004-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
UPDATE public.recurring_expenses SET enabled=true WHERE id='ad410004-0000-4000-8000-000000000001';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.recurring_expenses WHERE id='ad410004-0000-4000-8000-000000000001' AND next_date<(now() AT TIME ZONE 'Asia/Taipei')::date) THEN RAISE EXCEPTION 'paused months would be backfilled'; END IF;
END $$;
DELETE FROM public.recurring_expenses WHERE id='ad410004-0000-4000-8000-000000000001';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.transactions WHERE ledger_id='ad410001-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'stopping removed history'; END IF;
END $$;
INSERT INTO public.transactions(ledger_id,description,category_id,payment_method_id,original_amount,amount_twd,exchange_rate_to_twd,occurred_at)
VALUES ('ad410001-0000-4000-8000-000000000001','','ad410002-0000-4000-8000-000000000001','ad410003-0000-4000-8000-000000000001',10,10,1,now());
ROLLBACK;
