import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocation } from "wouter";
import { z } from "zod";
import { Eye, EyeOff, KeyRound, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import logoImage from "@assets/Screenshot 2025-07-31 at 21.36.28_1753988684264.png";

const adminRecoverySchema = z.object({
  recoveryToken: z.string().min(1, "Recovery token is required"),
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  confirmPassword: z.string().min(1, "Please confirm the new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type AdminRecoveryFormData = z.infer<typeof adminRecoverySchema>;

export default function AdminRecovery() {
  const [isLoading, setIsLoading] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<AdminRecoveryFormData>({
    resolver: zodResolver(adminRecoverySchema),
    defaultValues: {
      recoveryToken: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: AdminRecoveryFormData) => {
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/admin/recover-access", {
        email: "admin@phomas.com",
        recoveryToken: data.recoveryToken,
        newPassword: data.newPassword,
      });
      const result = await response.json();

      toast({
        title: "Access Restored",
        description: result.message || "Admin password reset successfully. Please sign in.",
      });

      setLocation("/admin-login");
    } catch (error) {
      toast({
        title: "Recovery Failed",
        description: error instanceof Error ? error.message.replace(/^\d+:\s*/, "") : "Failed to recover admin access",
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
          <div className="flex items-center justify-center mb-4">
            <img
              src={logoImage}
              alt="Phomas Diagnostics Logo"
              className="h-16 w-auto"
            />
          </div>

          <CardTitle className="text-2xl font-bold text-phomas-green">
            Admin Recovery
          </CardTitle>
          <p className="text-gray-600 text-sm mt-2">
            Use the recovery token to set a fresh admin password.
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                This is for emergency admin access recovery only. After this works, sign in normally and use the admin portal to manage the password going forward.
              </p>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="recoveryToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recovery Token</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <Input
                          type="password"
                          placeholder="Enter the admin recovery token"
                          className="pl-9"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Admin Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showNewPassword ? "text" : "password"}
                          placeholder="Choose a new admin password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                        >
                          {showNewPassword ? (
                            <EyeOff className="h-4 w-4 text-gray-400" />
                          ) : (
                            <Eye className="h-4 w-4 text-gray-400" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm New Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Re-enter the new password"
                          {...field}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4 text-gray-400" />
                          ) : (
                            <Eye className="h-4 w-4 text-gray-400" />
                          )}
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full bg-phomas-green hover:bg-phomas-green/90"
                disabled={isLoading}
              >
                {isLoading ? "Resetting..." : "Reset Admin Password"}
              </Button>
            </form>
          </Form>

          <div className="text-center">
            <Button
              type="button"
              variant="link"
              className="text-phomas-blue p-0"
              onClick={() => setLocation("/admin-login")}
            >
              Back to admin login
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
