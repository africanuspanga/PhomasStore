import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { ecountService } from "@/services/ecountService";
import { ShoppingCart as ShoppingCartIcon, Plus, Minus, Trash2, Send, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OrderItem } from "@shared/schema";

interface ShoppingCartProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShoppingCart({ isOpen, onClose }: ShoppingCartProps) {
  const { items, updateQuantity, removeItem, clearCart, subtotal, tax, total, itemCount } = useCart();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");

  const sendToEcountMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("User not authenticated");
      
      const orderItems: OrderItem[] = items.map(item => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        referenceNumber: item.referenceNumber,
      }));

      return ecountService.placeOrder({
        userId: user.id,
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
      toast({
        title: "Order failed",
        description: "There was an error processing your order. Please try again.",
        variant: "destructive",
      });
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
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50" onClick={onClose} />
      
      {/* Cart Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-xl z-50 overflow-y-auto">
        <Card className="h-full rounded-none border-0">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center space-x-2">
                <ShoppingCartIcon className="h-5 w-5" />
                <span>Shopping Cart</span>
                {itemCount > 0 && (
                  <Badge variant="secondary">{itemCount}</Badge>
                )}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={onClose}>
                ×
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 p-6">
            {items.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-800 mb-2">Your cart is empty</h3>
                <p className="text-gray-600">Add some medical supplies to get started</p>
              </div>
            ) : (
              <>
                <div className="space-y-4 mb-6">
                  {items.map((item) => (
                    <div
                      key={item.productId}
                      className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg"
                    >
                      <img
                        src={item.imageUrl || "https://images.unsplash.com/photo-1584362917165-526a968579e8?ixlib=rb-4.0.3&auto=format&fit=crop&w=60&h=60"}
                        alt={item.name}
                        className="w-12 h-12 object-cover rounded"
                      />
                      
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm text-gray-800 truncate">{item.name}</h4>
                        <p className="text-xs text-gray-500">{item.referenceNumber}</p>
                        <p className="text-sm font-medium text-phomas-green">
                          TZS {parseFloat(item.price).toLocaleString()}
                        </p>
                        
                        <div className="flex items-center space-x-2 mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            className="h-6 w-6 p-0"
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="text-sm font-medium w-8 text-center">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                            className="h-6 w-6 p-0"
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(item.productId)}
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-700 ml-2"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <p className="font-bold text-sm text-phomas-green">
                          TZS {(parseFloat(item.price) * item.quantity).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Subtotal:</span>
                      <span className="font-medium">TZS {subtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Tax (18%):</span>
                      <span className="font-medium">TZS {tax.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-phomas-green">
                      <span>Total:</span>
                      <span>TZS {total.toLocaleString()}</span>
                    </div>
                  </div>

                  <Button
                    onClick={handleSendToEcount}
                    disabled={sendToEcountMutation.isPending}
                    className="w-full bg-phomas-green hover:bg-phomas-green/90 py-3 font-semibold"
                  >
                    {sendToEcountMutation.isPending ? (
                      "Processing..."
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        PAY NOW
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-60 flex items-center justify-center p-4">
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
