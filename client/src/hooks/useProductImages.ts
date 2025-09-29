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
 * Hook to get a single product image with smart caching
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
    staleTime: 15 * 60 * 1000, // 15 minutes (longer cache for failed requests)
    refetchOnWindowFocus: false,
    retry: false, // Don't retry 404s
    refetchOnMount: false, // Don't refetch if already cached
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
 * Uses a lightweight SVG placeholder to avoid external requests
 */
export function getImageWithFallback(imageUrl: string | null | undefined): string {
  if (imageUrl) return imageUrl;
  
  // Valid SVG placeholder with simple medical icon
  const svg = `<svg width="400" height="300" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="300" fill="#F3F4F6"/>
    <g transform="translate(200, 150)">
      <circle r="40" fill="#D1D5DB"/>
      <rect x="-5" y="-25" width="10" height="50" fill="white" rx="2"/>
      <rect x="-25" y="-5" width="50" height="10" fill="white" rx="2"/>
    </g>
    <text x="200" y="240" text-anchor="middle" fill="#6B7280" font-family="Arial, sans-serif" font-size="14">Medical Product</text>
  </svg>`;
  
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}