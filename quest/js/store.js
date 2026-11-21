// Local-first persistence + optional server sync.
// The app is fully playable offline from localStorage. When a Supabase project
// is configured (quest/config.js) and the reader signs in, the server becomes
// the source of truth for streaks (log_reading RPC) and unlocks Congregation
// pooling, the Fellowship leaderboard and automated encouragement.
import { emptyStreak, emptyProgress, dayKey } from './engine.js';

const KEY = 'testament-quest:v1';

export function defaultState() {
  return {
    profile: { name: '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', encourageOptIn: false },
    streak: emptyStreak(),
    progress: emptyProgress(),
    artifacts: [],          // book numbers whose artifact is earned
    recentDays: [],         // last 30 reading days, newest first
    log: [],                // { day, book, chapter, correct, total }
    friends: [],            // local contacts for share-based encouragement { id, name }
    auth: null,             // { accessToken, refreshToken, userId, expiresAt }
    congregationId: null,
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...s, profile: { ...d.profile, ...s.profile }, streak: { ...d.streak, ...s.streak },
             progress: { ...d.progress, ...s.progress } };
  } catch { return defaultState(); }
}

export function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); }
export function reset() { localStorage.removeItem(KEY); }
export const today = state => dayKey(new Date(), state.profile.timeZone);

// ── Remote (Supabase REST, no SDK so the PWA stays dependency-free) ─────────
const cfg = () => globalThis.QUEST_CONFIG || {};
export const remoteConfigured = () => Boolean(cfg().supabaseUrl && cfg().supabaseAnonKey);

async function rest(state, path, init = {}) {
  const { supabaseUrl, supabaseAnonKey } = cfg();
  const r = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${state.auth?.accessToken || supabaseAnonKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const text = await r.text();
  const body = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(body?.message || body?.msg || body?.error_description || `HTTP ${r.status}`);
  return body;
}

export const remote = {
  sendMagicLink: (state, email) => rest(state, '/auth/v1/otp', {
    method: 'POST',
    body: JSON.stringify({ email, create_user: true, options: { email_redirect_to: location.href.split('#')[0] } }),
  }),
  // Supabase returns tokens in the URL fragment after the magic link.
  consumeRedirect() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get('access_token')) return null;
    history.replaceState(null, '', location.pathname + location.search);
    const token = h.get('access_token');
    const userId = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;
    return { accessToken: token, refreshToken: h.get('refresh_token'), userId,
             expiresAt: Date.now() + Number(h.get('expires_in') || 3600) * 1000 };
  },
  async refresh(state) {
    if (!state.auth?.refreshToken || Date.now() < state.auth.expiresAt - 60000) return state.auth;
    const r = await rest(state, '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: JSON.stringify({ refresh_token: state.auth.refreshToken }),
    });
    return { ...state.auth, accessToken: r.access_token, refreshToken: r.refresh_token,
             expiresAt: Date.now() + r.expires_in * 1000 };
  },
  upsertProfile: state => rest(state, '/rest/v1/profiles', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: state.auth.userId, display_name: state.profile.name || 'Reader',
                           time_zone: state.profile.timeZone, encourage_opt_in: state.profile.encourageOptIn }),
  }),
  logReading: (state, book, chapter, correct, total) => rest(state, '/rest/v1/rpc/log_reading', {
    method: 'POST', body: JSON.stringify({ p_book: book, p_chapter: chapter, p_correct: correct, p_total: total }),
  }),
  bossVictory: (state, section, correct, total) => rest(state, '/rest/v1/rpc/record_boss_victory', {
    method: 'POST', body: JSON.stringify({ p_section: section, p_correct: correct, p_total: total }),
  }),
  createCongregation: (state, name) => rest(state, '/rest/v1/congregations', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name, created_by: state.auth.userId }),
  }).then(r => r[0]),
  joinCongregation: (state, code) => rest(state, '/rest/v1/rpc/join_congregation', {
    method: 'POST', body: JSON.stringify({ p_code: code }),
  }),
  myCongregations: state => rest(state, '/rest/v1/congregations?select=id,name,invite_code,goal_laps'),
  monument: (state, id) => rest(state, `/rest/v1/congregation_monument?congregation_id=eq.${id}`).then(r => r[0]),
  leaderboard: (state, id) => rest(state, `/rest/v1/fellowship_leaderboard?congregation_id=eq.${id}`),
  encourage: (state, to) => fetch('/.netlify/functions/encourage-send', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.auth.accessToken}` },
    body: JSON.stringify({ to }),
  }).then(r => r.json()),
  telegramLink: state => fetch('/.netlify/functions/telegram', {
    headers: { Authorization: `Bearer ${state.auth.accessToken}` },
  }).then(r => r.json()),
};
