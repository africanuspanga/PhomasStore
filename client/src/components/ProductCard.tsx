import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { ShoppingCart, Clock, AlertTriangle } from "lucide-react";
import { getImageWithFallback } from "@/hooks/useProductImages";
import type { ProductWithInventory } from "@shared/schema";

interface ProductCardProps {
  product: ProductWithInventory;
  viewMode?: "grid" | "list";
  productImageUrl?: string | null;
}

export function ProductCard({ product, viewMode = "grid", productImageUrl }: ProductCardProps) {
  const [quantity, setQuantity] = useState(1);
  const { addItem, getItemQuantity } = useCart();
  const { isAdmin } = useAuth();
  const [isAdding, setIsAdding] = useState(false);

  const currentCartQuantity = getItemQuantity(product.id);
  const maxQuantity = product.availableQuantity - currentCartQuantity;

  const handleAddToCart = () => {
    if (maxQuantity <= 0) return;
    
    setIsAdding(true);
    const success = addItem(
      {
        id: product.id,
        name: product.name,
        price: product.price,
        referenceNumber: product.referenceNumber,
        imageUrl: productImageUrl || undefined,
      },
      quantity,
      product.availableQuantity
    );

    if (success) {
      setQuantity(1);
    }

    setTimeout(() => setIsAdding(false), 1000);
  };

  const formatPrice = (price: string) => {
    return `TZS ${parseInt(price).toLocaleString()}`;
  };

  if (viewMode === "list") {
    return (
      <Card className="mb-4 hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center space-x-4">
            <img
              src={getImageWithFallback(productImageUrl)}
              alt={product.name}
              className="w-20 h-20 object-cover rounded-lg"
            />
            
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-800 mb-1">{product.name}</h3>
                  <p className="text-sm text-gray-600 mb-1">{product.packaging}</p>
                  <p className="text-xs text-gray-500">Ref: {product.referenceNumber}</p>
                </div>
                
                <div className="flex items-center space-x-2">
                  {product.isExpiringSoon && (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                      <Clock className="w-3 h-3 mr-1" />
                      Exp: {new Date(product.expirationDate!).toLocaleDateString()}
                    </Badge>
                  )}
                  {product.isLowStock && isAdmin && (
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Low Stock
                    </Badge>
                  )}
                </div>
              </div>
              
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center space-x-4">
                  <span className="text-lg font-bold text-phomas-green">{formatPrice(product.price)}</span>
                  <span className="text-sm text-gray-600">
                    Stock: <span className={`font-medium ${product.isLowStock ? 'text-red-600' : 'text-green-600'}`}>
                      {product.availableQuantity}
                    </span>
                  </span>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Input
                    type="number"
                    min="1"
                    max={maxQuantity}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Math.min(maxQuantity, parseInt(e.target.value) || 1)))}
                    className="w-16 text-center"
                    disabled={maxQuantity <= 0}
                  />
                  <Button
                    onClick={handleAddToCart}
                    disabled={maxQuantity <= 0 || isAdding}
                    className="bg-phomas-green hover:bg-phomas-green/90"
                  >
                    {isAdding ? (
                      "Adding..."
                    ) : (
                      <>
                        <ShoppingCart className="w-4 h-4 mr-2" />
                        {maxQuantity <= 0 ? "Out of Stock" : "Add to Cart"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex h-full overflow-hidden rounded-lg border-gray-200 hover:shadow-md transition-shadow">
      <div className="flex w-full flex-col">
        <div className="relative bg-gray-50">
          <img
            src={getImageWithFallback(productImageUrl)}
            alt={product.name}
            className="h-20 w-full object-contain p-2"
          />

          <div className="absolute right-2 top-2 space-y-1">
            {product.isExpiringSoon && (
              <Badge variant="outline" className="bg-amber-50 px-1.5 py-0 text-[10px] text-amber-700 border-amber-200">
                <Clock className="w-3 h-3 mr-1" />
                Exp: {new Date(product.expirationDate!).toLocaleDateString().split('/').slice(0, 2).join('/')}
              </Badge>
            )}
            {product.isLowStock && isAdmin && (
              <Badge variant="outline" className="bg-red-50 px-1.5 py-0 text-[10px] text-red-700 border-red-200 block">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Low Stock
              </Badge>
            )}
          </div>
        </div>

        <CardContent className="flex flex-1 flex-col p-2.5">
          <h3 className="mb-1 min-h-8 line-clamp-2 text-[13px] font-semibold leading-4 text-gray-900" title={product.name}>
            {product.name}
          </h3>
          <div className="mb-2 space-y-0.5 text-[11px] leading-4">
            <p className="line-clamp-1 text-gray-600" title={product.packaging}>
              {product.packaging}
            </p>
            <p className="truncate text-gray-500" title={`Ref: ${product.referenceNumber}`}>
              Ref: {product.referenceNumber}
            </p>
          </div>

          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-bold leading-5 text-phomas-green">{formatPrice(product.price)}</span>
            <div className="flex shrink-0 items-center text-[11px] leading-4">
              <span className="text-gray-600">Stock: </span>
              <span className={`font-medium ml-1 ${product.isLowStock ? 'text-red-600' : 'text-green-600'}`}>
                {product.availableQuantity}
              </span>
            </div>
          </div>
          <div className="mt-auto flex items-center gap-2">
            <Input
              type="number"
              min="1"
              max={maxQuantity}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(maxQuantity, parseInt(e.target.value) || 1)))}
              className="h-10 w-12 px-1 text-center text-xs min-[900px]:h-8"
              disabled={maxQuantity <= 0}
            />
            <Button
              size="sm"
              onClick={handleAddToCart}
              disabled={maxQuantity <= 0 || isAdding}
              className="h-10 min-w-0 flex-1 gap-1 bg-phomas-green px-2 text-xs font-semibold hover:bg-phomas-green/90 min-[900px]:h-8"
            >
              {isAdding ? (
                "Adding..."
              ) : (
                <>
                  <ShoppingCart className="h-3.5 w-3.5" />
                  {maxQuantity <= 0 ? "Out" : "Add"}
                </>
              )}
            </Button>
          </div>

          {currentCartQuantity > 0 && (
            <p className="mt-1 text-center text-[11px] leading-4 text-gray-500">
              {currentCartQuantity} already in cart
            </p>
          )}
        </CardContent>
      </div>
    </Card>
  );
}
