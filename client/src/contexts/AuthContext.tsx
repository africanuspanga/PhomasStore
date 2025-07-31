import React, { createContext, useContext, useState, useEffect } from "react";
import type { User, InsertUser, LoginUser } from "@shared/schema";
import { ecountService } from "@/services/ecountService";
import { useToast } from "@/hooks/use-toast";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (credentials: LoginUser) => Promise<boolean>;
  register: (userData: InsertUser) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Check for stored user session
    const storedUser = localStorage.getItem("phomas_user");
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (error) {
        localStorage.removeItem("phomas_user");
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (credentials: LoginUser): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await ecountService.login(credentials);
      
      if (response.success) {
        setUser(response.user);
        localStorage.setItem("phomas_user", JSON.stringify(response.user));
        toast({
          title: "Welcome back!",
          description: `Logged in as ${response.user.companyName}`,
        });
        return true;
      }
      return false;
    } catch (error) {
      toast({
        title: "Login failed",
        description: "Invalid email or password",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: InsertUser): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await ecountService.register(userData);
      
      if (response.success) {
        setUser(response.user);
        localStorage.setItem("phomas_user", JSON.stringify(response.user));
        toast({
          title: "Account created successfully!",
          description: `Welcome to Phomas Online Store, ${response.user.companyName}`,
        });
        return true;
      }
      return false;
    } catch (error) {
      toast({
        title: "Registration failed",
        description: "Please check your information and try again",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("phomas_user");
    toast({
      title: "Logged out",
      description: "You have been successfully logged out",
    });
  };

  const value: AuthContextType = {
    user,
    isLoading,
    login,
    register,
    logout,
    isAuthenticated: !!user,
    isAdmin: user?.role === "admin",
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
