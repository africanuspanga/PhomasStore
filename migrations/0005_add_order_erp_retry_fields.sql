ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS erp_sync_attempts integer,
  ADD COLUMN IF NOT EXISTS erp_last_sync_attempt_at timestamp,
  ADD COLUMN IF NOT EXISTS erp_next_sync_attempt_at timestamp;

UPDATE public.orders
SET erp_sync_attempts = COALESCE(erp_sync_attempts, 0);

ALTER TABLE public.orders
  ALTER COLUMN erp_sync_attempts SET DEFAULT 0,
  ALTER COLUMN erp_sync_attempts SET NOT NULL;
