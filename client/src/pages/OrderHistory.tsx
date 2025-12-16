import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { ecountService } from "@/services/ecountService";
import { History, Package, Truck, Clock, X } from "lucide-react";
import { format } from "date-fns";
import type { Order, OrderItem } from "@shared/schema";

export default function OrderHistory() {
  const { user } = useAuth();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ["/api/orders/user", user?.id],
    queryFn: () => user ? ecountService.getOrdersByUserId(user.id) : Promise.resolve([]),
    enabled: !!user,
  });

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "delivered":
        return "bg-green-100 text-green-800";
      case "shipped":
        return "bg-blue-100 text-blue-800";
      case "processing":
        return "bg-amber-100 text-amber-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case "delivered":
        return <Package className="w-4 h-4" />;
      case "shipped":
        return <Truck className="w-4 h-4" />;
      case "processing":
        return <Clock className="w-4 h-4" />;
      default:
        return <Package className="w-4 h-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Order History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="p-4 border border-gray-200 rounded-lg animate-pulse">
                    <div className="flex justify-between items-start">
                      <div className="space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-32" />
                        <div className="h-3 bg-gray-200 rounded w-24" />
                        <div className="h-3 bg-gray-200 rounded w-48" />
                      </div>
                      <div className="space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-16" />
                        <div className="h-6 bg-gray-200 rounded w-20" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardContent className="text-center py-12">
              <History className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-800 mb-2">Error loading orders</h3>
              <p className="text-gray-600">Please try refreshing the page</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <Card>
            <CardContent className="text-center py-12">
              <History className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-800 mb-2">No orders yet</h3>
              <p className="text-gray-600">Your order history will appear here once you place your first order</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Order History</CardTitle>
          </CardHeader>
          
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Order ID</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Items</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Total</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order: Order) => {
                    const items: OrderItem[] = JSON.parse(order.items);
                    const firstItem = items[0];
                    const remainingCount = items.length - 1;

                    return (
                      <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-4 px-4">
                          <span className="font-medium text-phomas-green">{order.orderNumber}</span>
                        </td>
                        <td className="py-4 px-4 text-gray-600">
                          {order.createdAt ? format(new Date(order.createdAt), 'MMM d, yyyy') : 'N/A'}
                        </td>
                        <td className="py-4 px-4">
                          <div className="text-sm">
                            <div>{firstItem.name} ({firstItem.quantity}x)</div>
                            {remainingCount > 0 && (
                              <div className="text-gray-500">+{remainingCount} more item{remainingCount > 1 ? 's' : ''}</div>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 font-semibold text-phomas-green">
                          TZS {Math.round(parseFloat(order.total)).toLocaleString()}
                        </td>
                        <td className="py-4 px-4">
                          <Badge className={`flex items-center space-x-1 ${getStatusColor(order.status)}`}>
                            {getStatusIcon(order.status)}
                            <span className="capitalize">{order.status}</span>
                          </Badge>
                        </td>
                        <td className="py-4 px-4">
                          <Button 
                            variant="link" 
                            className="text-phomas-blue hover:underline text-sm p-0"
                            onClick={() => setSelectedOrder(order)}
                            data-testid={`button-view-order-${order.id}`}
                          >
                            {order.status === "shipped" ? "Track Order" : "View Details"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Order Details Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-phomas-green">
              Order Details - {selectedOrder?.orderNumber}
            </DialogTitle>
            <DialogDescription>
              Placed on {selectedOrder?.createdAt ? format(new Date(selectedOrder.createdAt), 'MMMM d, yyyy \'at\' h:mm a') : 'N/A'}
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-6 mt-4">
              {/* Order Status */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm text-gray-500">Order Status</p>
                  <Badge className={`mt-1 ${getStatusColor(selectedOrder.status)}`}>
                    {getStatusIcon(selectedOrder.status)}
                    <span className="ml-1 capitalize">{selectedOrder.status}</span>
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">Total Amount</p>
                  <p className="text-xl font-bold text-phomas-green">
                    TZS {Math.round(parseFloat(selectedOrder.total)).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Order Items */}
              <div>
                <h4 className="font-semibold text-gray-800 mb-3">Order Items</h4>
                <div className="space-y-3">
                  {(JSON.parse(selectedOrder.items) as OrderItem[]).map((item, index) => (
                    <div key={index} className="flex justify-between items-center p-3 border border-gray-200 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-800">{item.name}</p>
                        <p className="text-sm text-gray-500">Ref: {item.referenceNumber}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600">{item.quantity}x @ TZS {parseFloat(item.price).toLocaleString()}</p>
                        <p className="font-semibold text-phomas-green">
                          TZS {Math.round(item.quantity * parseFloat(item.price)).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Order Summary */}
              <div className="border-t pt-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal</span>
                    <span>TZS {Math.round(parseFloat(selectedOrder.subtotal)).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax (18% VAT)</span>
                    <span>TZS {Math.round(parseFloat(selectedOrder.tax)).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t pt-2">
                    <span>Total</span>
                    <span className="text-phomas-green">TZS {Math.round(parseFloat(selectedOrder.total)).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* ERP Sync Status */}
              {selectedOrder.erpSyncStatus && (
                <div className="p-3 bg-gray-50 rounded-lg text-sm">
                  <p className="text-gray-600">
                    <span className="font-medium">ERP Sync:</span>{' '}
                    {selectedOrder.erpSyncStatus === 'synced' ? (
                      <span className="text-green-600">Synced to eCount</span>
                    ) : selectedOrder.erpSyncStatus === 'failed' ? (
                      <span className="text-red-600">Sync failed - will retry</span>
                    ) : (
                      <span className="text-amber-600">Pending sync</span>
                    )}
                  </p>
                  {selectedOrder.erpDocNumber && (
                    <p className="text-gray-500 mt-1">ERP Document: {selectedOrder.erpDocNumber}</p>
                  )}
                </div>
              )}

              {/* Close Button */}
              <div className="flex justify-end pt-2">
                <Button 
                  onClick={() => setSelectedOrder(null)}
                  className="bg-phomas-green hover:bg-phomas-green/90"
                  data-testid="button-close-order-details"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
