import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { ecountService } from "@/services/ecountService";
import { Users, Package, AlertTriangle, Clock, CheckCircle, Edit, Trash2, Plus, Upload } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { AdminProductManager } from "@/components/AdminProductManager";
import type { User } from "@shared/schema";

export default function AdminPanel() {
  const { user, isAdmin } = useAuth();
  const [, setLocation] = useLocation();

  // Redirect non-admin users
  if (!isAdmin) {
    setLocation("/");
    return null;
  }

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["/api/admin/users"],
    queryFn: () => ecountService.getAllUsers(),
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
            <TabsTrigger value="products">Product Management</TabsTrigger>
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
          
          <TabsContent value="products">
            <AdminProductManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
