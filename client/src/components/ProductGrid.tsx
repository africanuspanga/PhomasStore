import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Grid, List } from "lucide-react";
import { ProductCard } from "./ProductCard";
import { SearchBar } from "./SearchBar";
import type { ProductWithInventory } from "@shared/schema";
import { cn } from "@/lib/utils";
import { useProductImages } from "@/hooks/useProductImages";

interface ProductGridProps {
  products: ProductWithInventory[];
  isLoading?: boolean;
}

const catalogGridClass =
  "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3";

export function ProductGrid({ products, isLoading }: ProductGridProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const productCodes = useMemo(() => products.map((product) => product.id), [products]);
  const { data: productImages = {} } = useProductImages(productCodes);

  const filteredProducts = useMemo(() => {
    const filtered = products.filter(product => {
      const matchesSearch = 
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.referenceNumber.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = categoryFilter === "all" || product.category === categoryFilter;
      
      return matchesSearch && matchesCategory;
    });
    
    // Sort products: Real names first, generic names last
    return filtered.sort((a, b) => {
      const aIsGeneric = a.name.includes('Medical Supply') || a.name.includes('Medical Product');
      const bIsGeneric = b.name.includes('Medical Supply') || b.name.includes('Medical Product');
      
      // If one is generic and other isn't, non-generic comes first
      if (aIsGeneric && !bIsGeneric) return 1;
      if (!aIsGeneric && bIsGeneric) return -1;
      
      // If both are same type (both generic or both real), sort alphabetically
      return a.name.localeCompare(b.name);
    });
  }, [products, searchQuery, categoryFilter]);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
    return cats.sort();
  }, [products]);

  if (isLoading) {
    return (
      <div className="p-3 xl:p-4">
        <div className="mb-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="h-9 flex-1 max-w-md rounded-lg bg-gray-200 animate-pulse" />
            <div className="flex items-center gap-2">
              <div className="h-9 w-20 rounded-lg bg-gray-200 animate-pulse" />
              <div className="h-9 w-32 rounded-lg bg-gray-200 animate-pulse" />
            </div>
          </div>
        </div>
        
        <div className={catalogGridClass}>
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="h-20 w-full bg-gray-200 animate-pulse" />
              <div className="space-y-2 p-2.5">
                <div className="h-3.5 rounded bg-gray-200 animate-pulse" />
                <div className="h-3 rounded bg-gray-200 animate-pulse" />
                <div className="h-3 w-3/4 rounded bg-gray-200 animate-pulse" />
                <div className="flex items-center justify-between">
                  <div className="h-5 w-16 rounded bg-gray-200 animate-pulse" />
                  <div className="h-5 w-12 rounded bg-gray-200 animate-pulse" />
                </div>
                <div className="h-8 rounded bg-gray-200 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 xl:p-4">
      {/* Search and Controls */}
      <div className="mb-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <SearchBar onSearch={setSearchQuery} />
          
          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white p-1">
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className={cn(
                  "h-8 w-8 p-0",
                  viewMode === "grid" && "bg-gray-100 text-phomas-green"
                )}
              >
                <Grid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className={cn(
                  "h-8 w-8 p-0",
                  viewMode === "list" && "bg-gray-100 text-phomas-green"
                )}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Category Filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(category => (
                  <SelectItem key={category} value={category!}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Products Display */}
      {filteredProducts.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-500 text-lg mb-2">No products found</div>
          <p className="text-gray-400">Try adjusting your search or filter criteria</p>
        </div>
      ) : (
        <div className={cn(
          viewMode === "grid" 
            ? catalogGridClass
            : "space-y-3"
        )}>
          {filteredProducts.map(product => (
            <ProductCard
              key={product.id}
              product={product}
              viewMode={viewMode}
              productImageUrl={productImages[product.id] || null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
