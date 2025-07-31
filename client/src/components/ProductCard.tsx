import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCart } from "@/contexts/CartContext";
import { ShoppingCart, Clock, AlertTriangle } from "lucide-react";
import type { ProductWithInventory } from "@shared/schema";

interface ProductCardProps {
  product: ProductWithInventory;
  viewMode?: "grid" | "list";
}

export function ProductCard({ product, viewMode = "grid" }: ProductCardProps) {
  const [quantity, setQuantity] = useState(1);
  const { addItem, getItemQuantity } = useCart();
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
        imageUrl: product.imageUrl || undefined,
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
    return `TZS ${parseFloat(price).toLocaleString()}`;
  };

  if (viewMode === "list") {
    return (
      <Card className="mb-4 hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center space-x-4">
            <img
              src={product.imageUrl || "https://images.unsplash.com/photo-1584362917165-526a968579e8?ixlib=rb-4.0.3&auto=format&fit=crop&w=150&h=150"}
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
                  {product.isLowStock && (
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
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="relative">
        <img
          src={product.imageUrl || "https://images.unsplash.com/photo-1584362917165-526a968579e8?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300"}
          alt={product.name}
          className="w-full h-48 object-cover"
        />
        
        <div className="absolute top-3 right-3 space-y-2">
          {product.isExpiringSoon && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              <Clock className="w-3 h-3 mr-1" />
              Exp: {new Date(product.expirationDate!).toLocaleDateString().split('/').slice(0, 2).join('/')}
            </Badge>
          )}
          {product.isLowStock && (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 block">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Low Stock
            </Badge>
          )}
        </div>
      </div>
      
      <CardContent className="p-4">
        <h3 className="font-semibold text-gray-800 mb-2">{product.name}</h3>
        <p className="text-sm text-gray-600 mb-2">{product.packaging}</p>
        <p className="text-xs text-gray-500 mb-3">Ref: {product.referenceNumber}</p>
        
        <div className="flex items-center justify-between mb-3">
          <span className="text-lg font-bold text-phomas-green">{formatPrice(product.price)}</span>
          <div className="flex items-center text-sm">
            <span className="text-gray-600">Stock: </span>
            <span className={`font-medium ml-1 ${product.isLowStock ? 'text-red-600' : 'text-green-600'}`}>
              {product.availableQuantity}
            </span>
          </div>
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
            className="flex-1 bg-phomas-green hover:bg-phomas-green/90"
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
        
        {currentCartQuantity > 0 && (
          <p className="text-xs text-gray-500 mt-2 text-center">
            {currentCartQuantity} already in cart
          </p>
        )}
      </CardContent>
    </Card>
  );
}
