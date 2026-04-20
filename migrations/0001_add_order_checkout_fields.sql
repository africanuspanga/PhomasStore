ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS delivery_option text;

UPDATE public.orders
SET
  payment_method = COALESCE(payment_method, 'cash'),
  delivery_option = COALESCE(delivery_option, 'pickup');

ALTER TABLE public.orders
  ALTER COLUMN payment_method SET DEFAULT 'cash',
  ALTER COLUMN payment_method SET NOT NULL,
  ALTER COLUMN delivery_option SET DEFAULT 'pickup',
  ALTER COLUMN delivery_option SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_payment_method_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_payment_method_check
      CHECK (payment_method IN ('cash', 'online_now'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_delivery_option_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_delivery_option_check
      CHECK (delivery_option IN ('pickup', 'delivery'));
  END IF;
END $$;
