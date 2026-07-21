import type { Env } from '../env';

export async function pingSupabaseDatabase(env: Env): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the scheduled keep-alive.');
  }

  const table = env.SUPABASE_HEARTBEAT_TABLE || 'atlas_heartbeats';
  const endpoint = new URL(`/rest/v1/${encodeURIComponent(table)}`, env.SUPABASE_URL);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({ source: 'cloudflare_cron', observed_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    throw new Error(`Supabase keep-alive failed with ${response.status}.`);
  }
}
