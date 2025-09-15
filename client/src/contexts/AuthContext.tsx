import React, { createContext, useContext, useState, useEffect } from "react";
import type { SupabaseSignUp, SupabaseLogin, Profile } from "@shared/schema";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import type { User as SupabaseUser } from "@supabase/supabase-js";

interface AuthContextType {
  user: Profile | null;
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
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        await loadUserProfile(session.user.id);
      }
      setIsLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        await loadUserProfile(session.user.id);
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
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
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn("Failed to logout from Supabase:", error);
      }
    } catch (error) {
      console.warn("Failed to logout:", error);
    } finally {
      // Clear user state
      setUser(null);
      toast({
        title: "Logged out",
        description: "You have been successfully logged out",
      });
    }
  };

  const value: AuthContextType = {
    user,
    isLoading,
    login,
    register,
    logout,
    isAuthenticated: !!user,
    isAdmin: user?.name === "PHOMAS DIAGNOSTICS", // Admin is the main company
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
