-- Production scheduler; separate from portable schema tests (requires pg_cron).
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('pixel-ledger-recurring-expenses','5 * * * *',
  'SELECT private.generate_recurring_expenses();');
SELECT cron.schedule('pixel-ledger-recurring-log-cleanup','15 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE jobid IN
    (SELECT jobid FROM cron.job WHERE jobname IN
      ('pixel-ledger-recurring-expenses','pixel-ledger-recurring-log-cleanup'))
    AND end_time < now()-interval '14 days';$$);
