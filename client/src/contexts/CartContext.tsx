import React, { createContext, useContext, useState, useEffect } from "react";
import type { CartItem } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface CartContextType {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  tax: number;
  total: number;
  addItem: (product: { id: string; name: string; price: string; referenceNumber: string; imageUrl?: string }, quantity: number, maxQuantity: number) => boolean;
  updateQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
  getItemQuantity: (productId: string) => number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_PREFIX = "phomas_cart_";
const TAX_RATE = 0; // Medical supplies are not charged additional tax.

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loadedCartKey, setLoadedCartKey] = useState<string | null>(null);
  const { toast } = useToast();
  const { user, adminUser } = useAuth();

  const cartOwnerIds = React.useMemo(() => {
    const owners = adminUser
      ? [`admin-${adminUser.id}`]
      : user
        ? [
            user.userId,
            user.id,
            user.email ? `email-${user.email.toLowerCase()}` : null,
          ]
        : [];

    return Array.from(new Set(owners.filter((owner): owner is string => !!owner)));
  }, [adminUser?.id, user?.email, user?.id, user?.userId]);

  const cartKeys = React.useMemo(
    () => cartOwnerIds.map((ownerId) => `${CART_STORAGE_PREFIX}${ownerId}`),
    [cartOwnerIds]
  );
  const cartKey = cartKeys[0] || null;
  const cartKeysSignature = cartKeys.join("|");

  const readStoredCart = (key: string): CartItem[] | null => {
    const savedCart = localStorage.getItem(key);
    if (savedCart === null) {
      return null;
    }

    try {
      const parsedCart = JSON.parse(savedCart);
      return Array.isArray(parsedCart) ? parsedCart : [];
    } catch (error) {
      localStorage.removeItem(key);
      return null;
    }
  };

  const persistCart = (nextItems: CartItem[]) => {
    if (!cartKey) {
      return;
    }

    localStorage.setItem(cartKey, JSON.stringify(nextItems));
    cartKeys
      .filter((candidateKey) => candidateKey !== cartKey)
      .forEach((candidateKey) => localStorage.removeItem(candidateKey));
  };

  // Load cart from localStorage when user changes
  useEffect(() => {
    if (!cartKey) {
      setItems([]);
      setLoadedCartKey(null);
      return;
    }

    const primaryStoredItems = readStoredCart(cartKey);
    let loadedItems: CartItem[] = primaryStoredItems ?? [];
    let loadedFromKey: string | null = primaryStoredItems !== null ? cartKey : null;

    for (const candidateKey of cartKeys.filter((key) => key !== cartKey)) {
      const storedItems = readStoredCart(candidateKey);
      if (storedItems !== null && (loadedFromKey === null || (loadedItems.length === 0 && storedItems.length > 0))) {
        loadedItems = storedItems;
        loadedFromKey = candidateKey;
        if (storedItems.length > 0) {
          break;
        }
      }
    }

    if (loadedFromKey && loadedFromKey !== cartKey) {
      localStorage.setItem(cartKey, JSON.stringify(loadedItems));
      localStorage.removeItem(loadedFromKey);
    }

    setItems(loadedItems);
    setLoadedCartKey(cartKey);
  }, [cartKey, cartKeysSignature]);

  // Save cart only after the current user's cart has been loaded.
  useEffect(() => {
    if (!cartKey || loadedCartKey !== cartKey) {
      return;
    }

    localStorage.setItem(cartKey, JSON.stringify(items));
  }, [items, cartKey, loadedCartKey]);

  const itemCount = items.reduce((total, item) => total + item.quantity, 0);

  const subtotal = items.reduce((total, item) => total + parseInt(item.price) * item.quantity, 0);

  const tax = subtotal * TAX_RATE;

  const total = subtotal + tax;

  const addItem = (
    product: { id: string; name: string; price: string; referenceNumber: string; imageUrl?: string },
    quantity: number,
    maxQuantity: number
  ): boolean => {
    const existingItem = items.find(item => item.productId === product.id);
    const currentQuantity = existingItem ? existingItem.quantity : 0;
    const newQuantity = currentQuantity + quantity;

    if (newQuantity > maxQuantity) {
      toast({
        title: "Insufficient stock",
        description: `Only ${maxQuantity} units available. You currently have ${currentQuantity} in your cart.`,
        variant: "destructive",
      });
      return false;
    }

    if (existingItem) {
      const nextItems = items.map(item =>
        item.productId === product.id
          ? { ...item, quantity: newQuantity }
          : item
      );
      setItems(nextItems);
      persistCart(nextItems);
    } else {
      const newItem: CartItem = {
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity,
        referenceNumber: product.referenceNumber,
        imageUrl: product.imageUrl,
      };
      const nextItems = [...items, newItem];
      setItems(nextItems);
      persistCart(nextItems);
    }

    toast({
      title: "Added to cart",
      description: `${quantity}x ${product.name} added to your cart`,
    });

    return true;
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }

    const nextItems = items.map(item =>
      item.productId === productId
        ? { ...item, quantity }
        : item
    );
    setItems(nextItems);
    persistCart(nextItems);
  };

  const removeItem = (productId: string) => {
    const item = items.find(item => item.productId === productId);
    const nextItems = items.filter(item => item.productId !== productId);
    setItems(nextItems);
    persistCart(nextItems);
    
    if (item) {
      toast({
        title: "Removed from cart",
        description: `${item.name} removed from your cart`,
      });
    }
  };

  const clearCart = () => {
    setItems([]);
    persistCart([]);
    toast({
      title: "Cart cleared",
      description: "All items have been removed from your cart",
    });
  };

  const getItemQuantity = (productId: string): number => {
    const item = items.find(item => item.productId === productId);
    return item ? item.quantity : 0;
  };

  const value: CartContextType = {
    items,
    itemCount,
    subtotal,
    tax,
    total,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    getItemQuantity,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
