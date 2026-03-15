import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import db from './db.js';
import { analyzeTrack, generatePromoPlan } from './ai-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, '..', 'frontend', 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const uuid = () => crypto.randomUUID();
const MIME_TYPES = { '.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon' };

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { const raw = Buffer.concat(chunks).toString(); try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
    req.on('error', reject);
  });
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const boundary = req.headers['content-type']?.split('boundary=')[1];
    if (!boundary) return resolve({ fields: {}, file: null });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const delim = Buffer.from(`--${boundary}`);
      const parts = []; let start = buffer.indexOf(delim) + delim.length + 2;
      while (true) { const end = buffer.indexOf(delim, start); if (end === -1) break; parts.push(buffer.slice(start, end)); start = end + delim.length + 2; }
      const fields = {}; let file = null;
      for (const part of parts) {
        const hEnd = part.indexOf('\r\n\r\n'); if (hEnd === -1) continue;
        const hdr = part.slice(0, hEnd).toString(), body = part.slice(hEnd + 4, part.length - 2);
        const nm = hdr.match(/name="([^"]+)"/), fn = hdr.match(/filename="([^"]+)"/);
        if (fn && nm) { const saved = `${uuid()}${path.extname(fn[1]).toLowerCase()}`; fs.writeFileSync(path.join(UPLOADS_DIR, saved), body); file = { filename: saved, originalname: fn[1], size: body.length }; }
        else if (nm) { fields[nm[1]] = body.toString(); }
      }
      resolve({ fields, file });
    });
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization' });
  res.end(JSON.stringify(data));
}
function cors(res) {
  res.writeHead(204, { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' });
  res.end();
}

// Auth helper — get user from Authorization header
function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  return db.getUserByToken(token);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const method = req.method;
  if (method === 'OPTIONS') return cors(res);

  try {
    // ── AUTH ROUTES (no login required) ───────────────
    if (p === '/api/auth/register' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.name || !body.email || !body.password) return json(res, { error: 'Name, email and password required' }, 400);
      if (body.password.length < 6) return json(res, { error: 'Password must be at least 6 characters' }, 400);
      const user = db.createUser(body.name, body.email, body.password);
      if (!user) return json(res, { error: 'Email already registered' }, 409);
      // Auto-login after register
      const session = db.loginUser(body.email, body.password);
      return json(res, session, 201);
    }

    if (p === '/api/auth/login' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.email || !body.password) return json(res, { error: 'Email and password required' }, 400);
      const session = db.loginUser(body.email, body.password);
      if (!session) return json(res, { error: 'Wrong email or password' }, 401);
      return json(res, session);
    }

    if (p === '/api/auth/logout' && method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) db.logoutUser(token);
      return json(res, { success: true });
    }

    if (p === '/api/auth/me' && method === 'GET') {
      const user = getUser(req);
      if (!user) return json(res, { error: 'Not logged in' }, 401);
      return json(res, user);
    }

    // ── PROTECTED ROUTES (login required) ─────────────
    const user = getUser(req);
    if (p.startsWith('/api/') && !user) return json(res, { error: 'Login required' }, 401);

    // Dashboard
    if (p === '/api/dashboard' && method === 'GET') return json(res, db.getStats(user.id));

    // Tracks - list (user's tracks only)
    if (p === '/api/tracks' && method === 'GET') return json(res, db.getTracks(user.id));

    // Tracks - create
    if (p === '/api/tracks' && method === 'POST') {
      const isMultipart = req.headers['content-type']?.includes('multipart');
      let fields, file;
      if (isMultipart) { ({ fields, file } = await parseMultipart(req)); } else { fields = await parseBody(req); file = null; }
      const track = {
        id: uuid(), user_id: user.id, title: fields.title || 'Untitled', artist: fields.artist || 'Unknown',
        genre: fields.genre || null, similar_artists: fields.similar_artists || null,
        filename: file?.filename || null, original_name: file?.originalname || null,
        file_size: file?.size || null, spotify_url: fields.spotify_url || null,
        want_tiktok_content: fields.want_tiktok_content === '1' ? 1 : 0,
        main_goal: fields.main_goal || null, status: fields.status || 'uploaded',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      return json(res, db.createTrack(track), 201);
    }

    // Track - get
    const trackMatch = p.match(/^\/api\/tracks\/([^/]+)$/);
    if (trackMatch && method === 'GET') {
      const track = db.getTrack(trackMatch[1]);
      if (!track || track.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      const analysis = db.getAnalysisByTrack(track.id);
      const promoPlan = db.getPromoPlan(track.id);
      return json(res, { ...track, analysis, promo_plan: promoPlan });
    }

    if (trackMatch && method === 'DELETE') {
      const track = db.getTrack(trackMatch[1]);
      if (!track || track.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      db.deleteTrack(trackMatch[1]);
      return json(res, { success: true });
    }

    // Track - analyze
    const analyzeMatch = p.match(/^\/api\/tracks\/([^/]+)\/analyze$/);
    if (analyzeMatch && method === 'POST') {
      const track = db.getTrack(analyzeMatch[1]);
      if (!track || track.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      db.updateTrack(track.id, { status: 'analyzing' });
      const analysisId = uuid();
      db.createAnalysis({ id: analysisId, track_id: track.id, status: 'processing' });
      const result = await analyzeTrack(track);
      db.updateAnalysis(analysisId, result);
      db.updateTrack(track.id, { status: 'analyzed' });
      db.createReport({ id: uuid(), track_id: track.id, analysis_id: analysisId, type: 'analysis', title: `${track.title} - Analysis`, status: 'complete', created_at: new Date().toISOString() });
      return json(res, { track: db.getTrack(track.id), analysis: db.getAnalysis(analysisId) });
    }

    // Promo plan
    const promoMatch = p.match(/^\/api\/tracks\/([^/]+)\/promo-plan$/);
    if (promoMatch && method === 'POST') {
      const track = db.getTrack(promoMatch[1]);
      if (!track || track.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      const analysis = db.getAnalysisByTrack(track.id);
      if (!analysis) return json(res, { error: 'Analyze track first' }, 400);
      const plan = await generatePromoPlan(track, analysis);
      if (plan) {
        db.savePromoPlan(track.id, plan);
        db.createReport({ id: uuid(), track_id: track.id, analysis_id: analysis.id, type: 'promo_plan', title: `${track.title} - Promo Plan`, status: 'complete', created_at: new Date().toISOString() });
        return json(res, { plan });
      }
      return json(res, { error: 'Could not generate promo plan' }, 500);
    }

    // Demo track
    if (p === '/api/demo' && method === 'POST') {
      const trackId = uuid();
      db.createTrack({ id: trackId, user_id: user.id, title: 'Midnight Thoughts', artist: 'Luna Rose', genre: 'Indie pop', similar_artists: 'Billie Eilish, Clairo', filename: null, original_name: null, file_size: null, spotify_url: null, want_tiktok_content: 1, main_goal: 'Grow fanbase', status: 'analyzing', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      const analysisId = uuid();
      db.createAnalysis({ id: analysisId, track_id: trackId, status: 'processing' });
      const result = await analyzeTrack({ title: 'Midnight Thoughts', artist: 'Luna Rose', genre: 'Indie pop', similar_artists: 'Billie Eilish, Clairo', main_goal: 'Grow fanbase', want_tiktok_content: 1 });
      db.updateAnalysis(analysisId, result);
      db.updateTrack(trackId, { status: 'analyzed' });
      db.createReport({ id: uuid(), track_id: trackId, analysis_id: analysisId, type: 'analysis', title: 'Midnight Thoughts - Analysis', status: 'complete', created_at: new Date().toISOString() });
      return json(res, { trackId });
    }

    // Reports
    if (p === '/api/reports' && method === 'GET') return json(res, db.getReports(user.id));

    // Settings
    if (p === '/api/settings' && method === 'GET') return json(res, { user_name: user.name, user_email: user.email, plan: user.plan, email_notifications: user.email_notifications, marketing_emails: user.marketing_emails });
    if (p === '/api/settings' && method === 'PUT') { const body = await parseBody(req); const updated = db.updateUser(user.id, { name: body.user_name, email: body.user_email, email_notifications: body.email_notifications, marketing_emails: body.marketing_emails }); return json(res, updated); }

    // ── Static files ──
    let filePath = path.join(STATIC_DIR, p === '/' ? 'index.html' : p);
    if (!fs.existsSync(filePath)) filePath = path.join(STATIC_DIR, 'index.html');
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(fs.readFileSync(filePath));

  } catch (err) {
    console.error('Server error:', err);
    json(res, { error: err.message }, 500);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n  🎵 ViralTrack running at http://localhost:${PORT}\n`));
