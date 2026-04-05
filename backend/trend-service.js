/**
 * Trend Service — reads trends from database (admin-managed)
 */

import db from './db.js';

export async function getTrends() {
  try {
    const trends = await db.getTrends();
    if (trends) return trends;
  } catch(e) { console.error('Failed to load trends:', e.message); }
  return { trends: [], trending_hashtags: [], trending_formats: [] };
}
