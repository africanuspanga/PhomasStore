import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { ecountService } from "@/services/ecountService";
import { ShoppingCart, ArrowLeft, Plus, Minus, Trash2, Send } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OrderItem } from "@shared/schema";

export default function Cart() {
  const { items, updateQuantity, removeItem, clearCart, subtotal, tax, total } = useCart();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");

  const sendToEcountMutation = useMutation({
    mutationFn: async () => {
      // Allow guest checkout - userId will be set by backend
      const userId = user?.id || 'guest-user';
      
      const orderItems: OrderItem[] = items.map(item => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        referenceNumber: item.referenceNumber,
      }));

      return ecountService.placeOrder({
        userId: userId,
        items: JSON.stringify(orderItems),
        subtotal: subtotal.toFixed(2),
        tax: tax.toFixed(2),
        total: total.toFixed(2),
        status: "processing",
      });
    },
    onSuccess: (data) => {
      setOrderNumber(data.order.orderNumber);
      setShowSuccessModal(true);
      clearCart();
      // Invalidate products query to refresh inventory
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error) => {
      console.error('Order submission error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a rate limit error
      if (errorMessage.includes('412') || errorMessage.includes('rate limit')) {
        toast({
          title: "System Busy",
          description: "eCount system is rate limited. Please wait 30 seconds and try again.",
          variant: "destructive",
          duration: 10000,
        });
      } else if (errorMessage.includes('502')) {
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

  const handleSendToEcount = () => {
    if (items.length === 0) {
      toast({
        title: "Cart is empty",
        description: "Please add items to your cart before placing an order.",
        variant: "destructive",
      });
      return;
    }
    sendToEcountMutation.mutate();
  };

  const handleCloseSuccessModal = () => {
    setShowSuccessModal(false);
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
                        src={item.imageUrl || "https://images.unsplash.com/photo-1584362917165-526a968579e8?ixlib=rb-4.0.3&auto=format&fit=crop&w=80&h=80"}
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
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.productId, parseInt(e.target.value) || 1)}
                          className="w-16 text-center"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
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
                <div className="space-y-2 mb-6">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal:</span>
                    <span className="font-medium">TZS {Math.round(subtotal).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax (18%):</span>
                    <span className="font-medium">TZS {Math.round(tax).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold text-phomas-green">
                    <span>Total:</span>
                    <span>TZS {Math.round(total).toLocaleString()}</span>
                  </div>
                </div>

                <Button
                  onClick={handleSendToEcount}
                  disabled={sendToEcountMutation.isPending}
                  className="w-full bg-phomas-green hover:bg-phomas-green/90 py-4 text-lg font-semibold"
                >
                  {sendToEcountMutation.isPending ? (
                    "Processing..."
                  ) : (
                    <>
                      <Send className="w-5 h-5 mr-2" />
                      PAY NOW
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardContent className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">Order Sent Successfully!</h3>
              <p className="text-gray-600 mb-4">Your order has been sent to E-count for processing.</p>
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
