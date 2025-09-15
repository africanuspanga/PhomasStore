import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import logoImage from "@assets/Screenshot 2025-07-31 at 21.36.28_1753988684264.png";

export default function AuthConfirm() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  
  useEffect(() => {
    const handleAuthConfirmation = async () => {
      try {
        // Extract the access token from URL hash
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        
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
            setStatus('success');
            // Redirect to home after successful confirmation
            setTimeout(() => setLocation('/'), 2000);
          }
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
            {status === 'success' && '✅ Account Confirmed!'}
            {status === 'error' && '❌ Confirmation Failed'}
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