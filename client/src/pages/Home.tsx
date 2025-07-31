import { useQuery } from "@tanstack/react-query";
import { ProductGrid } from "@/components/ProductGrid";
import { ecountService } from "@/services/ecountService";

export default function Home() {
  const { data: products = [], isLoading, error } = useQuery({
    queryKey: ["/api/products"],
    queryFn: () => ecountService.getProducts(),
  });

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-medium">Error loading products</h3>
          <p className="text-red-600 mt-1">Please try refreshing the page</p>
        </div>
      </div>
    );
  }

  return <ProductGrid products={products} isLoading={isLoading} />;
}
