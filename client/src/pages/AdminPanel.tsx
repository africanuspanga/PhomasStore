import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { ecountService } from "@/services/ecountService";
import { Users, Package, AlertTriangle, Clock, CheckCircle, Edit, Trash2, Plus, Upload, UserCheck, MessageCircle, Shield, Eye, EyeOff, Lock } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { AdminProductManager } from "@/components/AdminProductManager";
import { BulkSyncManager } from "@/components/BulkSyncManager";
import type { User, Order, OrderItem } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

// Extended User type for admin panel (includes Supabase metadata fields)
interface AdminPanelUser extends Omit<User, 'password'> {
  userType?: string;
  phone?: string;
  address?: string;
  brelaNumber?: string;
  tinNumber?: string;
  emailConfirmed?: boolean;
  lastSignIn?: Date | null;
}

// Orders Management Component - shows all orders with customer attribution
function OrdersManagement() {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const { toast } = useToast();
  
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ["/api/orders"],
    queryFn: () => ecountService.getAllOrders(),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await apiRequest("DELETE", `/api/admin/orders/${orderId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setOrderToDelete(null);
      toast({
        title: "Order Deleted",
        description: "The order has been successfully removed",
      });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete order",
        variant: "destructive",
      });
    },
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
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Action</th>
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
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <Button 
                          variant="link" 
                          className="text-phomas-blue hover:underline text-sm p-0"
                          onClick={() => setSelectedOrder(order)}
                          data-testid={`button-view-order-${order.id}`}
                        >
                          View Details
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 h-7 w-7"
                          onClick={() => setOrderToDelete(order)}
                          data-testid={`button-delete-order-${order.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>

      {/* Delete Order Confirmation Dialog */}
      <AlertDialog open={!!orderToDelete} onOpenChange={(open) => !open && setOrderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete order <strong>{orderToDelete?.orderNumber}</strong>?
              <br /><br />
              This action cannot be undone. The order will be permanently removed from the system.
              {orderToDelete?.erpSyncStatus === 'synced' && (
                <p className="mt-2 text-amber-600 font-medium">
                  Note: This order was already synced to eCount. Deleting it here will not remove it from the ERP system.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => orderToDelete && deleteOrderMutation.mutate(orderToDelete.id)}
              disabled={deleteOrderMutation.isPending}
            >
              {deleteOrderMutation.isPending ? "Deleting..." : "Delete Order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Order Details Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-phomas-green">
              Order Details - {selectedOrder?.orderNumber}
            </DialogTitle>
          </DialogHeader>

          {selectedOrder && (() => {
            let orderItems: OrderItem[] = [];
            try {
              orderItems = JSON.parse(selectedOrder.items);
            } catch (e) {
              console.error('Failed to parse order items:', e);
            }

            return (
              <div className="space-y-6 mt-4">
                {/* Customer Info */}
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-semibold text-gray-800 mb-3">Customer Information</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-500">Name</p>
                      <p className="font-medium">{selectedOrder.customerName || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Company</p>
                      <p className="font-medium">{selectedOrder.customerCompany || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Email</p>
                      <p className="font-medium">{selectedOrder.customerEmail}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Phone</p>
                      <p className="font-medium">{selectedOrder.customerPhone || 'N/A'}</p>
                    </div>
                  </div>
                </div>

                {/* Order Status */}
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm text-gray-500">Order Status</p>
                    <Badge className={`mt-1 ${getStatusColor(selectedOrder.status)}`}>
                      <span className="capitalize">{selectedOrder.status}</span>
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Date Placed</p>
                    <p className="font-medium">
                      {selectedOrder.createdAt ? format(new Date(selectedOrder.createdAt), 'MMM d, yyyy \'at\' h:mm a') : 'N/A'}
                    </p>
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
                  <h4 className="font-semibold text-gray-800 mb-3">Order Items ({orderItems.length})</h4>
                  <div className="space-y-3">
                    {orderItems.map((item, index) => (
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
                <div className="p-3 bg-gray-50 rounded-lg text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-600">
                        <span className="font-medium">ERP Sync:</span>{' '}
                        {selectedOrder.erpSyncStatus === 'synced' ? (
                          <span className="text-green-600">Synced to eCount</span>
                        ) : selectedOrder.erpSyncStatus === 'failed' ? (
                          <span className="text-red-600">Sync failed</span>
                        ) : (
                          <span className="text-amber-600">Pending sync</span>
                        )}
                      </p>
                      {selectedOrder.erpDocNumber && (
                        <p className="text-gray-500 mt-1">eCount Document: {selectedOrder.erpDocNumber}</p>
                      )}
                    </div>
                    {getErpSyncBadge(selectedOrder.erpSyncStatus)}
                  </div>
                </div>

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
            );
          })()}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Security Management Component - admin password change
function SecurityManagement() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const changePasswordMutation = useMutation({
    mutationFn: async (data: { oldPassword: string; newPassword: string }) => {
      const res = await apiRequest("POST", "/api/admin/change-password", data);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Password Changed",
        description: data.message || "Your password has been updated. Please log in again.",
      });
      // Clear form
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // Logout and redirect to admin login
      logout();
      setLocation("/admin/login");
    },
    onError: (error) => {
      toast({
        title: "Password Change Failed",
        description: error instanceof Error ? error.message : "Failed to change password",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!oldPassword || !newPassword || !confirmPassword) {
      toast({
        title: "Validation Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Validation Error",
        description: "New password and confirmation do not match",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 8) {
      toast({
        title: "Validation Error",
        description: "New password must be at least 8 characters long",
        variant: "destructive",
      });
      return;
    }

    if (!/[A-Z]/.test(newPassword)) {
      toast({
        title: "Validation Error",
        description: "New password must contain at least one uppercase letter",
        variant: "destructive",
      });
      return;
    }

    if (!/[a-z]/.test(newPassword)) {
      toast({
        title: "Validation Error",
        description: "New password must contain at least one lowercase letter",
        variant: "destructive",
      });
      return;
    }

    if (!/[0-9]/.test(newPassword)) {
      toast({
        title: "Validation Error",
        description: "New password must contain at least one number",
        variant: "destructive",
      });
      return;
    }

    changePasswordMutation.mutate({ oldPassword, newPassword });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-phomas-green" />
          Security Settings
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-w-md">
          <div className="mb-6">
            <h3 className="text-lg font-semibold flex items-center gap-2 mb-2">
              <Lock className="w-4 h-4" />
              Change Admin Password
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Update your admin password. After changing, you will be logged out and need to sign in again.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="oldPassword">Current Password</Label>
              <div className="relative">
                <Input
                  id="oldPassword"
                  type={showOldPassword ? "text" : "password"}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Enter current password"
                  data-testid="input-old-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  onClick={() => setShowOldPassword(!showOldPassword)}
                  data-testid="toggle-old-password"
                >
                  {showOldPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  data-testid="toggle-new-password"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Password must be at least 8 characters with one uppercase, one lowercase, and one number.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  data-testid="input-confirm-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  data-testid="toggle-confirm-password"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-phomas-green hover:bg-phomas-green/90"
              disabled={changePasswordMutation.isPending}
              data-testid="button-change-password"
            >
              {changePasswordMutation.isPending ? "Changing Password..." : "Change Password"}
            </Button>
          </form>
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

  const { data: users = [], isLoading: usersLoading } = useQuery<AdminPanelUser[]>({
    queryKey: ["/api/admin/users"],
    queryFn: () => ecountService.getAllUsers(),
  });

  const { data: pendingUsers = [], isLoading: pendingLoading } = useQuery<AdminPanelUser[]>({
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

  // State for edit and delete dialogs
  const [editingUser, setEditingUser] = useState<AdminPanelUser | null>(null);
  const [editFormData, setEditFormData] = useState({ companyName: '', phone: '', address: '', brelaNumber: '', tinNumber: '', userType: 'company' });
  const [userToDelete, setUserToDelete] = useState<AdminPanelUser | null>(null);

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("DELETE", `/api/admin/users/${userId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setUserToDelete(null);
      toast({
        title: "User Deleted",
        description: "The user has been removed from the system",
      });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete user",
        variant: "destructive",
      });
    },
  });

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: typeof editFormData }) => {
      const res = await apiRequest("PUT", `/api/admin/users/${userId}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setEditingUser(null);
      toast({
        title: "User Updated",
        description: "User information has been updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error instanceof Error ? error.message : "Failed to update user",
        variant: "destructive",
      });
    },
  });

  // Open edit dialog with user data
  const handleEditUser = (userItem: AdminPanelUser) => {
    setEditFormData({
      companyName: userItem.companyName || '',
      phone: userItem.phone || '',
      address: userItem.address || '',
      brelaNumber: userItem.brelaNumber || '',
      tinNumber: userItem.tinNumber || '',
      userType: userItem.userType || 'company',
    });
    setEditingUser(userItem);
  };

  // Submit edit form
  const handleSaveUser = () => {
    if (editingUser) {
      updateUserMutation.mutate({ userId: editingUser.id, data: editFormData });
    }
  };

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
            <TabsTrigger value="security">Security</TabsTrigger>
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
                  {users.map((userItem: AdminPanelUser) => (
                    <div key={userItem.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-800">{userItem.companyName}</h4>
                        <p className="text-sm text-gray-600">{userItem.email}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge className={`text-xs ${getRoleColor(userItem.role)}`}>
                            {userItem.role.charAt(0).toUpperCase() + userItem.role.slice(1)}
                          </Badge>
                          {userItem.userType && (
                            <Badge className="text-xs bg-gray-100 text-gray-700">
                              {userItem.userType === 'company' ? 'Company' : userItem.userType === 'licensed_trader' ? 'Licensed Trader' : 'Individual'}
                            </Badge>
                          )}
                        </div>
                        {(userItem.brelaNumber || userItem.tinNumber) && (
                          <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                            {userItem.brelaNumber && (
                              <p><strong>Brela #:</strong> {userItem.brelaNumber}</p>
                            )}
                            {userItem.tinNumber && (
                              <p><strong>TIN #:</strong> {userItem.tinNumber}</p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-phomas-blue hover:text-phomas-green"
                          onClick={() => handleEditUser(userItem)}
                          data-testid={`edit-user-${userItem.id}`}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        {userItem.role !== "admin" && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="text-red-500 hover:text-red-700"
                            onClick={() => setUserToDelete(userItem)}
                            data-testid={`delete-user-${userItem.id}`}
                          >
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
                    {pendingUsers.map((pendingUser: AdminPanelUser) => {
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
                                  {pendingUser.userType === 'company' ? 'Company' : pendingUser.userType === 'licensed_trader' ? 'Licensed Trader' : 'Individual'}
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
                                {pendingUser.brelaNumber && (
                                  <p><strong>Brela Registration #:</strong> {pendingUser.brelaNumber}</p>
                                )}
                                {pendingUser.tinNumber && (
                                  <p><strong>TIN #:</strong> {pendingUser.tinNumber}</p>
                                )}
                                {pendingUser.createdAt && (
                                  <p className="text-xs text-gray-500">
                                    <strong>Registered:</strong> {format(new Date(pendingUser.createdAt), 'MMM d, yyyy h:mm a')}
                                  </p>
                                )}
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

          <TabsContent value="security">
            <SecurityManagement />
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit User: {editingUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input
                id="companyName"
                value={editFormData.companyName}
                onChange={(e) => setEditFormData({ ...editFormData, companyName: e.target.value })}
                data-testid="edit-company-name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={editFormData.phone}
                onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                data-testid="edit-phone"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={editFormData.address}
                onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                data-testid="edit-address"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="brelaNumber">Brela Registration #</Label>
              <Input
                id="brelaNumber"
                value={editFormData.brelaNumber}
                onChange={(e) => setEditFormData({ ...editFormData, brelaNumber: e.target.value })}
                data-testid="edit-brela"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tinNumber">TIN #</Label>
              <Input
                id="tinNumber"
                value={editFormData.tinNumber}
                onChange={(e) => setEditFormData({ ...editFormData, tinNumber: e.target.value })}
                data-testid="edit-tin"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="userType">User Type</Label>
              <Select
                value={editFormData.userType}
                onValueChange={(value) => setEditFormData({ ...editFormData, userType: value })}
              >
                <SelectTrigger data-testid="edit-user-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">Company</SelectItem>
                  <SelectItem value="licensed_trader">Licensed Trader</SelectItem>
                  <SelectItem value="individual">Individual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)} data-testid="cancel-edit">
              Cancel
            </Button>
            <Button 
              onClick={handleSaveUser} 
              disabled={updateUserMutation.isPending}
              data-testid="save-user"
            >
              {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation Dialog */}
      <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{userToDelete?.companyName}</strong> ({userToDelete?.email})? 
              This action cannot be undone and will remove the user from the system permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => userToDelete && deleteUserMutation.mutate(userToDelete.id)}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteUserMutation.isPending}
              data-testid="confirm-delete"
            >
              {deleteUserMutation.isPending ? "Deleting..." : "Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
