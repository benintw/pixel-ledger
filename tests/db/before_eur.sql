INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111','owner@example.test');
INSERT INTO auth.users VALUES ('22222222-2222-4222-8222-222222222222','other@example.test');
INSERT INTO public.transactions(user_id,ledger_id,description,category_id,payment_method_id,
 original_amount,amount_twd,occurred_at)
SELECT l.user_id,l.id,'既有台幣',c.id,p.id,13.61,13.61,'2026-08-18 00:00+08'
FROM public.ledgers l
JOIN public.categories c ON c.user_id=l.user_id AND c.name='交通'
JOIN public.payment_methods p ON p.user_id=l.user_id AND p.name='現金'
WHERE l.user_id='11111111-1111-4111-8111-111111111111';
