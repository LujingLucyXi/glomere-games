// config.example.js — copy to config.js and fill in to go live.
// NEVER commit a real key: config.js is git-ignored by design (see README).
// Without config.js the site runs in local mock mode (single device, no
// Supabase) so the UI is testable with zero setup.
window.GAMES_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_KEY',
};
