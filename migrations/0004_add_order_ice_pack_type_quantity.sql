ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ice_pack_size text,
  ADD COLUMN IF NOT EXISTS ice_pack_quantity integer;

UPDATE public.orders
SET ice_pack_quantity = COALESCE(ice_pack_quantity, CASE WHEN ice_pack_required THEN 1 ELSE 0 END);

ALTER TABLE public.orders
  ALTER COLUMN ice_pack_quantity SET DEFAULT 0,
  ALTER COLUMN ice_pack_quantity SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_ice_pack_size_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_ice_pack_size_check
      CHECK (
        ice_pack_size IS NULL OR ice_pack_size IN ('small', 'large')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_ice_pack_quantity_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_ice_pack_quantity_check
      CHECK (ice_pack_quantity >= 0);
  END IF;

END $$;
