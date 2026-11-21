// Scheduled hourly (see netlify.toml). Sends 7 pm local-time streak nudges.
import { runSweep, supabase } from './lib/encourage-core.mjs';

export const handler = async () => {
  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 200, body: 'encourage-cron: Supabase not configured, skipping' };
  }
  const results = await runSweep({ db: supabase({ fetch, env }), fetch, env });
  console.log(`encourage-cron sent=${results.filter(r => r.status === 'sent').length} total=${results.length}`);
  return { statusCode: 200, body: JSON.stringify({ results: results.length }) };
};
