import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

export interface ProductImageData {
  [productCode: string]: string; // productCode -> imageUrl
}

/**
 * Custom hook to fetch product images in batches
 * This replaces the old system where images were embedded in product data
 */
export function useProductImages(productCodes: string[]) {
  return useQuery({
    queryKey: ['product-images', productCodes.sort().join(',')],
    queryFn: async (): Promise<ProductImageData> => {
      if (productCodes.length === 0) {
        return {};
      }
      
      const codesParam = productCodes.join(',');
      const response = await fetch(`/api/images?codes=${codesParam}`);
      
      if (!response.ok) {
        console.warn('Failed to fetch product images:', response.status);
        return {};
      }
      
      const data = await response.json();
      return data.images || {};
    },
    enabled: productCodes.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes (matches server cache)
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to get a single product image
 */
export function useProductImage(productCode: string) {
  return useQuery({
    queryKey: ['product-image', productCode],
    queryFn: async (): Promise<string | null> => {
      const response = await fetch(`/api/images/${productCode}`);
      
      if (response.status === 404) {
        return null; // No image found
      }
      
      if (!response.ok) {
        console.warn(`Failed to fetch image for ${productCode}:`, response.status);
        return null;
      }
      
      const data = await response.json();
      return data.imageUrl;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes (matches server cache)
    refetchOnWindowFocus: false,
  });
}

/**
 * Mutation to upload image for a specific product
 */
export function useUploadProductImage() {
  return useMutation({
    mutationFn: async ({ productCode, file }: { productCode: string; file: File }) => {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('productCode', productCode);

      const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('phomas_admin_token')}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      // Invalidate image queries for this product
      queryClient.invalidateQueries({ queryKey: ['product-image', data.productCode] });
      queryClient.invalidateQueries({ queryKey: ['product-images'] });
    },
  });
}

/**
 * Mutation to set external image URL for a product
 */
export function useSetProductImageUrl() {
  return useMutation({
    mutationFn: async ({ productCode, imageUrl }: { productCode: string; imageUrl: string }) => {
      const response = await fetch('/api/images/set-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('phomas_admin_token')}`,
        },
        body: JSON.stringify({ productCode, imageUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to set image URL');
      }

      return response.json();
    },
    onSuccess: (data) => {
      // Invalidate image queries for this product
      queryClient.invalidateQueries({ queryKey: ['product-image', data.productCode] });
      queryClient.invalidateQueries({ queryKey: ['product-images'] });
    },
  });
}

/**
 * Mutation to delete a product image
 */
export function useDeleteProductImage() {
  return useMutation({
    mutationFn: async (productCode: string) => {
      const response = await fetch(`/api/images/${productCode}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('phomas_admin_token')}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete image');
      }

      return response.json();
    },
    onSuccess: (data) => {
      // Invalidate image queries for this product
      queryClient.invalidateQueries({ queryKey: ['product-image', data.productCode] });
      queryClient.invalidateQueries({ queryKey: ['product-images'] });
    },
  });
}

/**
 * Helper function to get image URL with fallback
 */
export function getImageWithFallback(imageUrl: string | null | undefined): string {
  return imageUrl || "https://images.unsplash.com/photo-1584362917165-526a968579e8?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&h=300";
}