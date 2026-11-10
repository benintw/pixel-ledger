\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$
DECLARE l uuid; c uuid; p uuid; a uuid; b uuid; v jsonb;
BEGIN
  SELECT id INTO c FROM public.categories WHERE name='交通';
  SELECT id INTO p FROM public.payment_methods WHERE name='現金';
  INSERT INTO public.ledgers(name,type,base_currency,timezone,default_exchange_rate_to_twd)
    VALUES('韓國旅遊','travel','KRW','Asia/Seoul',0.024) RETURNING id INTO l;
  INSERT INTO public.transactions(ledger_id,description,category_id,payment_method_id,original_amount,original_currency,occurred_at)
    VALUES(l,'地鐵',c,p,10000,'KRW','2026-11-02T15:00:00Z') RETURNING id INTO a;
  IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE id=a AND amount_twd=240 AND exchange_rate_to_twd=0.024) THEN RAISE EXCEPTION 'KRW conversion'; END IF;
  v:=public.ledger_report(l,'2026-11-03','2026-11-03');
  IF (v->>'total')::numeric<>10000 OR (v->>'total_twd')::numeric<>240 THEN RAISE EXCEPTION 'Seoul midnight'; END IF;
  IF (public.ledger_report(l,'2026-11-02','2026-11-02')->>'count')::int<>0 THEN RAISE EXCEPTION 'wrong Seoul date'; END IF;
  UPDATE public.ledgers SET default_exchange_rate_to_twd=0.025 WHERE id=l;
  INSERT INTO public.transactions(ledger_id,description,category_id,payment_method_id,original_amount,original_currency,occurred_at)
    VALUES(l,'餐飲',c,p,2000,'KRW','2026-11-03T10:00:00Z') RETURNING id INTO b;
  UPDATE public.transactions SET description='地鐵修正',exchange_rate_to_twd=0.9 WHERE id=a;
  IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE id=a AND amount_twd=240 AND exchange_rate_to_twd=0.024) THEN RAISE EXCEPTION 'history rate changed'; END IF;
  UPDATE public.transactions SET original_amount=11000 WHERE id=a;
  IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE id=a AND amount_twd=264 AND exchange_rate_to_twd=0.024) THEN RAISE EXCEPTION 'edit amount conversion'; END IF;
  v:=public.ledger_total(l);
  IF (v->>'total')::numeric<>13000 OR (v->>'total_twd')::numeric<>314 OR (v->>'count')::int<>2 THEN RAISE EXCEPTION 'trip total'; END IF;
  BEGIN
    INSERT INTO public.transactions(ledger_id,description,category_id,payment_method_id,original_amount,original_currency,occurred_at)
      VALUES(l,'小數韓元',c,p,1.5,'KRW',now());
    RAISE EXCEPTION 'fractional KRW accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.ledgers SET default_exchange_rate_to_twd=0 WHERE id=l;
    RAISE EXCEPTION 'zero rate accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  DELETE FROM public.transactions WHERE id=b;
  IF (public.ledger_total(l)->>'total_twd')::numeric<>264 THEN RAISE EXCEPTION 'deletion total'; END IF;
END $$;
ROLLBACK;

-- Korea total remains restricted to the owner.
INSERT INTO public.ledgers(id,user_id,name,type,base_currency,timezone,default_exchange_rate_to_twd)
VALUES('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','私有韓國帳','travel','KRW','Asia/Seoul',0.024);
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.ledger_total('44444444-4444-4444-8444-444444444444');
    RAISE EXCEPTION 'cross-owner total accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ledger not found' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
