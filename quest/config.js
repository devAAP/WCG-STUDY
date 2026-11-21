// Testament Quest server configuration.
// Leave blank for offline/solo mode. To enable Congregation mode, the
// Fellowship leaderboard and automated encouragement, create a Supabase
// project, apply db/schema.sql + db/seed.sql, and paste the project URL and
// *anon* (public) key here. Never put the service-role key in this file.
globalThis.QUEST_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
