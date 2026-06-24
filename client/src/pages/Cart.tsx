import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { ecountService } from "@/services/ecountService";
import { ShoppingCart, ArrowLeft, Plus, Minus, Trash2, Send, AlertTriangle, Snowflake } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  calculateOrderTotal,
  ICE_PACK_PRICES,
  getIcePackCost,
  getIcePackSizeLabel,
  getDeliveryAreaLabel,
  getTransportCost,
} from "@shared/orderPricing";
import type {
  DeliveryArea,
  DeliveryOption,
  IcePackSize,
  OrderItem,
  PaymentMethod,
  ProductWithInventory,
} from "@shared/schema";

const PAYMENT_DETAILS = {
  accountName: "PHOMAS DIAGNOSTICS AND MEDICAL SUPPLIES LTD",
  bankName: "DTB Bank Plc",
  accountNumber: "0332798001",
  swiftCode: "DTKETZT",
  mpesaPaybill: "51396661",
};

const getPaymentMethodLabel = (paymentMethod: PaymentMethod) =>
  paymentMethod === "online_now" ? "Pay Online Now" : "Cash";

const getDeliveryOptionLabel = (deliveryOption: DeliveryOption) =>
  deliveryOption === "delivery" ? "Delivery" : "Pickup";

const formatTzs = (value: number) => Math.round(value).toLocaleString();
type IcePackSelection = "" | "yes" | "no";

export default function Cart() {
  const { items, updateQuantity, removeItem, clearCart, subtotal } = useCart();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption | "">("");
  const [deliveryArea, setDeliveryArea] = useState<DeliveryArea | "">("");
  const [onlinePaymentConfirmed, setOnlinePaymentConfirmed] = useState(false);
  const [icePackSelection, setIcePackSelection] = useState<IcePackSelection>("");
  const [icePackSize, setIcePackSize] = useState<IcePackSize>("small");
  const [icePackQuantity, setIcePackQuantity] = useState(1);
  const [deliveryAddressInput, setDeliveryAddressInput] = useState("");
  const tax = 0;

  const accountCustomerName = user?.name?.trim() || user?.companyName?.trim() || "";
  const accountCustomerCompany = user?.companyName?.trim() || user?.name?.trim() || "";
  const accountCustomerEmail = user?.email?.trim() || "";
  const accountCustomerPhone = user?.phone?.trim() || "";
  const deliveryAddress = deliveryAddressInput.trim();
  const icePackRequired = icePackSelection === "yes";
  const needsDeliveryAddress = deliveryOption === "delivery";
  const isMissingPaymentMethod = !paymentMethod;
  const isMissingDeliveryOption = !deliveryOption;
  const isMissingCustomerName = !accountCustomerName;
  const isMissingCustomerEmail = !accountCustomerEmail;
  const isMissingCustomerPhone = !accountCustomerPhone;
  const isMissingDeliveryAddress = needsDeliveryAddress && !deliveryAddress;
  const isMissingDeliveryArea = needsDeliveryAddress && !deliveryArea;
  const requiresOnlinePaymentConfirmation = paymentMethod === "online_now";
  const transportCost = getTransportCost(deliveryOption, deliveryArea || undefined);
  const normalizedIcePackQuantity = Math.max(1, icePackQuantity || 1);
  const icePackCost = getIcePackCost(icePackRequired, icePackSize, normalizedIcePackQuantity);
  const total = calculateOrderTotal({
    subtotal,
    tax,
    deliveryOption,
    deliveryArea: deliveryArea || undefined,
    icePackRequired,
    icePackSize,
    icePackQuantity: normalizedIcePackQuantity,
  });

  // Fetch products to check stock limits
  const { data: products = [] } = useQuery<ProductWithInventory[]>({
    queryKey: ["/api/products"],
    queryFn: () => ecountService.getProducts(),
  });

  // Get stock for a product
  const getProductStock = (productId: string): number => {
    const product = products.find((p) => p.id === productId);
    return product?.availableQuantity ?? 99;
  };

  // Validate and update quantity with stock check
  const handleUpdateQuantity = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeItem(productId);
      return;
    }

    const maxStock = getProductStock(productId);
    const item = items.find((i) => i.productId === productId);

    if (newQuantity > maxStock) {
      toast({
        title: "Stock limit reached",
        description: `Only ${maxStock} units available for ${item?.name || "this product"}.`,
        variant: "destructive",
      });
      return;
    }

    updateQuantity(productId, newQuantity);
  };

  const sendToEcountMutation = useMutation({
    mutationFn: async () => {
      if (!paymentMethod || !deliveryOption) {
        throw new Error("Payment method and fulfillment option are required.");
      }

      // Allow guest checkout - userId will be set by backend
      const userId = user?.userId || user?.id || "guest-user";

      const orderItems: OrderItem[] = items.map((item) => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        referenceNumber: item.referenceNumber,
      }));

      return ecountService.placeOrder({
        userId,
        items: JSON.stringify(orderItems),
        subtotal: subtotal.toFixed(2),
        tax: "0.00",
        total: total.toFixed(2),
        status: "processing",
        paymentMethod,
        deliveryOption,
        deliveryArea: deliveryOption === "delivery" ? deliveryArea || undefined : undefined,
        transportCost: transportCost.toFixed(2),
        icePackRequired,
        icePackSize: icePackRequired ? icePackSize : undefined,
        icePackQuantity: icePackRequired ? normalizedIcePackQuantity : 0,
        icePackCost: icePackCost.toFixed(2),
        customerName: accountCustomerName,
        customerEmail: accountCustomerEmail,
        customerPhone: accountCustomerPhone,
        customerCompany: accountCustomerCompany,
        customerAddress: deliveryOption === "delivery" ? deliveryAddress : "",
      });
    },
    onSuccess: (data) => {
      setOrderNumber(data.order.orderNumber);
      setShowSuccessModal(true);
      clearCart();
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error) => {
      console.error("Order submission error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("412") || errorMessage.includes("rate limit")) {
        toast({
          title: "System Busy",
          description: "eCount system is rate limited. Please wait 30 seconds and try again.",
          variant: "destructive",
          duration: 10000,
        });
      } else if (errorMessage.includes("502")) {
        toast({
          title: "Order Saved Locally",
          description: "Your order is saved but couldn't sync to eCount right now. It will be retried automatically.",
          variant: "destructive",
          duration: 10000,
        });
      } else {
        toast({
          title: "Order failed",
          description: errorMessage || "There was an error processing your order. Please try again.",
          variant: "destructive",
          duration: 10000,
        });
      }
    },
  });

  const handlePaymentMethodChange = (value: string) => {
    const nextPaymentMethod = value as PaymentMethod;
    setPaymentMethod(nextPaymentMethod);

    if (nextPaymentMethod === "cash" && deliveryOption === "delivery") {
      setDeliveryOption("");
      setDeliveryArea("");
    }

    if (nextPaymentMethod !== "online_now") {
      setOnlinePaymentConfirmed(false);
    }
  };

  const handleDeliveryOptionChange = (value: string) => {
    const nextDeliveryOption = value as DeliveryOption;
    setDeliveryOption(nextDeliveryOption);

    if (nextDeliveryOption !== "delivery") {
      setDeliveryArea("");
    }

    if (nextDeliveryOption === "delivery" && paymentMethod === "cash") {
      setPaymentMethod("");
      setOnlinePaymentConfirmed(false);
    }
  };

  const handleSendToEcount = () => {
    if (items.length === 0) {
      toast({
        title: "Cart is empty",
        description: "Please add items to your cart before placing an order.",
        variant: "destructive",
      });
      return;
    }

    if (isMissingCustomerName || isMissingCustomerEmail || isMissingCustomerPhone) {
      toast({
        title: "Checkout details required",
        description: "Your account is missing name, email, or phone details.",
        variant: "destructive",
      });
      return;
    }

    if (isMissingPaymentMethod) {
      toast({
        title: "Payment method required",
        description: "Please choose Cash or Pay Online Now.",
        variant: "destructive",
      });
      return;
    }

    if (isMissingDeliveryOption) {
      toast({
        title: "Fulfillment option required",
        description: "Please choose Pickup or Delivery.",
        variant: "destructive",
      });
      return;
    }

    if (requiresOnlinePaymentConfirmation && !onlinePaymentConfirmed) {
      toast({
        title: "Confirm online payment",
        description: "Please confirm you will pay online before submitting this order.",
        variant: "destructive",
      });
      return;
    }

    if (isMissingDeliveryAddress) {
      toast({
        title: "Delivery address missing",
        description: "Please enter the delivery address for this order.",
        variant: "destructive",
      });
      return;
    }

    if (isMissingDeliveryArea) {
      toast({
        title: "Delivery area required",
        description: "Please choose Dar es Salaam or outside Dar es Salaam to calculate transport cost.",
        variant: "destructive",
      });
      return;
    }

    sendToEcountMutation.mutate();
  };

  const handleCloseSuccessModal = () => {
    setShowSuccessModal(false);
    setPaymentMethod("");
    setDeliveryOption("");
    setDeliveryArea("");
    setOnlinePaymentConfirmed(false);
    setIcePackSelection("");
    setIcePackSize("small");
    setIcePackQuantity(1);
    setDeliveryAddressInput("");
    setLocation("/");
  };

  if (items.length === 0 && !showSuccessModal) {
    return (
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="text-center py-12">
              <ShoppingCart className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-gray-800 mb-2">Your cart is empty</h2>
              <p className="text-gray-600 mb-6">Add some medical supplies to get started</p>
              <Link href="/">
                <Button className="bg-phomas-green hover:bg-phomas-green/90">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Continue Shopping
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl">Shopping Cart</CardTitle>
                <Link href="/">
                  <Button variant="outline">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Continue Shopping
                  </Button>
                </Link>
              </div>
            </CardHeader>

            <CardContent>
              <div className="space-y-4 mb-6">
                {items.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                  >
                    <div className="flex items-center space-x-4">
                      <img
                        src={
                          item.imageUrl ||
                          "https://images.unsplash.com/photo-1584362917165-526a968579e8?ixlib=rb-4.0.3&auto=format&fit=crop&w=80&h=80"
                        }
                        alt={item.name}
                        className="w-16 h-16 object-cover rounded-lg"
                      />
                      <div>
                        <h3 className="font-semibold text-gray-800">{item.name}</h3>
                        <p className="text-sm text-gray-600">{item.referenceNumber}</p>
                        <p className="text-sm font-medium text-phomas-green">
                          TZS {parseInt(item.price).toLocaleString()} each
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4">
                      <div className="flex flex-col items-center space-y-1">
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUpdateQuantity(item.productId, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            data-testid={`decrease-qty-${item.productId}`}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <Input
                            type="number"
                            min="1"
                            max={getProductStock(item.productId)}
                            value={item.quantity}
                            onChange={(e) =>
                              handleUpdateQuantity(item.productId, parseInt(e.target.value, 10) || 1)
                            }
                            className="w-16 text-center"
                            data-testid={`qty-input-${item.productId}`}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUpdateQuantity(item.productId, item.quantity + 1)}
                            disabled={item.quantity >= getProductStock(item.productId)}
                            data-testid={`increase-qty-${item.productId}`}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                        <span className="text-xs text-gray-500">
                          Stock: {getProductStock(item.productId)} available
                        </span>
                        {item.quantity >= getProductStock(item.productId) && (
                          <span className="text-xs text-amber-600 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Max stock
                          </span>
                        )}
                      </div>

                      <div className="text-right">
                        <p className="font-bold text-phomas-green">
                          TZS {(parseInt(item.price) * item.quantity).toLocaleString()}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeItem(item.productId)}
                          className="text-red-500 hover:text-red-700"
                          data-testid={`remove-item-${item.productId}`}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-200 pt-6">
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">Checkout Details</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Review your account details, then choose payment, fulfillment, and cold-chain support.
                  </p>
                </div>

                <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h4 className="font-semibold text-gray-900">Customer Details</h4>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase text-gray-500">Name</p>
                      <p className="font-medium text-gray-900">{accountCustomerName || "Missing"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-gray-500">Company</p>
                      <p className="font-medium text-gray-900">{accountCustomerCompany || "Not provided"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-gray-500">Email</p>
                      <p className="font-medium text-gray-900">{accountCustomerEmail || "Missing"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-gray-500">Phone</p>
                      <p className="font-medium text-gray-900">{accountCustomerPhone || "Missing"}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 mb-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <div>
                      <Label className="text-base font-semibold text-gray-900">Payment Method</Label>
                      <p className="text-sm text-gray-600 mt-1">Cash or pay online now.</p>
                    </div>

                    <RadioGroup
                      value={paymentMethod}
                      onValueChange={handlePaymentMethodChange}
                      className="gap-3"
                    >
                      <label
                        className={`flex items-start gap-3 rounded-lg border p-4 ${
                          deliveryOption === "delivery"
                            ? "border-gray-200 bg-gray-100 opacity-50 cursor-not-allowed"
                            : "border-gray-200 cursor-pointer"
                        }`}
                      >
                        <RadioGroupItem
                          value="cash"
                          id="payment-cash"
                          className="mt-1"
                          disabled={deliveryOption === "delivery"}
                        />
                        <div>
                          <span className="font-medium text-gray-900">Cash</span>
                          <p className="text-sm text-gray-600 mt-1">Pay when the order is processed.</p>
                          {deliveryOption === "delivery" && (
                            <p className="text-xs text-amber-600 mt-1">
                              Delivery requires online payment.
                            </p>
                          )}
                        </div>
                      </label>

                      <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 cursor-pointer">
                        <RadioGroupItem
                          value="online_now"
                          id="payment-online-now"
                          className="mt-1"
                        />
                        <div>
                          <span className="font-medium text-gray-900">Pay Online Now</span>
                          <p className="text-sm text-gray-600 mt-1">
                            Complete payment before you submit this order.
                          </p>
                        </div>
                      </label>
                    </RadioGroup>

                    {paymentMethod === "online_now" && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                        <div className="space-y-2 text-sm text-gray-800">
                          <p className="font-semibold text-gray-900">Bank Details</p>
                          <p>A/C Name: {PAYMENT_DETAILS.accountName}</p>
                          <p>{PAYMENT_DETAILS.bankName}</p>
                          <p>A/C No (TZS): {PAYMENT_DETAILS.accountNumber}</p>
                          <p>Swift Code: {PAYMENT_DETAILS.swiftCode}</p>
                          <div className="pt-2 border-t border-emerald-200">
                            <p className="font-semibold text-gray-900">M-PESA LIPA NUMBER</p>
                            <p className="text-base font-semibold">{PAYMENT_DETAILS.mpesaPaybill}</p>
                          </div>
                        </div>

                        <div className="mt-4 flex items-start gap-3">
                          <Checkbox
                            id="online-payment-confirmed"
                            checked={onlinePaymentConfirmed}
                            onCheckedChange={(checked) => setOnlinePaymentConfirmed(checked === true)}
                            data-testid="checkbox-online-payment-confirmed"
                          />
                          <Label
                            htmlFor="online-payment-confirmed"
                            className="text-sm leading-5 text-gray-700"
                          >
                            I will complete payment before I submit this order.
                          </Label>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <Label className="text-base font-semibold text-gray-900">Order Fulfillment</Label>
                      <p className="text-sm text-gray-600 mt-1">Pickup or delivery.</p>
                    </div>

                    <RadioGroup
                      value={deliveryOption}
                      onValueChange={handleDeliveryOptionChange}
                      className="gap-3"
                    >
                      <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 cursor-pointer">
                        <RadioGroupItem value="pickup" id="delivery-pickup" className="mt-1" />
                        <div>
                          <span className="font-medium text-gray-900">Pickup</span>
                          <p className="text-sm text-gray-600 mt-1">
                            The admin dashboard will mark this order for collection.
                          </p>
                        </div>
                      </label>

                      <label
                        className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer ${
                          paymentMethod === "cash"
                            ? "border-gray-200 bg-gray-100 opacity-50 cursor-not-allowed"
                            : "border-gray-200"
                        }`}
                      >
                        <RadioGroupItem
                          value="delivery"
                          id="delivery-option"
                          className="mt-1"
                          disabled={paymentMethod === "cash"}
                        />
                        <div>
                          <span className="font-medium text-gray-900">Delivery</span>
                          <p className="text-sm text-gray-600 mt-1">
                            Enter a delivery address for this order.
                          </p>
                          {paymentMethod === "cash" && (
                            <p className="text-xs text-amber-600 mt-1">
                              Delivery requires online payment.
                            </p>
                          )}
                        </div>
                      </label>
                    </RadioGroup>

                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      {deliveryOption === "delivery" ? (
                        <>
                          <div>
                            <Label htmlFor="checkout-delivery-address">Delivery Address</Label>
                            <Input
                              id="checkout-delivery-address"
                              value={deliveryAddressInput}
                              onChange={(event) => setDeliveryAddressInput(event.target.value)}
                              placeholder="Street, city, region"
                              className="mt-2 bg-white"
                              data-testid="input-checkout-delivery-address"
                            />
                            {deliveryAddress ? (
                              <p className="text-xs text-gray-500 mt-2">
                                This address will be sent to the admin dashboard with the order.
                              </p>
                            ) : (
                              <p className="text-xs text-amber-700 mt-2">
                                Enter a delivery address for this order.
                              </p>
                            )}
                          </div>

                          <div className="mt-4 border-t border-gray-200 pt-4">
                            <p className="font-medium text-gray-900">Delivery Area</p>
                            <p className="text-sm text-gray-600 mt-1">
                              Choose the transport zone for this delivery.
                            </p>

                            <RadioGroup
                              value={deliveryArea}
                              onValueChange={(value) => setDeliveryArea(value as DeliveryArea)}
                              className="mt-3 gap-3"
                            >
                              <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 cursor-pointer">
                                <RadioGroupItem
                                  value="dar_es_salaam"
                                  id="delivery-area-dar-es-salaam"
                                  className="mt-1"
                                />
                                <div>
                                  <span className="font-medium text-gray-900">Dar es Salaam</span>
                                  <p className="text-sm text-gray-600 mt-1">
                                    Transport cost: TZS 10,000
                                  </p>
                                </div>
                              </label>

                              <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 cursor-pointer">
                                <RadioGroupItem
                                  value="outside_dar_es_salaam"
                                  id="delivery-area-outside-dar-es-salaam"
                                  className="mt-1"
                                />
                                <div>
                                  <span className="font-medium text-gray-900">
                                    Outside Dar es Salaam
                                  </span>
                                  <p className="text-sm text-gray-600 mt-1">
                                    Transport cost: TZS 20,000
                                  </p>
                                </div>
                              </label>
                            </RadioGroup>

                            {deliveryArea ? (
                              <p className="text-xs text-gray-500 mt-3">
                                Added transport cost: TZS {formatTzs(transportCost)} for{" "}
                                {getDeliveryAreaLabel(deliveryArea)}.
                              </p>
                            ) : (
                              <p className="text-xs text-amber-700 mt-3">
                                Select a delivery area to calculate the full total.
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-gray-900">Pickup selected</p>
                          <p className="text-sm text-gray-600 mt-1">
                            The admin team will see that you plan to collect this order.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mb-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
                  <div className="space-y-3">
                    <Label className="flex items-center gap-2 text-base font-semibold text-gray-900">
                      <Snowflake className="h-4 w-4 text-blue-600" />
                      Add Ice parks for reagents that need temperature control
                    </Label>

                    <RadioGroup
                      value={icePackSelection}
                      onValueChange={(value) => {
                        const nextSelection = value as IcePackSelection;
                        setIcePackSelection(nextSelection);
                        if (nextSelection !== "yes") {
                          setIcePackSize("small");
                          setIcePackQuantity(1);
                        }
                      }}
                      className="grid gap-3 sm:grid-cols-2"
                    >
                      <label className="flex items-start gap-3 rounded-lg border border-blue-100 bg-white p-4 cursor-pointer">
                        <RadioGroupItem value="yes" id="ice-pack-required-yes" className="mt-1" />
                        <div>
                          <span className="font-medium text-gray-900">Yes</span>
                          <p className="text-sm text-gray-600 mt-1">Add ice packs to this order.</p>
                        </div>
                      </label>

                      <label className="flex items-start gap-3 rounded-lg border border-blue-100 bg-white p-4 cursor-pointer">
                        <RadioGroupItem value="no" id="ice-pack-required-no" className="mt-1" />
                        <div>
                          <span className="font-medium text-gray-900">No</span>
                          <p className="text-sm text-gray-600 mt-1">No ice packs needed.</p>
                        </div>
                      </label>
                    </RadioGroup>
                  </div>

                  {icePackRequired && (
                    <div className="mt-4 border-t border-blue-100 pt-4">
                      <div>
                        <Label className="text-sm font-semibold text-gray-900">Ice Pack Size</Label>
                        <RadioGroup
                          value={icePackSize}
                          onValueChange={(value) => setIcePackSize(value as IcePackSize)}
                          className="mt-3 grid gap-3 sm:grid-cols-2"
                        >
                          {(["small", "large"] as IcePackSize[]).map((size) => (
                            <label
                              key={size}
                              className="flex items-start gap-3 rounded-lg border border-blue-100 bg-white p-4 cursor-pointer"
                            >
                              <RadioGroupItem value={size} id={`ice-pack-size-${size}`} className="mt-1" />
                              <div>
                                <span className="font-medium text-gray-900">
                                  {getIcePackSizeLabel(size)}
                                </span>
                                <p className="text-sm text-gray-600 mt-1">
                                  TZS {formatTzs(ICE_PACK_PRICES[size])} each
                                </p>
                              </div>
                            </label>
                          ))}
                        </RadioGroup>
                      </div>

                      <div className="mt-4 max-w-xs">
                        <Label htmlFor="ice-pack-quantity">Quantity</Label>
                        <Input
                          id="ice-pack-quantity"
                          type="number"
                          min="1"
                          value={icePackQuantity}
                          onChange={(event) =>
                            setIcePackQuantity(Math.max(1, Number.parseInt(event.target.value, 10) || 1))
                          }
                          data-testid="input-ice-pack-quantity"
                        />
                        <p className="mt-2 text-xs text-gray-600">
                          Ice pack total: TZS {formatTzs(icePackCost)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2 mb-6">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal:</span>
                    <span className="font-medium">TZS {formatTzs(subtotal)}</span>
                  </div>
                  {deliveryOption === "delivery" && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">
                        Transport Cost
                        {deliveryArea ? ` (${getDeliveryAreaLabel(deliveryArea)})` : ""}:
                      </span>
                      <span className="font-medium">TZS {formatTzs(transportCost)}</span>
                    </div>
                  )}
                  {icePackRequired && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">
                        Ice Pack ({getIcePackSizeLabel(icePackSize)} x {normalizedIcePackQuantity}):
                      </span>
                      <span className="font-medium">TZS {formatTzs(icePackCost)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold text-phomas-green">
                    <span>Total:</span>
                    <span>TZS {formatTzs(total)}</span>
                  </div>
                </div>

                {requiresOnlinePaymentConfirmation && !onlinePaymentConfirmed && (
                  <p className="mb-4 text-sm text-amber-700">
                    Confirm online payment before placing this order.
                  </p>
                )}

                {(isMissingCustomerName || isMissingCustomerEmail || isMissingCustomerPhone) && (
                  <p className="mb-4 text-sm text-red-600">
                    Your account is missing name, email, or phone details.
                  </p>
                )}

                {isMissingPaymentMethod && (
                  <p className="mb-4 text-sm text-red-600">
                    Choose a payment method before placing this order.
                  </p>
                )}

                {isMissingDeliveryOption && (
                  <p className="mb-4 text-sm text-red-600">
                    Choose pickup or delivery before placing this order.
                  </p>
                )}

                {isMissingDeliveryAddress && (
                  <p className="mb-4 text-sm text-red-600">
                    Enter the delivery address for this order before submitting.
                  </p>
                )}

                {isMissingDeliveryArea && !isMissingDeliveryAddress && (
                  <p className="mb-4 text-sm text-red-600">
                    Select the delivery area so transport cost can be added to this order.
                  </p>
                )}

                <Button
                  onClick={handleSendToEcount}
                  disabled={
                    sendToEcountMutation.isPending ||
                    isMissingCustomerName ||
                    isMissingCustomerEmail ||
                    isMissingCustomerPhone ||
                    isMissingPaymentMethod ||
                    isMissingDeliveryOption ||
                    (requiresOnlinePaymentConfirmation && !onlinePaymentConfirmed) ||
                    isMissingDeliveryAddress ||
                    isMissingDeliveryArea
                  }
                  className="w-full bg-phomas-green hover:bg-phomas-green/90 py-4 text-lg font-semibold"
                  data-testid="button-place-order"
                >
                  {sendToEcountMutation.isPending ? (
                    "Processing..."
                  ) : (
                    <>
                      <Send className="w-5 h-5 mr-2" />
                      {paymentMethod === "online_now" ? "CONFIRM & PLACE ORDER" : "PLACE ORDER"}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {showSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardContent className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">Order Completed!</h3>
              <p className="text-gray-600 mb-2">
                Your order has been received and ERP sync is running automatically.
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Payment: {paymentMethod ? getPaymentMethodLabel(paymentMethod) : "Not set"} | Fulfillment:{" "}
                {deliveryOption ? getDeliveryOptionLabel(deliveryOption) : "Not set"}
                {icePackRequired ? ` | Ice pack: ${getIcePackSizeLabel(icePackSize)} x ${normalizedIcePackQuantity}` : ""}
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Order Number: <span className="font-medium text-phomas-green">{orderNumber}</span>
              </p>
              <Button
                onClick={handleCloseSuccessModal}
                className="bg-phomas-green hover:bg-phomas-green/90"
              >
                Continue Shopping
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
