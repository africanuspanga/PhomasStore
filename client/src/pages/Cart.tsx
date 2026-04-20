import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { ecountService } from "@/services/ecountService";
import { ShoppingCart, ArrowLeft, Plus, Minus, Trash2, Send, AlertTriangle } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  calculateOrderTotal,
  getDeliveryAreaLabel,
  getTransportCost,
  inferDeliveryAreaFromAddress,
} from "@shared/orderPricing";
import type {
  DeliveryArea,
  DeliveryOption,
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

export default function Cart() {
  const { items, updateQuantity, removeItem, clearCart, subtotal, tax } = useCart();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [userEmail, setUserEmail] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption>("pickup");
  const [deliveryArea, setDeliveryArea] = useState<DeliveryArea | "">("");
  const [onlinePaymentConfirmed, setOnlinePaymentConfirmed] = useState(false);

  const deliveryAddress = user?.address?.trim() || "";
  const inferredDeliveryArea = useMemo(
    () => inferDeliveryAreaFromAddress(deliveryAddress),
    [deliveryAddress],
  );
  const needsDeliveryAddress = deliveryOption === "delivery";
  const isMissingDeliveryAddress = needsDeliveryAddress && !deliveryAddress;
  const isMissingDeliveryArea = needsDeliveryAddress && !deliveryArea;
  const requiresOnlinePaymentConfirmation = paymentMethod === "online_now";
  const transportCost = getTransportCost(deliveryOption, deliveryArea || undefined);
  const total = calculateOrderTotal({
    subtotal,
    tax,
    deliveryOption,
    deliveryArea: deliveryArea || undefined,
  });

  // Fetch products to check stock limits
  const { data: products = [] } = useQuery<ProductWithInventory[]>({
    queryKey: ["/api/products"],
    queryFn: () => ecountService.getProducts(),
  });

  // Get stock for a product
  const getProductStock = (productId: string): number => {
    const product = products.find((p) => p.id === productId);
    return product?.availableQuantity ?? 999;
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

  // Get user email from Supabase session
  useEffect(() => {
    const getEmail = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.email) {
        setUserEmail(session.user.email);
      }
    };
    getEmail();
  }, []);

  useEffect(() => {
    if (deliveryOption !== "delivery") {
      setDeliveryArea("");
      return;
    }

    setDeliveryArea((currentDeliveryArea) => currentDeliveryArea || inferredDeliveryArea || "");
  }, [deliveryOption, inferredDeliveryArea]);

  const sendToEcountMutation = useMutation({
    mutationFn: async () => {
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
        tax: tax.toFixed(2),
        total: total.toFixed(2),
        status: "processing",
        paymentMethod,
        deliveryOption,
        deliveryArea: deliveryOption === "delivery" ? deliveryArea || undefined : undefined,
        transportCost: transportCost.toFixed(2),
        customerName: user?.name || "Guest Customer",
        customerEmail: userEmail || "guest@example.com",
        customerPhone: user?.phone || "",
        customerCompany: user?.name || "",
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
    if (nextPaymentMethod !== "online_now") {
      setOnlinePaymentConfirmed(false);
    }
  };

  const handleDeliveryOptionChange = (value: string) => {
    setDeliveryOption(value as DeliveryOption);
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
        description: "We could not find a verified delivery address for this account.",
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
    setPaymentMethod("cash");
    setDeliveryOption("pickup");
    setDeliveryArea("");
    setOnlinePaymentConfirmed(false);
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
                    Choose how you want to pay and whether you will collect the order or receive delivery.
                  </p>
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
                      <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 cursor-pointer">
                        <RadioGroupItem value="cash" id="payment-cash" className="mt-1" />
                        <div>
                          <span className="font-medium text-gray-900">Cash</span>
                          <p className="text-sm text-gray-600 mt-1">Pay when the order is processed.</p>
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

                      <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 cursor-pointer">
                        <RadioGroupItem value="delivery" id="delivery-option" className="mt-1" />
                        <div>
                          <span className="font-medium text-gray-900">Delivery</span>
                          <p className="text-sm text-gray-600 mt-1">
                            Use your verified customer address for delivery.
                          </p>
                        </div>
                      </label>
                    </RadioGroup>

                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      {deliveryOption === "delivery" ? (
                        <>
                          {deliveryAddress ? (
                            <>
                              <p className="font-medium text-gray-900">Verified Delivery Address</p>
                              <p className="text-sm text-gray-600 mt-1">{deliveryAddress}</p>
                              <p className="text-xs text-gray-500 mt-2">
                                This address will be sent to the admin dashboard with the order.
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="font-medium text-amber-700">Delivery address missing</p>
                              <p className="text-sm text-amber-700 mt-1">
                                We could not find a verified delivery address on this account.
                              </p>
                            </>
                          )}

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

                <div className="space-y-2 mb-6">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal:</span>
                    <span className="font-medium">TZS {formatTzs(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax (18%):</span>
                    <span className="font-medium">TZS {formatTzs(tax)}</span>
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

                {isMissingDeliveryAddress && (
                  <p className="mb-4 text-sm text-red-600">
                    Delivery needs a verified address before this order can be submitted.
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
              <h3 className="text-xl font-semibold text-gray-800 mb-2">Order Sent Successfully!</h3>
              <p className="text-gray-600 mb-2">
                Your order has been sent to Phomas for processing.
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Payment: {getPaymentMethodLabel(paymentMethod)} | Fulfillment:{" "}
                {getDeliveryOptionLabel(deliveryOption)}
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
