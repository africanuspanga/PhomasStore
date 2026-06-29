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
  X,
  UserRound,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react";
import { Link, useLocation } from "wouter";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ open, onClose, collapsed, onToggleCollapse }: SidebarProps) {
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
    { href: "/account", icon: UserRound, label: "Account", active: location === "/account" },
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
        "fixed left-0 top-16 z-50 h-[calc(100vh-4rem)] bg-white shadow-sm border-r border-gray-200 transform transition-[transform,width] duration-200 ease-in-out",
        collapsed ? "w-64 md:w-[4.5rem]" : "w-64",
        open ? "translate-x-0" : "-translate-x-full",
        "md:translate-x-0"
      )}>
        <div className={cn("h-full overflow-y-auto", collapsed ? "p-6 md:p-3" : "p-6")}>
          {/* Mobile close button */}
          <div className="flex justify-end mb-4 md:hidden">
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className={cn("mb-4 hidden md:flex", collapsed ? "justify-center" : "justify-end")}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onToggleCollapse}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="h-10 w-10 text-gray-600 hover:bg-gray-100"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </Button>
          </div>

          <div className="space-y-2">
            {navItems.map((item, index) => (
              <Link key={`${item.href}-${index}`} href={item.href}>
                <div
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    "relative flex min-h-11 items-center rounded-lg transition-colors",
                    collapsed ? "px-4 py-3 md:justify-center md:px-0" : "px-4 py-3",
                    item.active ? "bg-gray-100 text-phomas-green" : "text-gray-700 hover:bg-gray-100",
                    item.disabled && "text-gray-400 cursor-not-allowed"
                  )}
                  onClick={() => !item.disabled && onClose()}
                >
                  <item.icon className={cn("w-5 h-5 shrink-0", collapsed ? "mr-3 md:mr-0" : "mr-3")} />
                  <span className={cn("font-medium", collapsed && "md:hidden")}>{item.label}</span>
                  {item.badge && (
                    <Badge variant="destructive" className={cn("ml-auto", collapsed && "md:hidden")}>
                      {item.badge}
                    </Badge>
                  )}
                  {item.badge && collapsed && (
                    <Badge variant="destructive" className="absolute right-1 top-1 hidden h-5 min-w-5 px-1 text-[10px] md:flex">
                      {item.badge}
                    </Badge>
                  )}
                  {item.disabled && (
                    <Badge variant="secondary" className={cn("ml-auto text-xs", collapsed && "md:hidden")}>
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
                        "flex min-h-11 items-center rounded-lg transition-colors",
                        collapsed ? "px-4 py-3 md:justify-center md:px-0" : "px-4 py-3",
                        item.active ? "bg-gray-100 text-phomas-green" : "text-gray-700 hover:bg-gray-100"
                      )}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      onClick={onClose}
                    >
                      <item.icon className={cn("w-5 h-5 shrink-0", collapsed ? "mr-3 md:mr-0" : "mr-3")} />
                      <span className={cn("font-medium", collapsed && "md:hidden")}>{item.label}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* User Info and Logout Section */}
            <div className="border-t border-gray-200 mt-6 pt-6">
              {/* User Welcome Message */}
              <div className={cn("py-2 mb-3", collapsed ? "px-4 md:px-0 md:text-center" : "px-4")}>
                <p className="text-sm text-gray-600 font-medium">
                  <span className={cn(collapsed && "md:hidden")}>
                    Welcome, {adminUser?.email || user?.name || 'User'}
                  </span>
                  {collapsed && <span className="hidden md:inline">User</span>}
                </p>
              </div>

              {/* Logout Button */}
              <div className={cn(collapsed ? "px-4 md:px-0" : "px-4")}>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={handleLogout}
                  title={collapsed ? "Logout" : undefined}
                  aria-label={collapsed ? "Logout" : undefined}
                  className={cn(
                    "text-gray-700 hover:bg-gray-100",
                    collapsed ? "h-11 w-full justify-start md:justify-center md:px-0" : "w-full justify-start"
                  )}
                  data-testid="button-logout-mobile"
                >
                  <LogOut className={cn("w-5 h-5", collapsed ? "mr-3 md:mr-0" : "mr-3")} />
                  <span className={cn("font-medium", collapsed && "md:hidden")}>Logout</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
