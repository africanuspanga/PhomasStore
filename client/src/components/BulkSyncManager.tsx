import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { 
  RefreshCw, 
  Database, 
  Package, 
  Trash2, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  Info
} from "lucide-react";
import { format } from "date-fns";

interface CacheStatus {
  size: number;
  lastUpdated: string | null;
  isExpired: boolean;
}

export function BulkSyncManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [lastSyncTimes, setLastSyncTimes] = useState<{
    products?: string;
    inventory?: string;
  }>({});

  // Get cache status
  const { data: cacheStatus, refetch: refetchCacheStatus } = useQuery<CacheStatus>({
    queryKey: ['/api/admin/cache-status'],
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Bulk product sync mutation
  const bulkSyncProductsMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/bulk-sync-products'),
    onSuccess: (data: any) => {
      toast({
        title: "Product sync completed",
        description: `Successfully synced ${data.data?.productsCount || 0} products from eCount`,
      });
      setLastSyncTimes(prev => ({ 
        ...prev, 
        products: new Date().toISOString() 
      }));
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      refetchCacheStatus();
    },
    onError: (error: any) => {
      toast({
        title: "Product sync failed",
        description: error.message || "Failed to sync products from eCount",
        variant: "destructive",
      });
    },
  });

  // Bulk inventory sync mutation
  const bulkSyncInventoryMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/bulk-sync-inventory'),
    onSuccess: (data: any) => {
      toast({
        title: "Inventory sync completed",
        description: `Successfully synced ${data.data?.inventoryCount || 0} inventory records from eCount`,
      });
      setLastSyncTimes(prev => ({ 
        ...prev, 
        inventory: new Date().toISOString() 
      }));
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      refetchCacheStatus();
    },
    onError: (error: any) => {
      toast({
        title: "Inventory sync failed",
        description: error.message || "Failed to sync inventory from eCount",
        variant: "destructive",
      });
    },
  });

  // Clear cache mutation
  const clearCacheMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/admin/clear-cache'),
    onSuccess: () => {
      toast({
        title: "Cache cleared",
        description: "Inventory cache has been cleared successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      refetchCacheStatus();
    },
    onError: (error: any) => {
      toast({
        title: "Cache clear failed",
        description: error.message || "Failed to clear cache",
        variant: "destructive",
      });
    },
  });

  const formatLastUpdated = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
  };

  const getTimeAgo = (timestamp: string | null) => {
    if (!timestamp) return null;
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 1000 / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ago`;
    }
    return `${minutes}m ago`;
  };

  return (
    <div className="space-y-6">
      {/* Rate Limit Warning */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-6">
          <div className="flex items-start space-x-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-amber-800">API Rate Limits</h4>
              <p className="text-sm text-amber-700 mt-1">
                eCount bulk sync APIs are limited to <strong>1 call every 10 minutes</strong>. 
                Use bulk sync for daily/weekly operations, not frequent updates.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cache Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Database className="w-5 h-5" />
            <span>Inventory Cache Status</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">
                {cacheStatus?.size || 0}
              </div>
              <div className="text-sm text-gray-600">Cached Products</div>
            </div>
            
            <div className="text-center">
              <div className="text-sm font-medium text-gray-900">
                {formatLastUpdated(cacheStatus?.lastUpdated || null)}
              </div>
              <div className="text-sm text-gray-600">
                {cacheStatus?.lastUpdated ? getTimeAgo(cacheStatus.lastUpdated) : ''}
              </div>
            </div>
            
            <div className="text-center">
              <Badge 
                variant={cacheStatus?.isExpired ? "destructive" : "default"}
                className="text-xs"
              >
                {cacheStatus?.isExpired ? (
                  <>
                    <Clock className="w-3 h-3 mr-1" />
                    Expired
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Fresh
                  </>
                )}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Sync Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Product Sync */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Package className="w-5 h-5" />
              <span>Product Catalog Sync</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              Download complete product catalog from eCount including names, codes, and specifications.
            </p>
            
            {lastSyncTimes.products && (
              <div className="text-xs text-gray-500">
                Last sync: {formatLastUpdated(lastSyncTimes.products)}
              </div>
            )}
            
            <Button
              onClick={() => bulkSyncProductsMutation.mutate()}
              disabled={bulkSyncProductsMutation.isPending}
              className="w-full"
              data-testid="button-bulk-sync-products"
            >
              {bulkSyncProductsMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Syncing Products...
                </>
              ) : (
                <>
                  <Package className="w-4 h-4 mr-2" />
                  Sync Products
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Inventory Sync */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Database className="w-5 h-5" />
              <span>Inventory Sync</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              Download all inventory quantities from eCount for accurate stock levels.
            </p>
            
            {lastSyncTimes.inventory && (
              <div className="text-xs text-gray-500">
                Last sync: {formatLastUpdated(lastSyncTimes.inventory)}
              </div>
            )}
            
            <Button
              onClick={() => bulkSyncInventoryMutation.mutate()}
              disabled={bulkSyncInventoryMutation.isPending}
              className="w-full"
              data-testid="button-bulk-sync-inventory"
            >
              {bulkSyncInventoryMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Syncing Inventory...
                </>
              ) : (
                <>
                  <Database className="w-4 h-4 mr-2" />
                  Sync Inventory
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Cache Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Trash2 className="w-5 h-5" />
            <span>Cache Management</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start space-x-3">
            <Info className="h-4 w-4 text-blue-600 mt-0.5" />
            <div className="text-sm text-gray-600">
              Clear the inventory cache to force fresh data retrieval. The cache automatically expires after 1 hour.
            </div>
          </div>
          
          <Button
            variant="outline"
            onClick={() => clearCacheMutation.mutate()}
            disabled={clearCacheMutation.isPending}
            className="w-full"
            data-testid="button-clear-cache"
          >
            {clearCacheMutation.isPending ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Clearing Cache...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Cache
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}