ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_area text,
  ADD COLUMN IF NOT EXISTS transport_cost numeric(10, 2);

UPDATE public.orders
SET transport_cost = COALESCE(transport_cost, 0);

ALTER TABLE public.orders
  ALTER COLUMN transport_cost SET DEFAULT 0,
  ALTER COLUMN transport_cost SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_delivery_area_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_delivery_area_check
      CHECK (
        delivery_area IS NULL OR delivery_area IN ('dar_es_salaam', 'outside_dar_es_salaam')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_transport_cost_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_transport_cost_check
      CHECK (transport_cost >= 0);
  END IF;
END $$;
