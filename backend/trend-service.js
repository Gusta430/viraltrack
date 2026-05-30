/**
 * Trend Service v2 — Auto-fetching real viral trends
 *
 * Instead of relying on manual admin uploads of generic trends,
 * this service auto-generates fresh, platform-specific trend intelligence
 * using Claude. Trends are cached for 12 hours so we don't burn API calls.
 *
 * The key difference: these aren't "challenge templates" — they're
 * specific viral FORMATS and MECHANICS that are working right now,
 * tailored to how musicians can use them.
 */

import https from 'https';
import db from './db.js';

const API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Cache duration: 12 hours (trends don't change hourly)
const CACHE_HOURS = 12;

function callClaude(prompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (data.error) { reject(new Error(data.error.message)); return; }
          resolve(data.content?.[0]?.text || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Fetch fresh trend intelligence from Claude.
 * This generates platform-specific viral mechanics, not generic challenge names.
 */
async function fetchFreshTrends() {
  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toLocaleString('en', { month: 'long', year: 'numeric' });

  const systemPrompt = `You are a TikTok/Reels/Shorts trend analyst who tracks EXACTLY what's going viral RIGHT NOW. You think like a creator who spends 4 hours/day on For You pages studying what works — not a marketing textbook.

Your job: identify the specific FORMATS, EDITING STYLES, and CONTENT MECHANICS that are getting millions of views this week. Focus on what musicians and music promoters can adapt.

CRITICAL RULES:
- Only cite formats/mechanics you have strong evidence are trending in ${month}
- Describe the MECHANIC (how the video is structured, edited, paced) — not just a name
- Include specific examples of what the top videos doing this look like
- Explain WHY the algorithm pushes this format (completion rate, shares, comments)
- If you're not sure something is trending RIGHT NOW, don't include it
- Focus on formats ANY musician can do, not just famous artists
- Include both TikTok-native and cross-platform trends
- Be specific about editing techniques, transitions, text styles, audio usage`;

  const userPrompt = `Date: ${today}

List the viral content formats, editing styles, and posting mechanics that are ACTUALLY working on TikTok, Instagram Reels, and YouTube Shorts right now for music content. Not generic challenge names — specific techniques.

For each trend, I need:
1. What exactly the format looks like (structure, pacing, editing)
2. Why it goes viral (algorithm mechanic: completion rate, shares, saves, etc.)
3. How a musician would adapt it specifically
4. An example of what the finished video looks like

Also: what posting/caption mechanics are working right now? (text placement, hook styles, caption structures, comment bait strategies)

Respond ONLY with JSON:
{
  "generated_date": "${today}",
  "viral_formats": [
    {
      "name": "<short name>",
      "platform": "TikTok|Reels|Shorts|All",
      "format_type": "editing_style|content_structure|audio_technique|caption_mechanic|transition_style",
      "what_it_looks_like": "<exact description of what these videos look like — structure, pacing, shots, edits>",
      "why_it_works": "<specific algorithm mechanic — which metric does this boost and how>",
      "music_adaptation": "<how a musician uses this format to promote their song — specific, not generic>",
      "example": "<describe a specific example video that went viral using this format>",
      "difficulty": "Easy|Medium|Hard",
      "best_for_genre": "<which genres this works best for, or 'All'>"
    }
  ],
  "posting_mechanics": [
    {
      "mechanic": "<specific technique>",
      "why_it_works": "<algorithm/psychology reason>",
      "how_to_use": "<exact instructions>"
    }
  ],
  "caption_hooks": [
    "<specific hook format that's working — with template>",
    "<another>",
    "<another>"
  ],
  "trending_hashtag_strategies": [
    {
      "strategy": "<specific hashtag technique>",
      "example_tags": ["#tag1", "#tag2"],
      "why": "<reason>"
    }
  ],
  "dead_trends": [
    "<format/challenge that is OVER — stop doing this>"
  ]
}`;

  try {
    console.log('🔥 Fetching fresh trend intelligence...');
    const response = await callClaude(userPrompt, systemPrompt);

    // Parse the JSON response
    const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in trend response');

    let trends;
    try {
      trends = JSON.parse(match[0]);
    } catch(e) {
      // Try fixing trailing commas
      const fixed = match[0].replace(/,(\s*[}\]])/g, '$1');
      trends = JSON.parse(fixed);
    }

    trends.generated_date = today;
    trends.cached_at = new Date().toISOString();

    // Save to DB for caching
    await db.saveTrends(trends);
    console.log(`✅ Fresh trends cached: ${(trends.viral_formats || []).length} formats, ${(trends.posting_mechanics || []).length} mechanics`);

    return trends;
  } catch (err) {
    console.error('❌ Failed to fetch fresh trends:', err.message);
    return null;
  }
}

/**
 * Get trends — returns cached trends if fresh, otherwise fetches new ones.
 * Never blocks the analysis if trend-fetching fails.
 */
export async function getTrends() {
  try {
    // Check cached trends in DB
    const cached = await db.getTrends();

    if (cached && cached.cached_at) {
      const cacheAge = (Date.now() - new Date(cached.cached_at).getTime()) / (1000 * 60 * 60);
      if (cacheAge < CACHE_HOURS) {
        console.log(`📊 Using cached trends (${cacheAge.toFixed(1)}h old, refresh in ${(CACHE_HOURS - cacheAge).toFixed(1)}h)`);
        return cached;
      }
      console.log(`📊 Cached trends are ${cacheAge.toFixed(1)}h old — refreshing...`);
    }

    // No cache or stale — fetch fresh
    if (!API_KEY) {
      console.log('⚠️ No API key — skipping trend fetch');
      return cached || getDefaultTrends();
    }

    const fresh = await fetchFreshTrends();
    return fresh || cached || getDefaultTrends();

  } catch (e) {
    console.error('Trend service error:', e.message);
    return getDefaultTrends();
  }
}

/**
 * Force refresh trends (admin action)
 */
export async function refreshTrends() {
  return await fetchFreshTrends();
}

/**
 * Format trends for injection into the analysis prompt.
 * This is the key improvement — instead of just listing trends,
 * we give Claude structured trend intelligence it can actually use.
 */
export function formatTrendsForPrompt(trends) {
  if (!trends) return '';

  const parts = [];

  // Viral formats
  if (trends.viral_formats && trends.viral_formats.length > 0) {
    parts.push('CURRENT VIRAL FORMATS (adapt 1-2 that genuinely fit this song — never force a trend):');
    for (const f of trends.viral_formats.slice(0, 8)) {
      parts.push(`• ${f.name} (${f.platform}, ${f.difficulty}): ${f.what_it_looks_like}`);
      parts.push(`  → Music use: ${f.music_adaptation}`);
      parts.push(`  → Works because: ${f.why_it_works}`);
      if (f.best_for_genre && f.best_for_genre !== 'All') {
        parts.push(`  → Best for: ${f.best_for_genre}`);
      }
    }
  }

  // Posting mechanics
  if (trends.posting_mechanics && trends.posting_mechanics.length > 0) {
    parts.push('\nWORKING POSTING MECHANICS:');
    for (const m of trends.posting_mechanics.slice(0, 5)) {
      parts.push(`• ${m.mechanic}: ${m.how_to_use} (${m.why_it_works})`);
    }
  }

  // Caption hooks
  if (trends.caption_hooks && trends.caption_hooks.length > 0) {
    parts.push('\nHOOK FORMATS THAT STOP SCROLLING:');
    for (const h of trends.caption_hooks.slice(0, 5)) {
      parts.push(`• ${h}`);
    }
  }

  // Hashtag strategies
  if (trends.trending_hashtag_strategies && trends.trending_hashtag_strategies.length > 0) {
    parts.push('\nHASHTAG TACTICS:');
    for (const s of trends.trending_hashtag_strategies.slice(0, 3)) {
      parts.push(`• ${s.strategy}: ${s.example_tags.join(', ')} — ${s.why}`);
    }
  }

  // Dead trends
  if (trends.dead_trends && trends.dead_trends.length > 0) {
    parts.push('\nDEAD TRENDS (do NOT suggest these — they are OVER):');
    for (const d of trends.dead_trends) {
      parts.push(`• ${d}`);
    }
  }

  return parts.join('\n');
}

/**
 * Hardcoded fallback trends — only used when both API and DB fail.
 * These are evergreen formats that always work, not time-specific trends.
 */
function getDefaultTrends() {
  return {
    generated_date: 'fallback',
    viral_formats: [
      {
        name: 'The 3-Second Hook Cut',
        platform: 'All',
        format_type: 'editing_style',
        what_it_looks_like: 'Video opens with the most dramatic/emotional/surprising moment, then jump-cuts to the start of the story. The first 3 seconds are the climax, rest is the buildup.',
        why_it_works: 'Kills scroll. People stay to understand the context of what they just saw. Completion rate through the roof.',
        music_adaptation: 'Open with the hardest bar or most emotional lyric as text overlay on a dramatic visual, then cut to the verse that builds to it.',
        difficulty: 'Easy',
        best_for_genre: 'All'
      },
      {
        name: 'Text-Over-Real-Life',
        platform: 'TikTok',
        format_type: 'content_structure',
        what_it_looks_like: 'Casual footage (walking, driving, cooking) with bold text overlay telling a story or sharing a thought. No talking to camera. Song plays underneath.',
        why_it_works: 'Feels authentic, not performative. High completion because the text pacing controls attention. Easy to rewatch to read everything.',
        music_adaptation: 'Film everyday moments that match the song mood. Overlay key lyrics as text, word by word, timed to the beat. No face needed.',
        difficulty: 'Easy',
        best_for_genre: 'All'
      },
      {
        name: 'The Silent Build',
        platform: 'All',
        format_type: 'audio_technique',
        what_it_looks_like: 'Video starts silent or with ambient noise for 2-4 seconds while building tension visually, then the beat/hook drops and everything changes — color grade shift, speed change, reveal.',
        why_it_works: 'The silence is jarring in a feed full of noise. People stop to see what happens. The drop creates a dopamine hit that triggers shares.',
        music_adaptation: 'Start with silence + a question or intriguing visual, then drop your most powerful moment. The contrast makes people replay.',
        difficulty: 'Medium',
        best_for_genre: 'Hip Hop, Trap, EDM, Pop'
      },
      {
        name: 'POV Storytelling',
        platform: 'All',
        format_type: 'content_structure',
        what_it_looks_like: 'Camera is the viewer\'s eyes. Text says "POV: [relatable scenario]". Song plays as the emotional underscore while visuals play out the scenario.',
        why_it_works: 'Relatability drives comments ("this is so me") and shares ("tag someone"). Song becomes associated with a feeling, not just promotion.',
        music_adaptation: 'Pick a lyric theme and build a relatable POV around it. The song IS the emotional context, not the subject of the video.',
        difficulty: 'Easy',
        best_for_genre: 'R&B, Pop, Indie, Lo-fi'
      }
    ],
    posting_mechanics: [
      { mechanic: 'Post-then-engage sprint', why_it_works: 'First 30 min of engagement signals determine reach', how_to_use: 'Post, then immediately engage with 10-15 accounts in your niche for 30 minutes to drive reciprocal engagement' },
      { mechanic: 'Pinned comment question', why_it_works: 'Doubles comment count by giving people something specific to respond to', how_to_use: 'Pin your own comment with a question related to the video — not "what do you think?" but a specific debatable question' }
    ],
    caption_hooks: [
      '"Wait for it..." (drives completion)',
      '"This [lyric] hits different when you..." (relatability)',
      '"I wasn\'t supposed to share this but..." (curiosity)',
      '"Tell me you [feeling] without telling me you [feeling]" (participation)'
    ],
    trending_hashtag_strategies: [],
    dead_trends: [
      'Song Association Challenge — oversaturated, algorithm deprioritizes it',
      'Rate My Playlist — peaked in 2023, low engagement now',
      'Invisible Challenge — algorithm ignores this format now',
      'Generic dance challenges without a specific hook'
    ],
    cached_at: new Date().toISOString()
  };
}
