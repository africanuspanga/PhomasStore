import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Home, 
  ShoppingCart, 
  History, 
  FileText, 
  Truck, 
  List, 
  AlertTriangle, 
  Settings,
  LogOut,
  X
} from "lucide-react";
import { Link, useLocation } from "wouter";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { itemCount } = useCart();
  const { isAdmin, user, adminUser, logout } = useAuth();
  const [location] = useLocation();
  
  const handleLogout = () => {
    logout();
    onClose(); // Close sidebar after logout
  };

  const navItems = [
    { href: "/", icon: Home, label: "Home Page", active: location === "/" },
    { 
      href: "/cart", 
      icon: ShoppingCart, 
      label: "Shopping Cart", 
      badge: itemCount > 0 ? itemCount : undefined,
      active: location === "/cart"
    },
    { href: "/orders", icon: History, label: "Orders History", active: location === "/orders" },
    { href: "#", icon: FileText, label: "Invoices", disabled: true },
    { href: "#", icon: Truck, label: "Delivery Notes", disabled: true },
    { href: "#", icon: List, label: "Packing List", disabled: true },
    { href: "#", icon: AlertTriangle, label: "Complaints", disabled: true },
  ];

  const adminItems = [
    { href: "/admin", icon: Settings, label: "Admin Panel", active: location === "/admin" },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={onClose}
        />
      )}
      
      {/* Sidebar */}
      <nav className={cn(
        "fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 bg-white shadow-sm border-r border-gray-200 z-50 transform transition-transform duration-200 ease-in-out",
        open ? "translate-x-0" : "-translate-x-full",
        "md:translate-x-0"
      )}>
        <div className="p-6">
          {/* Mobile close button */}
          <div className="flex justify-end mb-4 md:hidden">
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {navItems.map((item, index) => (
              <Link key={`${item.href}-${index}`} href={item.href}>
                <div
                  className={cn(
                    "flex items-center px-4 py-3 rounded-lg transition-colors",
                    item.active ? "bg-gray-100 text-phomas-green" : "text-gray-700 hover:bg-gray-100",
                    item.disabled && "text-gray-400 cursor-not-allowed"
                  )}
                  onClick={() => !item.disabled && onClose()}
                >
                  <item.icon className="w-5 h-5 mr-3" />
                  <span className="font-medium">{item.label}</span>
                  {item.badge && (
                    <Badge variant="destructive" className="ml-auto">
                      {item.badge}
                    </Badge>
                  )}
                  {item.disabled && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                      Soon
                    </Badge>
                  )}
                </div>
              </Link>
            ))}

            {isAdmin && (
              <div className="border-t border-gray-200 mt-6 pt-6">
                {adminItems.map((item, index) => (
                  <Link key={`admin-${item.href}-${index}`} href={item.href}>
                    <div
                      className={cn(
                        "flex items-center px-4 py-3 rounded-lg transition-colors",
                        item.active ? "bg-gray-100 text-phomas-green" : "text-gray-700 hover:bg-gray-100"
                      )}
                      onClick={onClose}
                    >
                      <item.icon className="w-5 h-5 mr-3" />
                      <span className="font-medium">{item.label}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* User Info and Logout Section */}
            <div className="border-t border-gray-200 mt-6 pt-6">
              {/* User Welcome Message */}
              <div className="px-4 py-2 mb-3">
                <p className="text-sm text-gray-600 font-medium">
                  Welcome, {adminUser?.email || user?.name || 'User'}
                </p>
              </div>

              {/* Logout Button */}
              <div className="px-4">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleLogout}
                  className="w-full justify-start text-gray-700 hover:bg-gray-100"
                  data-testid="button-logout-mobile"
                >
                  <LogOut className="w-5 h-5 mr-3" />
                  <span className="font-medium">Logout</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
