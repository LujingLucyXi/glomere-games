#!/bin/bash
# Build step for Vercel: generate config.js from project env vars so the
# Supabase publishable key never lives in git (config.js is git-ignored).
# Set in the Vercel project settings (Environment Variables):
#   SUPABASE_URL       e.g. https://jlvlmuyegirglbyrnfbl.supabase.co
#   SUPABASE_ANON_KEY  the project's publishable key (sb_publishable_...)
set -e
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "build.sh: SUPABASE_URL / SUPABASE_ANON_KEY not set — writing mock-mode config" >&2
  cat > config.js <<'EOF'
// No live backend configured — mock mode (single device).
window.GAMES_CONFIG = {};
EOF
  exit 0
fi
cat > config.js <<EOF
// Generated at build time from Vercel env vars — never committed.
window.GAMES_CONFIG = {
  supabaseUrl: '$SUPABASE_URL',
  anonKey: '$SUPABASE_ANON_KEY',
};
EOF
echo "build.sh: config.js generated"
