import { createClient } from '@supabase/supabase-js'

// Use environment variables for configuration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

// Create Supabase client with placeholder values if not configured
// This app uses localStorage-based authentication, Supabase is optional
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Note: Profile types are now defined in shared/schema.ts to avoid duplication