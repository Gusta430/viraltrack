import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, 'data', 'db.json');

function load() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); } catch (e) {}
  return { tracks: [], analyses: [], reports: [], promo_plans: [], settings: { user_name: 'Alex Morgan', user_email: 'alex@example.com', email_notifications: '1', marketing_emails: '0', plan: 'Pro Trial' } };
}

function save(data) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

class Database {
  constructor() { this.data = load(); if (!this.data.promo_plans) this.data.promo_plans = []; }

  createTrack(t) { this.data.tracks.unshift(t); save(this.data); return t; }
  getTracks() { return this.data.tracks; }
  getTrack(id) { return this.data.tracks.find(t => t.id === id) || null; }
  updateTrack(id, u) { const i = this.data.tracks.findIndex(t => t.id === id); if (i === -1) return null; this.data.tracks[i] = { ...this.data.tracks[i], ...u, updated_at: new Date().toISOString() }; save(this.data); return this.data.tracks[i]; }
  deleteTrack(id) { this.data.tracks = this.data.tracks.filter(t => t.id !== id); this.data.analyses = this.data.analyses.filter(a => a.track_id !== id); this.data.reports = this.data.reports.filter(r => r.track_id !== id); this.data.promo_plans = this.data.promo_plans.filter(p => p.track_id !== id); save(this.data); }

  createAnalysis(a) { this.data.analyses.unshift(a); save(this.data); return a; }
  getAnalysis(id) { return this.data.analyses.find(a => a.id === id) || null; }
  getAnalysisByTrack(tid) { return this.data.analyses.find(a => a.track_id === tid) || null; }
  updateAnalysis(id, u) { const i = this.data.analyses.findIndex(a => a.id === id); if (i === -1) return null; this.data.analyses[i] = { ...this.data.analyses[i], ...u }; save(this.data); return this.data.analyses[i]; }

  createReport(r) { this.data.reports.unshift(r); save(this.data); return r; }
  getReports() { return this.data.reports.map(r => { const t = this.getTrack(r.track_id); return { ...r, track_title: t?.title, track_artist: t?.artist }; }); }

  savePromoPlan(trackId, plan) { this.data.promo_plans = this.data.promo_plans.filter(p => p.track_id !== trackId); this.data.promo_plans.unshift({ track_id: trackId, plan, created_at: new Date().toISOString() }); save(this.data); }
  getPromoPlan(trackId) { const entry = this.data.promo_plans.find(p => p.track_id === trackId); return entry?.plan || null; }

  getSettings() { return { ...this.data.settings }; }
  updateSettings(u) { this.data.settings = { ...this.data.settings, ...u }; save(this.data); return this.data.settings; }

  getStats() {
    return {
      total_tracks: this.data.tracks.filter(t => t.status === 'analyzed').length,
      promo_plans: this.data.promo_plans.length,
      total_views: '45.2K', engagement_rate: '8.4%',
      weekly_tracks: '+3 this week', weekly_promos: '+2 this week',
      weekly_views: '+12% this week', weekly_engagement: '+1.2% this week',
    };
  }
}

export default new Database();
