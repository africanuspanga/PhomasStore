import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import logoImage from "@assets/Screenshot 2025-07-31 at 21.36.28_1753988684264.png";
import { useToast } from "@/hooks/use-toast";

export default function AuthConfirm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'recovery'>('loading');
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  
  useEffect(() => {
    const handleAuthConfirmation = async () => {
      try {
        // Extract the access token from URL hash
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const queryParams = new URLSearchParams(window.location.search);
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const code = queryParams.get('code');
        const authType = hashParams.get('type') || queryParams.get('type');
        
        if (accessToken && refreshToken) {
          console.log('🔐 Setting Supabase session from confirmation URL');
          
          // Set the session manually using tokens from URL
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          
          if (error) {
            console.error('🔐 Failed to set session:', error);
            setStatus('error');
          } else {
            console.log('🔐 Session set successfully:', data);
            if (authType === "recovery") {
              setStatus('recovery');
              return;
            }
            setStatus('success');
            // Redirect to home after successful confirmation
            setTimeout(() => setLocation('/'), 2000);
          }
        } else if (code) {
          console.log('🔐 Exchanging Supabase confirmation code');

          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error || !data.session) {
            console.error('🔐 Failed to exchange confirmation code:', error);
            setStatus('error');
            return;
          }

          if (authType === "recovery") {
            setStatus('recovery');
            return;
          }

          setStatus('success');
          setTimeout(() => setLocation('/'), 2000);
        } else {
          console.error('🔐 No tokens found in URL');
          setStatus('error');
        }
      } catch (error) {
        console.error('🔐 Confirmation error:', error);
        setStatus('error');
      }
    };
    
    handleAuthConfirmation();
  }, [setLocation]);

  const handleUpdatePassword = async (event: FormEvent) => {
    event.preventDefault();

    if (password.length < 8) {
      toast({
        title: "Password too short",
        description: "Password must be at least 8 characters.",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Please confirm the same password.",
        variant: "destructive",
      });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        throw new Error(error.message);
      }

      await supabase.auth.signOut();
      toast({
        title: "Password updated",
        description: "Sign in with your new password.",
      });
      setLocation("/login");
    } catch (error) {
      toast({
        title: "Password update failed",
        description: error instanceof Error ? error.message : "Please request a new reset link.",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingPassword(false);
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
          <CardTitle className="text-xl">
            {status === 'loading' && 'Confirming Your Account...'}
            {status === 'success' && 'Account Confirmed'}
            {status === 'recovery' && 'Reset Password'}
            {status === 'error' && 'Confirmation Failed'}
          </CardTitle>
        </CardHeader>

        <CardContent className="text-center">
          {status === 'loading' && (
            <div>
              <div className="w-12 h-12 bg-phomas-green rounded-lg flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <p className="text-gray-600">Setting up your account...</p>
            </div>
          )}

          {status === 'success' && (
            <div>
              <p className="text-green-600 mb-4">Your email has been confirmed successfully!</p>
              <p className="text-gray-600 mb-4">Redirecting you to the application...</p>
            </div>
          )}

          {status === 'recovery' && (
            <form onSubmit={handleUpdatePassword} className="space-y-4 text-left">
              <div>
                <label htmlFor="new-password" className="text-sm font-medium text-gray-700">
                  New password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1"
                  data-testid="input-new-recovery-password"
                />
              </div>
              <div>
                <label htmlFor="confirm-new-password" className="text-sm font-medium text-gray-700">
                  Confirm new password
                </label>
                <Input
                  id="confirm-new-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="mt-1"
                  data-testid="input-confirm-recovery-password"
                />
              </div>
              <Button
                type="submit"
                disabled={isUpdatingPassword}
                className="w-full bg-phomas-green hover:bg-phomas-green/90"
                data-testid="button-update-recovery-password"
              >
                {isUpdatingPassword ? "Updating..." : "Update Password"}
              </Button>
            </form>
          )}

          {status === 'error' && (
            <div>
              <p className="text-red-600 mb-4">There was an issue confirming your account.</p>
              <Button
                onClick={() => setLocation('/login')}
                className="bg-phomas-green hover:bg-phomas-green/90"
              >
                Go to Login
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
