import "server-only";

export const env = {
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  accessToken: process.env.FITCOACH_ACCESS_TOKEN,
};

export function hasSupabaseConfig() {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}
