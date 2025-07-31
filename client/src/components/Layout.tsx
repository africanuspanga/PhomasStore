import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, LogOut, Menu } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Sidebar } from "./Sidebar";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const { itemCount } = useCart();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top Navigation */}
      <header className="bg-white shadow-sm border-b border-gray-200 relative z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              {/* Company Logo */}
              <div className="flex items-center">
                <div className="w-10 h-10 bg-phomas-green rounded-lg flex items-center justify-center mr-3">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                  </svg>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-phomas-green">PHOMAS</h1>
                  <p className="text-xs text-gray-600">Online Store</p>
                </div>
              </div>
            </div>

            <div className="hidden md:flex items-center space-x-6">
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-600">Welcome, {user?.companyName}</span>
                <div className="flex items-center space-x-2">
                  <Link href="/cart">
                    <Button variant="ghost" size="sm" className="relative">
                      <ShoppingCart className="h-5 w-5" />
                      {itemCount > 0 && (
                        <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs">
                          {itemCount}
                        </Badge>
                      )}
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={handleLogout}>
                    <LogOut className="h-4 w-4 mr-1" />
                    Logout
                  </Button>
                </div>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main Content */}
        <main className="flex-1 md:ml-64 mt-0">
          {children}
        </main>
      </div>
    </div>
  );
}
