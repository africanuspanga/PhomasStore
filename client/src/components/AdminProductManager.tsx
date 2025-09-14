import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Package, Edit, Upload, Eye, AlertTriangle, CheckCircle } from 'lucide-react';
import { ecountService } from '@/services/ecountService';
import { ImageUpload } from './ImageUpload';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { ProductWithInventory } from '@shared/schema';

export function AdminProductManager() {
  const [selectedProduct, setSelectedProduct] = useState<ProductWithInventory | null>(null);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: products = [], isLoading, refetch } = useQuery({
    queryKey: ['/api/products'],
    queryFn: () => ecountService.getProducts(),
  });

  const updateImageMutation = useMutation({
    mutationFn: async ({ productId, imageUrl }: { productId: string; imageUrl: string }) => {
      const response = await apiRequest('PUT', `/api/admin/products/${productId}/image`, { imageUrl });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      toast({
        title: "Image updated successfully",
        description: "The product image has been updated",
      });
      setImageDialogOpen(false);
      setSelectedProduct(null);
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Failed to update product image",
        variant: "destructive",
      });
    }
  });

  const handleImageUpload = (imageUrl: string) => {
    if (selectedProduct && imageUrl) {
      updateImageMutation.mutate({ productId: selectedProduct.id, imageUrl });
    }
  };

  const openImageDialog = (product: ProductWithInventory) => {
    setSelectedProduct(product);
    setImageDialogOpen(true);
  };

  const getStockStatus = (product: ProductWithInventory) => {
    if (product.availableQuantity === 0) {
      return { label: 'Out of Stock', color: 'bg-red-100 text-red-800', icon: AlertTriangle };
    }
    if (product.isLowStock) {
      return { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-800', icon: AlertTriangle };
    }
    return { label: 'In Stock', color: 'bg-green-100 text-green-800', icon: CheckCircle };
  };

  const formatPrice = (price: string) => {
    return `TZS ${parseInt(price).toLocaleString()}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Package className="w-5 h-5" />
            <span>Product Management</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border rounded-lg p-4 animate-pulse">
                <div className="h-32 bg-gray-200 rounded mb-4" />
                <div className="h-4 bg-gray-200 rounded mb-2" />
                <div className="h-4 bg-gray-200 rounded w-3/4" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Package className="w-5 h-5" />
            <span>Product Management</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="grid" className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="grid">Grid View</TabsTrigger>
              <TabsTrigger value="table">Table View</TabsTrigger>
            </TabsList>
            
            <TabsContent value="grid">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map((product) => {
                  const status = getStockStatus(product);
                  const StatusIcon = status.icon;
                  
                  return (
                    <Card key={product.id} className="overflow-hidden">
                      <div className="aspect-video bg-gray-100 relative group">
                        <img
                          src={product.imageUrl || 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300'}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all duration-200 flex items-center justify-center">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity space-x-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openImageDialog(product)}
                              data-testid={`button-edit-image-${product.id}`}
                            >
                              <Upload className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                      
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-semibold text-sm line-clamp-2" data-testid={`text-product-name-${product.id}`}>
                            {product.name}
                          </h3>
                          <Badge className={status.color}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {status.label}
                          </Badge>
                        </div>
                        
                        <div className="space-y-1 text-xs text-gray-600">
                          <p>Ref: {product.referenceNumber}</p>
                          <p>Package: {product.packaging}</p>
                          <p className="font-medium">{formatPrice(product.price)}</p>
                          <p>Stock: {product.availableQuantity} units</p>
                          {(product as any).hasRealTimeData && (
                            <Badge variant="outline" className="text-xs">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Live Data
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>
            
            <TabsContent value="table">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 p-3 text-left">Image</th>
                      <th className="border border-gray-200 p-3 text-left">Product</th>
                      <th className="border border-gray-200 p-3 text-left">Reference</th>
                      <th className="border border-gray-200 p-3 text-left">Price</th>
                      <th className="border border-gray-200 p-3 text-left">Stock</th>
                      <th className="border border-gray-200 p-3 text-left">Status</th>
                      <th className="border border-gray-200 p-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => {
                      const status = getStockStatus(product);
                      const StatusIcon = status.icon;
                      
                      return (
                        <tr key={product.id} className="hover:bg-gray-50">
                          <td className="border border-gray-200 p-3">
                            <img
                              src={product.imageUrl || 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300'}
                              alt={product.name}
                              className="w-12 h-12 object-cover rounded"
                            />
                          </td>
                          <td className="border border-gray-200 p-3">
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-sm text-gray-600">{product.packaging}</p>
                            </div>
                          </td>
                          <td className="border border-gray-200 p-3 font-mono text-sm">
                            {product.referenceNumber}
                          </td>
                          <td className="border border-gray-200 p-3 font-medium">
                            {formatPrice(product.price)}
                          </td>
                          <td className="border border-gray-200 p-3">
                            {product.availableQuantity} units
                          </td>
                          <td className="border border-gray-200 p-3">
                            <Badge className={status.color}>
                              <StatusIcon className="w-3 h-3 mr-1" />
                              {status.label}
                            </Badge>
                          </td>
                          <td className="border border-gray-200 p-3">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openImageDialog(product)}
                              data-testid={`button-manage-${product.id}`}
                            >
                              <Edit className="w-4 h-4 mr-1" />
                              Edit Image
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update Product Image</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-4">
              <div className="text-sm">
                <h4 className="font-medium">{selectedProduct.name}</h4>
                <p className="text-gray-600">Ref: {selectedProduct.referenceNumber}</p>
              </div>
              
              <ImageUpload
                currentImage={selectedProduct.imageUrl || undefined}
                onImageUploaded={handleImageUpload}
              />
              
              <div className="flex justify-end space-x-2">
                <Button 
                  variant="outline" 
                  onClick={() => setImageDialogOpen(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}