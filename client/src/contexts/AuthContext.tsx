import React, { createContext, useContext, useState, useEffect } from "react";
import type { SupabaseSignUp, SupabaseLogin, Profile } from "@shared/schema";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: Profile | null;
  adminUser: AdminUser | null;
  isLoading: boolean;
  login: (credentials: SupabaseLogin) => Promise<boolean>;
  register: (userData: SupabaseSignUp) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    let mounted = true;
    
    const initializeAuth = async () => {
      try {
        // Check for admin token first
        const adminToken = localStorage.getItem("phomas_admin_token");
        if (adminToken && mounted) {
          setAdminUser({
            id: "admin-phomas",
            email: "admin@phomas.com", 
            name: "PHOMAS DIAGNOSTICS",
            role: "admin"
          });
          setIsLoading(false);
          return;
        }

        // Check for Supabase session
        const { data: { session } } = await supabase.auth.getSession();
        if (session && mounted) {
          await loadUserProfile(session.user.id);
        }
        if (mounted) {
          setIsLoading(false);
        }

        // Listen for Supabase auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (!mounted) return;
          
          if (session) {
            await loadUserProfile(session.user.id);
            setAdminUser(null);
          } else {
            setUser(null);
          }
          setIsLoading(false);
        });

        return () => {
          mounted = false;
          subscription.unsubscribe();
        };
      } catch (error) {
        console.error('Auth initialization error:', error);
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initializeAuth();
    
    return () => {
      mounted = false;
    };
  }, []);

  const loadUserProfile = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Error loading profile:', error);
        return;
      }

      setUser(profile);
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const login = async (credentials: SupabaseLogin): Promise<boolean> => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });

      if (error) {
        toast({
          title: "Login failed",
          description: error.message,
          variant: "destructive",
        });
        return false;
      }

      if (data.user) {
        await loadUserProfile(data.user.id);
        toast({
          title: "Welcome back!",
          description: "Successfully logged in",
        });
        return true;
      }
      
      return false;
    } catch (error) {
      toast({
        title: "Login failed",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: SupabaseSignUp): Promise<boolean> => {
    try {
      setIsLoading(true);
      
      // Sign up with Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: userData.email,
        password: userData.password,
      });

      if (error) {
        toast({
          title: "Registration failed",
          description: error.message,
          variant: "destructive",
        });
        return false;
      }

      if (data.user) {
        // Create user profile
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            user_id: data.user.id,
            name: userData.name,
            phone: userData.phone,
            address: userData.address,
            user_type: userData.user_type,
          });

        if (profileError) {
          toast({
            title: "Registration failed",
            description: "Failed to create user profile",
            variant: "destructive",
          });
          return false;
        }

        // Load the created profile
        await loadUserProfile(data.user.id);
        
        toast({
          title: "Account created successfully!",
          description: `Welcome to Phomas Online Store, ${userData.name}`,
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

  const logout = async () => {
    try {
      // Check if admin user is logged in
      if (adminUser) {
        localStorage.removeItem("phomas_admin_token");
        setAdminUser(null);
      } else {
        // Regular Supabase user logout
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.warn("Failed to logout from Supabase:", error);
        }
        setUser(null);
      }
      
      toast({
        title: "Logged out",
        description: "You have been successfully logged out",
      });
    } catch (error) {
      console.warn("Failed to logout:", error);
    }
  };

  const value: AuthContextType = {
    user,
    adminUser,
    isLoading,
    login,
    register,
    logout,
    isAuthenticated: !!user || !!adminUser,
    isAdmin: !!adminUser || user?.userType === "admin", // Admin token or admin user type
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
