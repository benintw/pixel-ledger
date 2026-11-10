ALTER TABLE public.transactions
  DROP CONSTRAINT transactions_ledger_owner_fk,
  ADD CONSTRAINT transactions_ledger_owner_fk
    FOREIGN KEY (ledger_id, user_id) REFERENCES public.ledgers(id, user_id)
    ON DELETE RESTRICT;
