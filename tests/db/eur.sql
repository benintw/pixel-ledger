\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$
DECLARE l uuid; c uuid; p uuid; t uuid; r jsonb; n integer;
BEGIN
  SELECT id INTO l FROM public.ledgers WHERE is_default;
  r := public.ledger_report(l,'2026-08-18','2026-08-18');
  IF (r->>'total')::numeric <> 13.61 OR r->>'currency' <> 'TWD' THEN RAISE EXCEPTION 'TWD regression'; END IF;
  BEGIN
    UPDATE public.ledgers SET base_currency='EUR' WHERE id=l;
    RAISE EXCEPTION 'nonempty ledger currency changed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.ledgers(name,base_currency,timezone) VALUES('德國生活','EUR','Europe/Berlin') RETURNING id INTO l;
  SELECT id INTO c FROM public.categories WHERE name='交通';
  SELECT id INTO p FROM public.payment_methods WHERE name='現金';
  INSERT INTO public.transactions(ledger_id,description,category_id,payment_method_id,original_amount,
    original_currency,amount_twd,exchange_rate_to_twd,occurred_at)
  VALUES(l,'夏令邊界',c,p,18.95,'EUR',NULL,NULL,'2026-08-31T22:00Z') RETURNING id INTO t;
  r:= public.ledger_report(l,'2026-09-01','2026-09-01');
  IF (r->>'total')::numeric <> 18.95 OR (r->>'count')::int <> 1 OR r->>'currency' <> 'EUR' THEN RAISE EXCEPTION 'EUR report'; END IF;
  IF (public.ledger_report(l,'2026-08-31','2026-08-31')->>'total')::numeric <> 0 THEN RAISE EXCEPTION 'Berlin boundary'; END IF;
  BEGIN
    UPDATE public.transactions SET original_currency='TWD',amount_twd=18.95,exchange_rate_to_twd=1 WHERE id=t;
    RAISE EXCEPTION 'mixed currency accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.transactions SET amount_twd=18.95,exchange_rate_to_twd=1 WHERE id=t;
    RAISE EXCEPTION 'fake EUR conversion accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.transactions SET original_amount=20,occurred_at='2026-10-25T23:00Z' WHERE id=t;
  IF (public.ledger_report(l,'2026-09-01','2026-09-01')->>'total')::numeric <> 0 THEN RAISE EXCEPTION 'edit old total'; END IF;
  IF (public.ledger_report(l,'2026-10-26','2026-10-26')->>'total')::numeric <> 20 THEN RAISE EXCEPTION 'winter boundary'; END IF;
  DELETE FROM public.transactions WHERE id=t;
  IF (public.ledger_report(l,'2026-10-01','2026-10-31')->>'total')::numeric <> 0 THEN RAISE EXCEPTION 'delete total'; END IF;
END $$;
ROLLBACK;

-- Use another authenticated identity, not a superuser, to test RLS and owner FKs.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$
DECLARE n integer; other_ledger uuid; other_category uuid;
BEGIN
  SELECT count(*) INTO n FROM public.transactions WHERE user_id='11111111-1111-4111-8111-111111111111';
  IF n<>0 THEN RAISE EXCEPTION 'RLS read leak'; END IF;
  UPDATE public.transactions SET description='hacked' WHERE user_id='11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'RLS update leak'; END IF;
  DELETE FROM public.transactions WHERE user_id='11111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>0 THEN RAISE EXCEPTION 'RLS delete leak'; END IF;
END $$;
ROLLBACK;

-- Persist a synthetic EUR row for API-level owner-reference tests.
INSERT INTO public.ledgers(id,user_id,name,base_currency,timezone)
VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','隔離測試','EUR','Europe/Berlin');
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$
DECLARE c uuid; p uuid; l uuid;
BEGIN
  SELECT id INTO c FROM public.categories WHERE name='交通';
  SELECT id INTO p FROM public.payment_methods WHERE name='現金';
  BEGIN
    INSERT INTO public.transactions(ledger_id,description,category_id,payment_method_id,original_amount,
      original_currency,amount_twd,exchange_rate_to_twd,occurred_at)
    VALUES('33333333-3333-4333-8333-333333333333','非法帳本',c,p,1,'EUR',NULL,NULL,now());
    RAISE EXCEPTION 'cross-owner ledger accepted';
  EXCEPTION WHEN check_violation OR foreign_key_violation OR insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.ledger_report('33333333-3333-4333-8333-333333333333','2026-08-01','2026-08-31');
    RAISE EXCEPTION 'cross-owner report accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ledger not found' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
