ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ice_pack_required boolean,
  ADD COLUMN IF NOT EXISTS ice_pack_cost numeric(10, 2);

UPDATE public.orders
SET
  ice_pack_required = COALESCE(ice_pack_required, false),
  ice_pack_cost = COALESCE(ice_pack_cost, 0);

ALTER TABLE public.orders
  ALTER COLUMN ice_pack_required SET DEFAULT false,
  ALTER COLUMN ice_pack_required SET NOT NULL,
  ALTER COLUMN ice_pack_cost SET DEFAULT 0,
  ALTER COLUMN ice_pack_cost SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_ice_pack_cost_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_ice_pack_cost_check
      CHECK (ice_pack_cost >= 0);
  END IF;
END $$;
