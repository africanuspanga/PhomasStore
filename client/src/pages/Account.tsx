import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { sendPasswordResetEmail } from "@/lib/passwordReset";
import { CustomerOnboarding } from "@/components/CustomerOnboarding";
import { KeyRound, Mail, MapPin, Phone, UserRound } from "lucide-react";

export default function Account() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [isSendingReset, setIsSendingReset] = useState(false);

  useEffect(() => {
    const loadEmail = async () => {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email || "");
    };

    loadEmail();
  }, []);

  const handleSendReset = async () => {
    if (!email) {
      toast({
        title: "Email unavailable",
        description: "Please log out and sign in again before requesting a password reset.",
        variant: "destructive",
      });
      return;
    }

    setIsSendingReset(true);
    try {
      await sendPasswordResetEmail(email);
      toast({
        title: "Reset email sent",
        description: "Check your inbox for the password reset link.",
      });
    } catch (error) {
      toast({
        title: "Reset failed",
        description: error instanceof Error ? error.message : "Unable to send password reset email.",
        variant: "destructive",
      });
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Customer Account</h1>
            <p className="text-sm text-gray-600">Manage account access and shopping guidance.</p>
          </div>
          <CustomerOnboarding />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="h-5 w-5 text-phomas-green" />
                Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <UserRound className="mt-0.5 h-4 w-4 text-gray-500" />
                <div>
                  <p className="text-gray-500">Name</p>
                  <p className="font-medium text-gray-900">{user?.name || "N/A"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 text-gray-500" />
                <div>
                  <p className="text-gray-500">Email</p>
                  <p className="font-medium text-gray-900">{email || "N/A"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="mt-0.5 h-4 w-4 text-gray-500" />
                <div>
                  <p className="text-gray-500">Phone</p>
                  <p className="font-medium text-gray-900">{user?.phone || "N/A"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 text-gray-500" />
                <div>
                  <p className="text-gray-500">Registered address</p>
                  <p className="font-medium text-gray-900">{user?.address || "N/A"}</p>
                </div>
              </div>
              <Badge variant="outline" className="capitalize">
                {user?.userType || "customer"}
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-phomas-green" />
                Password Reset
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                A secure password reset link will be sent to your account email.
              </p>
              <Button
                type="button"
                onClick={handleSendReset}
                disabled={isSendingReset}
                className="bg-phomas-green hover:bg-phomas-green/90"
                data-testid="button-send-account-password-reset"
              >
                <Mail className="h-4 w-4 mr-2" />
                {isSendingReset ? "Sending..." : "Send Reset Email"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
