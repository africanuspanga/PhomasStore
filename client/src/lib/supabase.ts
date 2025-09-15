import { createClient } from '@supabase/supabase-js'

// Use environment variables for configuration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xvomxojbfhovbhbbkuoh.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2b214b2piZmhvdmJoYmJrdW9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjY5NTksImV4cCI6MjA3MzU0Mjk1OX0.Th3j5bG7kDgJC9J8jHezRzPVLoI0DhPnE5KB_Fb2f10'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Note: Profile types are now defined in shared/schema.ts to avoid duplication