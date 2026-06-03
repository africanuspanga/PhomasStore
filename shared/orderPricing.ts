export const DELIVERY_AREA_VALUES = ["dar_es_salaam", "outside_dar_es_salaam"] as const;

export type DeliveryAreaValue = (typeof DELIVERY_AREA_VALUES)[number];

export const TRANSPORT_COSTS: Record<DeliveryAreaValue, number> = {
  dar_es_salaam: 10000,
  outside_dar_es_salaam: 20000,
};

export const ICE_PACK_SIZE_VALUES = ["small", "large"] as const;

export type IcePackSizeValue = (typeof ICE_PACK_SIZE_VALUES)[number];

export const ICE_PACK_PRICES: Record<IcePackSizeValue, number> = {
  small: 5000,
  large: 15000,
};

const DAR_ES_SALAAM_PATTERNS = [
  "dar es salaam",
  "dar-es-salaam",
  "dsm",
  "mikocheni",
  "masaki",
  "kinondoni",
  "ilala",
  "temeke",
  "ubungo",
  "kigamboni",
];

export function getDeliveryAreaLabel(deliveryArea?: string | null): string {
  switch (deliveryArea) {
    case "dar_es_salaam":
      return "Dar es Salaam";
    case "outside_dar_es_salaam":
      return "Outside Dar es Salaam";
    default:
      return "Not set";
  }
}

export function getIcePackSizeLabel(icePackSize?: string | null): string {
  switch (icePackSize) {
    case "small":
      return "Small";
    case "large":
      return "Large";
    default:
      return "Not set";
  }
}

export function inferDeliveryAreaFromAddress(address?: string | null): DeliveryAreaValue | null {
  const normalizedAddress = address?.trim().toLowerCase();

  if (!normalizedAddress) {
    return null;
  }

  return DAR_ES_SALAAM_PATTERNS.some((pattern) => normalizedAddress.includes(pattern))
    ? "dar_es_salaam"
    : "outside_dar_es_salaam";
}

export function getTransportCost(
  deliveryOption?: string | null,
  deliveryArea?: string | null,
): number {
  if (deliveryOption !== "delivery") {
    return 0;
  }

  if (!deliveryArea || !(deliveryArea in TRANSPORT_COSTS)) {
    return 0;
  }

  return TRANSPORT_COSTS[deliveryArea as DeliveryAreaValue];
}

export function getIcePackCost(
  icePackRequired?: boolean | null,
  icePackSize?: string | null,
  icePackQuantity?: number | string | null,
): number {
  if (!icePackRequired || !icePackSize || !(icePackSize in ICE_PACK_PRICES)) {
    return 0;
  }

  const quantity =
    typeof icePackQuantity === "number"
      ? icePackQuantity
      : Number.parseInt(String(icePackQuantity ?? "1"), 10);

  return ICE_PACK_PRICES[icePackSize as IcePackSizeValue] * Math.max(1, quantity || 1);
}

export function sumOrderItemsSubtotal(
  items: Array<{ price: string | number; quantity: number }>,
): number {
  return items.reduce((sum, item) => {
    const unitPrice =
      typeof item.price === "number" ? item.price : Number.parseFloat(item.price || "0");

    return sum + unitPrice * item.quantity;
  }, 0);
}

export function calculateOrderTotal({
  subtotal,
  deliveryOption,
  deliveryArea,
  icePackRequired,
  icePackSize,
  icePackQuantity,
}: {
  subtotal: number;
  tax?: number;
  deliveryOption?: string | null;
  deliveryArea?: string | null;
  icePackRequired?: boolean | null;
  icePackSize?: string | null;
  icePackQuantity?: number | string | null;
}): number {
  return subtotal + getTransportCost(deliveryOption, deliveryArea) + getIcePackCost(icePackRequired, icePackSize, icePackQuantity);
}
