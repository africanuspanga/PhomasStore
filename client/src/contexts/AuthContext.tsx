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
      // Get current user data for fallback
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Try to load profile from Supabase profiles table (if it exists)
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (!error && profile) {
          setUser(profile);
          return;
        }
      } catch (profileError) {
        // Profiles table doesn't exist or other error - use fallback
        console.log('Using fallback authentication (profiles table not available)');
      }

      // Fallback: create user object from auth metadata
      setUser({
        id: user.id,
        userId: user.id,
        name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
        phone: user.user_metadata?.phone || '',
        address: user.user_metadata?.address || '',
        userType: user.user_metadata?.user_type || 'company',
        createdAt: new Date(user.created_at)
      });
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
        // Check if user is approved (unless they're admin)
        const metadata = data.user.user_metadata || {};
        const isApproved = metadata.approved === true;
        const isAdmin = credentials.email === 'admin@phomas.com';

        if (!isApproved && !isAdmin) {
          // Sign out the user immediately
          await supabase.auth.signOut();
          
          // Show pending approval message with WhatsApp option
          const whatsappNumber = "255678389075";
          const whatsappMessage = encodeURIComponent(`Hello Phomas Diagnostics, I would like to request approval for my account: ${credentials.email}`);
          const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${whatsappMessage}`;
          
          toast({
            title: "Account Pending Approval",
            description: (
              <div className="space-y-2">
                <p>Your account is waiting for admin approval.</p>
                <button 
                  onClick={() => window.open(whatsappUrl, '_blank')}
                  className="text-green-600 hover:underline font-medium"
                >
                  Contact us on WhatsApp (+255 678 389075)
                </button>
              </div>
            ) as any,
            variant: "destructive",
            duration: 8000,
          });
          return false;
        }

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
      
      // Sign up with Supabase Auth including metadata
      const { data, error } = await supabase.auth.signUp({
        email: userData.email,
        password: userData.password,
        options: {
          data: {
            name: userData.name,
            phone: userData.phone,
            address: userData.address,
            user_type: userData.user_type
          }
        }
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
        // Try to create user profile, but don't fail if table doesn't exist
        try {
          await supabase
            .from('profiles')
            .insert({
              user_id: data.user.id,
              name: userData.name,
              phone: userData.phone,
              address: userData.address,
              user_type: userData.user_type,
            });
        } catch (profileError) {
          console.log('Profile creation skipped - table not available:', profileError);
        }

        // Load the user (fallback to metadata if profile table not available)
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
