import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, 'data', 'db.json');

function load() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch (e) {}
  return { users: [], sessions: [], tracks: [], analyses: [], reports: [], promo_plans: [] };
}

function save(data) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Password hashing with built-in crypto (no external deps)
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

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

class Database {
  constructor() {
    this.data = load();
    if (!this.data.users) this.data.users = [];
    if (!this.data.sessions) this.data.sessions = [];
    if (!this.data.promo_plans) this.data.promo_plans = [];
  }

  // ── Users ──
  createUser(name, email, password) {
    if (this.data.users.find(u => u.email === email.toLowerCase())) return null; // exists
    const user = {
      id: crypto.randomUUID(),
      name,
      email: email.toLowerCase(),
      password_hash: hashPassword(password),
      plan: 'Free Trial',
      email_notifications: '1',
      marketing_emails: '0',
      created_at: new Date().toISOString(),
    };
    this.data.users.push(user);
    save(this.data);
    return { id: user.id, name: user.name, email: user.email, plan: user.plan };
  }

  loginUser(email, password) {
    const user = this.data.users.find(u => u.email === email.toLowerCase());
    if (!user) return null;
    if (!verifyPassword(password, user.password_hash)) return null;
    // Create session
    const token = generateToken();
    const session = { token, user_id: user.id, created_at: new Date().toISOString() };
    this.data.sessions.push(session);
    save(this.data);
    return { token, user: { id: user.id, name: user.name, email: user.email, plan: user.plan } };
  }

  getUserByToken(token) {
    if (!token) return null;
    const session = this.data.sessions.find(s => s.token === token);
    if (!session) return null;
    const user = this.data.users.find(u => u.id === session.user_id);
    if (!user) return null;
    return { id: user.id, name: user.name, email: user.email, plan: user.plan, email_notifications: user.email_notifications, marketing_emails: user.marketing_emails };
  }

  logoutUser(token) {
    this.data.sessions = this.data.sessions.filter(s => s.token !== token);
    save(this.data);
  }

  updateUser(userId, updates) {
    const i = this.data.users.findIndex(u => u.id === userId);
    if (i === -1) return null;
    if (updates.name) this.data.users[i].name = updates.name;
    if (updates.email) this.data.users[i].email = updates.email.toLowerCase();
    if (updates.email_notifications !== undefined) this.data.users[i].email_notifications = updates.email_notifications;
    if (updates.marketing_emails !== undefined) this.data.users[i].marketing_emails = updates.marketing_emails;
    save(this.data);
    const u = this.data.users[i];
    return { id: u.id, name: u.name, email: u.email, plan: u.plan };
  }

  // ── Tracks (filtered by user) ──
  createTrack(t) { this.data.tracks.unshift(t); save(this.data); return t; }
  getTracks(userId) { return this.data.tracks.filter(t => t.user_id === userId); }
  getTrack(id) { return this.data.tracks.find(t => t.id === id) || null; }
  updateTrack(id, u) { const i = this.data.tracks.findIndex(t => t.id === id); if (i === -1) return null; this.data.tracks[i] = { ...this.data.tracks[i], ...u, updated_at: new Date().toISOString() }; save(this.data); return this.data.tracks[i]; }
  deleteTrack(id) { this.data.tracks = this.data.tracks.filter(t => t.id !== id); this.data.analyses = this.data.analyses.filter(a => a.track_id !== id); this.data.reports = this.data.reports.filter(r => r.track_id !== id); this.data.promo_plans = this.data.promo_plans.filter(p => p.track_id !== id); save(this.data); }

  // ── Analyses ──
  createAnalysis(a) { this.data.analyses.unshift(a); save(this.data); return a; }
  getAnalysis(id) { return this.data.analyses.find(a => a.id === id) || null; }
  getAnalysisByTrack(tid) { return this.data.analyses.find(a => a.track_id === tid) || null; }
  updateAnalysis(id, u) { const i = this.data.analyses.findIndex(a => a.id === id); if (i === -1) return null; this.data.analyses[i] = { ...this.data.analyses[i], ...u }; save(this.data); return this.data.analyses[i]; }

  // ── Reports (filtered by user) ──
  createReport(r) { this.data.reports.unshift(r); save(this.data); return r; }
  getReports(userId) {
    const userTrackIds = this.data.tracks.filter(t => t.user_id === userId).map(t => t.id);
    return this.data.reports.filter(r => userTrackIds.includes(r.track_id)).map(r => {
      const t = this.getTrack(r.track_id);
      return { ...r, track_title: t?.title, track_artist: t?.artist };
    });
  }

  // ── Promo Plans ──
  savePromoPlan(trackId, plan) { this.data.promo_plans = this.data.promo_plans.filter(p => p.track_id !== trackId); this.data.promo_plans.unshift({ track_id: trackId, plan, created_at: new Date().toISOString() }); save(this.data); }
  getPromoPlan(trackId) { const entry = this.data.promo_plans.find(p => p.track_id === trackId); return entry?.plan || null; }

  // ── Dashboard (filtered by user) ──
  getStats(userId) {
    const userTracks = this.data.tracks.filter(t => t.user_id === userId);
    const trackIds = userTracks.map(t => t.id);
    return {
      total_tracks: userTracks.filter(t => t.status === 'analyzed').length,
      promo_plans: this.data.promo_plans.filter(p => trackIds.includes(p.track_id)).length,
      total_views: '0', engagement_rate: '0%',
      weekly_tracks: 'this week', weekly_promos: 'this week',
      weekly_views: 'this week', weekly_engagement: 'this week',
    };
  }
}

export default new Database();
