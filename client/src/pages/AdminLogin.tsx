import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useLocation } from "wouter";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import logoImage from "@assets/Screenshot 2025-07-31 at 21.36.28_1753988684264.png";

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required")
});

type AdminLoginFormData = z.infer<typeof adminLoginSchema>;

export default function AdminLogin() {
  const [isLoading, setIsLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<AdminLoginFormData>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: AdminLoginFormData) => {
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/admin/login", data);
      const result = await response.json();
      
      if (result.success) {
        // Store admin token in localStorage
        localStorage.setItem("phomas_admin_token", result.token);
        
        toast({
          title: "Welcome back!",
          description: "Admin login successful",
        });
        
        // Force page refresh to trigger AuthContext re-initialization
        window.location.href = "/";
      }
    } catch (error) {
      console.error("Admin login failed:", error);
      toast({
        title: "Login Failed",
        description: "Invalid admin credentials. Please check your email and password.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* Company Logo */}
          <div className="flex items-center justify-center mb-4">
            <img 
              src={logoImage} 
              alt="Phomas Diagnostics Logo" 
              className="h-16 w-auto"
            />
          </div>
          
          <CardTitle className="text-2xl font-bold text-phomas-green">
            PHOMAS DIAGNOSTICS
          </CardTitle>
          <p className="text-gray-600 text-sm mt-2">
            Admin Access Portal
          </p>
        </CardHeader>
        
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="admin@phomas.com"
                        data-testid="input-admin-email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter admin password"
                        data-testid="input-admin-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full bg-phomas-green hover:bg-phomas-green/90"
                disabled={isLoading}
                data-testid="button-admin-login"
              >
                {isLoading ? "Signing In..." : "Admin Sign In"}
              </Button>
            </form>
          </Form>

          <div className="text-center mt-6">
            <p className="text-gray-600 text-sm">
              Regular user? {" "}
              <Button
                variant="link"
                className="text-phomas-blue hover:underline p-0"
                onClick={() => setLocation("/login")}
                data-testid="link-regular-login"
              >
                Customer login here
              </Button>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}