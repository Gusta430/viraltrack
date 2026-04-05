import https from 'https';
import crypto from 'crypto';

const TURSO_URL = process.env.TURSO_URL || 'libsql://viraltrack-gusta430.aws-eu-west-1.turso.io';
const TURSO_TOKEN = process.env.TURSO_TOKEN || '';

// Convert libsql:// to https:// for HTTP API
const HTTP_URL = TURSO_URL.replace('libsql://', 'https://');

// ── Execute SQL via Turso HTTP API ──
async function execute(sql, args = []) {
  const body = JSON.stringify({
    requests: [
      { type: 'execute', stmt: { sql, args: args.map(a => ({ type: a === null ? 'null' : typeof a === 'number' ? (Number.isInteger(a) ? 'integer' : 'float') : 'text', value: a === null ? null : String(a) })) } },
      { type: 'close' }
    ]
  });

  return new Promise((resolve, reject) => {
    const url = new URL(HTTP_URL + '/v2/pipeline');
    const options = {
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TURSO_TOKEN, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (data.results?.[0]?.type === 'error') {
            reject(new Error(data.results[0].error.message));
            return;
          }
          const result = data.results?.[0]?.response?.result;
          if (!result) { resolve([]); return; }
          const cols = result.cols.map(c => c.name);
          const rows = (result.rows || []).map(row => {
            const obj = {};
            row.forEach((cell, i) => { obj[cols[i]] = cell.value; });
            return obj;
          });
          resolve(rows);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run(sql, args = []) {
  await execute(sql, args);
}

// ── Initialize tables ──
async function initDB() {
  console.log('📦 Initializing Turso database...');
  await run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, plan TEXT DEFAULT 'Free Trial',
    email_notifications TEXT DEFAULT '1', marketing_emails TEXT DEFAULT '0',
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL,
    genre TEXT, similar_artists TEXT, filename TEXT, original_name TEXT, file_size INTEGER,
    spotify_url TEXT, want_tiktok_content INTEGER DEFAULT 0, main_goal TEXT, lyrics TEXT,
    status TEXT DEFAULT 'uploaded', created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY, track_id TEXT NOT NULL, tempo_bpm INTEGER, tempo_description TEXT,
    mood_tags TEXT, energy_percent INTEGER, energy_description TEXT, genre_fit TEXT,
    audience_age TEXT, audience_interests TEXT, audience_platforms TEXT,
    audience_content_angle TEXT, audience_key_insight TEXT, reference_artists TEXT,
    video_edits TEXT, diy_content_ideas TEXT, pro_tip TEXT, creator_tip TEXT,
    model_used TEXT, status TEXT DEFAULT 'pending', error_message TEXT,
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP), completed_at TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, track_id TEXT NOT NULL, analysis_id TEXT,
    type TEXT NOT NULL, title TEXT NOT NULL, status TEXT DEFAULT 'complete',
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS promo_plans (
    track_id TEXT PRIMARY KEY, plan_json TEXT NOT NULL,
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS video_generations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, prompt TEXT NOT NULL,
    status TEXT DEFAULT 'pending', video_url TEXT, request_id TEXT,
    error_message TEXT, created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
  )`);
  // Add new columns if they don't exist (safe to run multiple times)
  try { await run('ALTER TABLE tracks ADD COLUMN lyrics TEXT'); } catch(e) {}
  try { await run('ALTER TABLE tracks ADD COLUMN social_vibe TEXT'); } catch(e) {}
  try { await run('ALTER TABLE analyses ADD COLUMN audio_key TEXT'); } catch(e) {}
  try { await run('ALTER TABLE analyses ADD COLUMN audio_danceability INTEGER'); } catch(e) {}
  try { await run('ALTER TABLE tracks ADD COLUMN target_region TEXT'); } catch(e) {}
  try { await run('ALTER TABLE tracks ADD COLUMN no_social TEXT'); } catch(e) {}
  try { await run('ALTER TABLE tracks ADD COLUMN audience_size TEXT'); } catch(e) {}
  try { await run('ALTER TABLE analyses ADD COLUMN viral_advice TEXT'); } catch(e) {}
  console.log('✅ Database ready!');
}

// ── Password helpers ──
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === test;
}

// ── Database class ──
class Database {
  async init() { await initDB(); }

  // Users
  async createUser(name, email, password) {
    const existing = await execute('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length > 0) return null;
    const id = crypto.randomUUID();
    await run('INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)', [id, name, email.toLowerCase(), hashPassword(password)]);
    return { id, name, email: email.toLowerCase(), plan: 'Free Trial' };
  }

  async loginUser(email, password) {
    const rows = await execute('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (rows.length === 0) return null;
    const user = rows[0];
    if (!verifyPassword(password, user.password_hash)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    await run('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, user.id]);
    return { token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } };
  }

  async getUserByToken(token) {
    if (!token) return null;
    const rows = await execute('SELECT u.id, u.name, u.email, u.plan, u.email_notifications, u.marketing_emails FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?', [token]);
    return rows.length > 0 ? rows[0] : null;
  }

  async logoutUser(token) { await run('DELETE FROM sessions WHERE token = ?', [token]); }

  async updateUser(userId, updates) {
    if (updates.name) await run('UPDATE users SET name = ? WHERE id = ?', [updates.name, userId]);
    if (updates.email) await run('UPDATE users SET email = ? WHERE id = ?', [updates.email.toLowerCase(), userId]);
    if (updates.email_notifications !== undefined) await run('UPDATE users SET email_notifications = ? WHERE id = ?', [updates.email_notifications, userId]);
    if (updates.marketing_emails !== undefined) await run('UPDATE users SET marketing_emails = ? WHERE id = ?', [updates.marketing_emails, userId]);
    const rows = await execute('SELECT id, name, email, plan FROM users WHERE id = ?', [userId]);
    return rows[0] || null;
  }

  // Tracks
  async createTrack(t) {
    await run('INSERT INTO tracks (id, user_id, title, artist, genre, similar_artists, filename, original_name, file_size, spotify_url, want_tiktok_content, main_goal, lyrics, social_vibe, no_social, target_region, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [t.id, t.user_id, t.title, t.artist, t.genre, t.similar_artists, t.filename, t.original_name, t.file_size, t.spotify_url, t.want_tiktok_content, t.main_goal, t.lyrics, t.social_vibe, t.no_social, t.target_region, t.status]);
    return t;
  }

  async getTracks(userId) {
    return execute('SELECT * FROM tracks WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  }

  async getTrack(id) {
    const rows = await execute('SELECT * FROM tracks WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async updateTrack(id, updates) {
    if (updates.status) await run('UPDATE tracks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [updates.status, id]);
    return this.getTrack(id);
  }

  async deleteTrack(id) {
    await run('DELETE FROM promo_plans WHERE track_id = ?', [id]);
    await run('DELETE FROM reports WHERE track_id = ?', [id]);
    await run('DELETE FROM analyses WHERE track_id = ?', [id]);
    await run('DELETE FROM tracks WHERE id = ?', [id]);
  }

  // Analyses
  async createAnalysis(a) {
    await run('INSERT INTO analyses (id, track_id, status) VALUES (?, ?, ?)', [a.id, a.track_id, a.status]);
    return a;
  }

  async getAnalysis(id) {
    const rows = await execute('SELECT * FROM analyses WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async getAnalysisByTrack(trackId) {
    const rows = await execute('SELECT * FROM analyses WHERE track_id = ? ORDER BY created_at DESC LIMIT 1', [trackId]);
    return rows[0] || null;
  }

  async updateAnalysis(id, u) {
    await run(`UPDATE analyses SET tempo_bpm=?, tempo_description=?, mood_tags=?, energy_percent=?, energy_description=?, genre_fit=?, audience_age=?, audience_interests=?, audience_platforms=?, audience_content_angle=?, audience_key_insight=?, reference_artists=?, video_edits=?, diy_content_ideas=?, pro_tip=?, creator_tip=?, model_used=?, audio_key=?, audio_danceability=?, viral_advice=?, status=?, completed_at=? WHERE id=?`,
      [u.tempo_bpm, u.tempo_description, u.mood_tags, u.energy_percent, u.energy_description, u.genre_fit, u.audience_age, u.audience_interests, u.audience_platforms, u.audience_content_angle, u.audience_key_insight, u.reference_artists, u.video_edits, u.diy_content_ideas, u.pro_tip, u.creator_tip, u.model_used, u.audio_key, u.audio_danceability, u.viral_advice, u.status, u.completed_at, id]);
    return this.getAnalysis(id);
  }

  // Reports
  async createReport(r) {
    await run('INSERT INTO reports (id, track_id, analysis_id, type, title, status) VALUES (?,?,?,?,?,?)',
      [r.id, r.track_id, r.analysis_id, r.type, r.title, r.status]);
    return r;
  }

  async getReports(userId) {
    return execute('SELECT r.*, t.title as track_title, t.artist as track_artist FROM reports r JOIN tracks t ON r.track_id = t.id WHERE t.user_id = ? ORDER BY r.created_at DESC', [userId]);
  }

  // Promo plans
  async savePromoPlan(trackId, plan) {
    await run('DELETE FROM promo_plans WHERE track_id = ?', [trackId]);
    await run('INSERT INTO promo_plans (track_id, plan_json) VALUES (?, ?)', [trackId, JSON.stringify(plan)]);
  }

  async getPromoPlan(trackId) {
    const rows = await execute('SELECT plan_json FROM promo_plans WHERE track_id = ?', [trackId]);
    if (rows.length === 0) return null;
    try { return JSON.parse(rows[0].plan_json); } catch { return null; }
  }

  // Video generations
  async createVideoGeneration(v) {
    await run('INSERT INTO video_generations (id, user_id, prompt, status, request_id) VALUES (?,?,?,?,?)',
      [v.id, v.user_id, v.prompt, v.status, v.request_id]);
    return v;
  }

  async getVideoGeneration(id) {
    const rows = await execute('SELECT * FROM video_generations WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async getVideoGenerationByRequestId(requestId) {
    const rows = await execute('SELECT * FROM video_generations WHERE request_id = ?', [requestId]);
    return rows[0] || null;
  }

  async updateVideoGeneration(id, updates) {
    const sets = [], args = [];
    if (updates.status) { sets.push('status = ?'); args.push(updates.status); }
    if (updates.video_url) { sets.push('video_url = ?'); args.push(updates.video_url); }
    if (updates.request_id) { sets.push('request_id = ?'); args.push(updates.request_id); }
    if (updates.error_message) { sets.push('error_message = ?'); args.push(updates.error_message); }
    if (sets.length > 0) { args.push(id); await run(`UPDATE video_generations SET ${sets.join(', ')} WHERE id = ?`, args); }
    return this.getVideoGeneration(id);
  }

  async getUserVideoCountToday(userId) {
    const rows = await execute("SELECT COUNT(*) as c FROM video_generations WHERE user_id = ? AND created_at >= date('now') AND status != 'error'", [userId]);
    return parseInt(rows[0]?.c || 0);
  }

  async getUserVideos(userId) {
    return execute('SELECT * FROM video_generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [userId]);
  }

  // Admin
  async getAllUsers() {
    return execute("SELECT id, name, email, plan, created_at FROM users ORDER BY created_at DESC");
  }

  async getUserCount() {
    const rows = await execute("SELECT COUNT(*) as c FROM users");
    return parseInt(rows[0]?.c || 0);
  }

  // Dashboard
  async getStats(userId) {
    const tracks = await execute("SELECT COUNT(*) as c FROM tracks WHERE user_id = ? AND status = 'analyzed'", [userId]);
    const plans = await execute('SELECT COUNT(*) as c FROM promo_plans pp JOIN tracks t ON pp.track_id = t.id WHERE t.user_id = ?', [userId]);
    return {
      total_tracks: parseInt(tracks[0]?.c || 0),
      promo_plans: parseInt(plans[0]?.c || 0),
      total_views: '0', engagement_rate: '0%',
      weekly_tracks: 'this week', weekly_promos: 'this week',
      weekly_views: 'this week', weekly_engagement: 'this week',
    };
  }
}

export default new Database();
