import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { ecountService } from "@/services/ecountService";
import { Users, Package, AlertTriangle, Clock, CheckCircle, Edit, Trash2, Plus, Upload, UserCheck, MessageCircle } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { AdminProductManager } from "@/components/AdminProductManager";
import { BulkSyncManager } from "@/components/BulkSyncManager";
import type { User, Order, OrderItem } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Orders Management Component - shows all orders with customer attribution
function OrdersManagement() {
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
    queryFn: () => ecountService.getAllOrders(),
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

  const getErpSyncBadge = (syncStatus?: string | null) => {
    switch (syncStatus) {
      case "synced":
        return <Badge className="bg-green-100 text-green-800 text-xs">✓ ERP Synced</Badge>;
      case "failed":
        return <Badge className="bg-red-100 text-red-800 text-xs">✗ ERP Failed</Badge>;
      case "pending":
        return <Badge className="bg-amber-100 text-amber-800 text-xs">⏳ Pending</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800 text-xs">Unknown</Badge>;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All Customer Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-600">Loading orders...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (orders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All Customer Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No orders yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>All Customer Orders</CardTitle>
          <Badge variant="outline" className="text-sm">
            {orders.length} Total Orders
          </Badge>
        </div>
        <p className="text-sm text-gray-600 mt-2">
          Track which customer placed which order (all orders use eCount customer code 10839)
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Order #</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Customer</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Contact</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Date</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Items</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Total</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Status</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-700">ERP</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: Order) => {
                // Defensive parsing for order items
                let items: OrderItem[] = [];
                try {
                  items = JSON.parse(order.items);
                } catch (e) {
                  console.error(`Failed to parse items for order ${order.orderNumber}:`, e);
                }
                
                const firstItem = items[0];
                const remainingCount = items.length - 1;

                return (
                  <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50" data-testid={`order-row-${order.id}`}>
                    <td className="py-4 px-4">
                      <div className="font-medium text-phomas-green" data-testid={`order-number-${order.id}`}>
                        {order.orderNumber}
                      </div>
                      {order.erpDocNumber && (
                        <div className="text-xs text-gray-500">
                          eCount: {order.erpDocNumber}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-sm">
                        <div className="font-medium text-gray-900" data-testid={`customer-name-${order.id}`}>
                          {order.customerName || 'N/A'}
                        </div>
                        {order.customerCompany && (
                          <div className="text-gray-500 text-xs">{order.customerCompany}</div>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-xs space-y-1">
                        <div className="text-gray-700" data-testid={`customer-email-${order.id}`}>{order.customerEmail}</div>
                        {order.customerPhone && (
                          <div className="text-gray-500">{order.customerPhone}</div>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4 text-sm text-gray-600">
                      {order.createdAt ? format(new Date(order.createdAt), 'MMM d, yyyy') : 'N/A'}
                    </td>
                    <td className="py-4 px-4">
                      <div className="text-sm">
                        {firstItem ? (
                          <>
                            <div>{firstItem.name} ({firstItem.quantity}x)</div>
                            {remainingCount > 0 && (
                              <div className="text-gray-500 text-xs">
                                +{remainingCount} more item{remainingCount > 1 ? 's' : ''}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-gray-500 text-xs">No items</div>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4 font-semibold text-phomas-green">
                      TZS {Math.round(parseFloat(order.total)).toLocaleString()}
                    </td>
                    <td className="py-4 px-4">
                      <Badge className={`${getStatusColor(order.status)} text-xs capitalize`}>
                        {order.status}
                      </Badge>
                    </td>
                    <td className="py-4 px-4">
                      {getErpSyncBadge(order.erpSyncStatus)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPanel() {
  const { user, isAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Redirect non-admin users
  if (!isAdmin) {
    setLocation("/");
    return null;
  }

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["/api/admin/users"],
    queryFn: () => ecountService.getAllUsers(),
  });

  const { data: pendingUsers = [], isLoading: pendingLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/pending-users"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/pending-users");
      return await res.json();
    },
  });

  const approveUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/admin/approve-user/${userId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast({
        title: "User Approved",
        description: "The user can now access the store",
      });
    },
    onError: (error) => {
      toast({
        title: "Approval Failed",
        description: error instanceof Error ? error.message : "Failed to approve user",
        variant: "destructive",
      });
    },
  });

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["/api/products"],
    queryFn: () => ecountService.getProducts(),
  });

  // Create mock inventory alerts based on product data
  const inventoryAlerts = products.filter(p => p.isLowStock || p.isExpiringSoon).map(product => ({
    id: product.id,
    type: product.isLowStock ? 'low_stock' : 'expiring',
    productName: product.name,
    quantity: product.availableQuantity,
    expirationDate: product.expirationDate,
  }));

  const getRoleColor = (role: string) => {
    return role === "admin" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800";
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case "low_stock":
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case "expiring":
        return <Clock className="w-4 h-4 text-amber-500" />;
      default:
        return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
  };

  const getAlertColor = (type: string) => {
    switch (type) {
      case "low_stock":
        return "border-l-4 border-red-500 bg-red-50";
      case "expiring":
        return "border-l-4 border-amber-500 bg-amber-50";
      default:
        return "border-l-4 border-green-500 bg-green-50";
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-800">Admin Panel</h2>
          <p className="text-gray-600 mt-2">Manage users, products, and inventory</p>
        </div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="approvals">Pending Approvals</TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="products">Product Management</TabsTrigger>
            <TabsTrigger value="sync">Bulk Sync</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* User Management */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Users className="w-5 h-5" />
                <span>Registered Users</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="p-3 border border-gray-200 rounded-lg animate-pulse">
                      <div className="flex justify-between items-start">
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-200 rounded w-32" />
                          <div className="h-3 bg-gray-200 rounded w-24" />
                          <div className="h-4 bg-gray-200 rounded w-16" />
                        </div>
                        <div className="flex space-x-2">
                          <div className="h-6 w-6 bg-gray-200 rounded" />
                          <div className="h-6 w-6 bg-gray-200 rounded" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {users.map((userItem: User) => (
                    <div key={userItem.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                      <div>
                        <h4 className="font-medium text-gray-800">{userItem.companyName}</h4>
                        <p className="text-sm text-gray-600">{userItem.email}</p>
                        <Badge className={`text-xs mt-1 ${getRoleColor(userItem.role)}`}>
                          {userItem.role.charAt(0).toUpperCase() + userItem.role.slice(1)}
                        </Badge>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button variant="ghost" size="sm" className="text-phomas-blue hover:text-phomas-green">
                          <Edit className="w-4 h-4" />
                        </Button>
                        {userItem.role !== "admin" && (
                          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Inventory Management */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Package className="w-5 h-5" />
                <span>Inventory Alerts</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {productsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="p-3 rounded animate-pulse">
                      <div className="flex justify-between items-center">
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-200 rounded w-32" />
                          <div className="h-3 bg-gray-200 rounded w-48" />
                        </div>
                        <div className="h-6 w-6 bg-gray-200 rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : inventoryAlerts.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                  <p className="text-gray-600">All inventory levels are healthy</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {inventoryAlerts.map((alert) => (
                    <div key={alert.id} className={`p-3 rounded ${getAlertColor(alert.type)}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-800">
                            {alert.type === "low_stock" ? "Low Stock Alert" : "Expiration Warning"}
                          </h4>
                          <p className="text-sm text-gray-600">
                            {alert.productName} - {
                              alert.type === "low_stock" 
                                ? `Only ${alert.quantity} units left`
                                : `Expires ${alert.expirationDate ? format(new Date(alert.expirationDate), 'MMM d, yyyy') : 'soon'}`
                            }
                          </p>
                        </div>
                        {getAlertIcon(alert.type)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button className="w-full mt-4 bg-phomas-green hover:bg-phomas-green/90">
                <Plus className="w-4 h-4 mr-2" />
                Add New Product
              </Button>
            </CardContent>
          </Card>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Users</p>
                  <p className="text-2xl font-bold text-gray-900">{users.length}</p>
                </div>
                <Users className="h-8 w-8 text-phomas-green" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Products</p>
                  <p className="text-2xl font-bold text-gray-900">{products.length}</p>
                </div>
                <Package className="h-8 w-8 text-phomas-green" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Alerts</p>
                  <p className="text-2xl font-bold text-gray-900">{inventoryAlerts.length}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-amber-500" />
              </div>
            </CardContent>
          </Card>
            </div>
          </TabsContent>

          <TabsContent value="approvals">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <UserCheck className="w-5 h-5" />
                  <span>Pending User Approvals</span>
                  {pendingUsers.length > 0 && (
                    <Badge className="ml-2 bg-amber-500">{pendingUsers.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pendingLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="p-4 border border-gray-200 rounded-lg animate-pulse">
                        <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
                        <div className="h-3 bg-gray-200 rounded w-32 mb-2" />
                        <div className="h-3 bg-gray-200 rounded w-24" />
                      </div>
                    ))}
                  </div>
                ) : pendingUsers.length === 0 ? (
                  <div className="text-center py-12">
                    <UserCheck className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-600 mb-2">
                      No Pending Approvals
                    </h3>
                    <p className="text-sm text-gray-500">
                      All registered users have been approved
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {pendingUsers.map((pendingUser: any) => {
                      const whatsappNumber = pendingUser.phone?.replace(/[^0-9]/g, '') || '';
                      const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber}` : null;

                      return (
                        <div
                          key={pendingUser.id}
                          className="p-4 border border-amber-200 bg-amber-50 rounded-lg"
                          data-testid={`pending-user-${pendingUser.id}`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="font-semibold text-gray-800">
                                  {pendingUser.companyName}
                                </h4>
                                <Badge className="text-xs bg-amber-100 text-amber-800">
                                  {pendingUser.userType === 'company' ? 'Company' : 'Individual'}
                                </Badge>
                              </div>
                              <div className="space-y-1 text-sm text-gray-600">
                                <p><strong>Email:</strong> {pendingUser.email}</p>
                                {pendingUser.phone && (
                                  <p className="flex items-center gap-2">
                                    <strong>Phone:</strong> {pendingUser.phone}
                                    {whatsappUrl && (
                                      <a
                                        href={whatsappUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center text-green-600 hover:text-green-700"
                                        data-testid={`whatsapp-${pendingUser.id}`}
                                      >
                                        <MessageCircle className="w-4 h-4 ml-1" />
                                      </a>
                                    )}
                                  </p>
                                )}
                                {pendingUser.address && (
                                  <p><strong>Address:</strong> {pendingUser.address}</p>
                                )}
                                <p className="text-xs text-gray-500">
                                  <strong>Registered:</strong> {format(new Date(pendingUser.createdAt), 'MMM d, yyyy h:mm a')}
                                </p>
                              </div>
                            </div>
                            <div className="ml-4">
                              <Button
                                onClick={() => approveUserMutation.mutate(pendingUser.id)}
                                disabled={approveUserMutation.isPending}
                                className="bg-green-600 hover:bg-green-700"
                                data-testid={`approve-user-${pendingUser.id}`}
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                {approveUserMutation.isPending ? "Approving..." : "Approve"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="orders">
            <OrdersManagement />
          </TabsContent>
          
          <TabsContent value="products">
            <AdminProductManager />
          </TabsContent>
          
          <TabsContent value="sync">
            <BulkSyncManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
