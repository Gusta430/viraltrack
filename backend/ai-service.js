/**
 * AI Analysis Service + Promo Plan Generator
 * Clean version — optimized prompts, no duplicates
 */

import https from 'https';

const API_KEY = process.env.ANTHROPIC_API_KEY || '';

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

function parseJSON(text) {
  try { return JSON.parse(text); } catch(e) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found');
  let jsonStr = match[0];
  try { return JSON.parse(jsonStr); } catch(e) {
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(jsonStr); } catch(e2) {
      const lastBrace = jsonStr.lastIndexOf('}');
      if (lastBrace > 0) {
        let truncated = jsonStr.substring(0, lastBrace + 1);
        const open = (truncated.match(/{/g) || []).length;
        const close = (truncated.match(/}/g) || []).length;
        for (let i = 0; i < open - close; i++) truncated += '}';
        try { return JSON.parse(truncated); } catch(e3) {}
      }
      throw new Error('JSON parse failed: ' + e2.message);
    }
  }
}

// ── TRACK ANALYSIS ──
export async function analyzeTrack(track, audioFeatures = null) {
  const noSocial = track.no_social === '1' || track.no_social === 1;

  const systemPrompt = `You are an elite music marketer. Always respond in English. Respond ONLY with valid JSON.

CORE RULES:
1. Every suggestion must be UNIQUE to this specific song — if you can swap the song name and it still works, reject it
2. If lyrics are provided, they define EVERYTHING. Read every line. Understand slang and double meanings. The title's meaning comes from the lyrics, not your assumption
3. Content must look cinematic and expensive. Always specify lighting, camera angle, and edit style
4. Match visuals to the song's subculture (trap=cars/street, chill=nature/sunset, dark=noir/rain, pop=color/dance)
5. Never suggest: hand sign challenges, loyalty tests, generic transitions, "POV when the song hits different", or behind-the-scenes studio clips
6. Reference specific lyrics or sonic moments in every suggestion — not just the title
7. Ask yourself "would the artist actually post this?" — if it feels cringe, don't suggest it

${noSocial ? 'THE ARTIST DOES NOT WANT SOCIAL MEDIA CONTENT. Replace video_edits with playlist pitching strategies and diy_content_ideas with offline strategies (blogs, sync licensing, live shows, radio, press, collaborations).' : ''}

JSON structure:
{
  "tempo_bpm": <number>,
  "tempo_description": "<short description>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "energy_percent": <1-100>,
  "energy_description": "<short description>",
  "genre_fit": "<genre description>",
  "audience_age": "<age range>",
  "audience_interests": "<specific interests and subcultures>",
  "audience_platforms": "<platforms>",
  "audience_content_angle": "<content angle>",
  "audience_key_insight": "<one counterintuitive insight>",
  "reference_artists": [{"name":"","genre":"","description":""},{"name":"","genre":"","description":""},{"name":"","genre":"","description":""},{"name":"","genre":"","description":""}],
  "video_edits": [{"title":"","caption":"","hashtags":"","duration":"","timestamp":"","platforms":["TikTok","Reels"]},{"title":"","caption":"","hashtags":"","duration":"","timestamp":"","platforms":["TikTok","Reels"]}],
  "diy_content_ideas": [{"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":<1-100>,"description":"","howTo":["","",""],"hashtags":""},{"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":<1-100>,"description":"","howTo":["","",""],"hashtags":""},{"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":<1-100>,"description":"","howTo":["","",""],"hashtags":""},{"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":<1-100>,"description":"","howTo":["","",""],"hashtags":""}],
  "pro_tip": "<specific tip about content quality — lighting, angles, editing>",
  "creator_tip": "<specific tip about posting consistency and schedule>"
}`;

  const userPrompt = `Analyze this track and create a viral strategy:

Title: "${track.title}"
Artist: ${track.artist}
${track.genre ? `Genre: ${track.genre}` : ''}
${track.similar_artists ? `Similar artists: ${track.similar_artists}` : ''}
${track.main_goal ? `Goal: ${track.main_goal}` : ''}
${track.social_vibe ? `On-camera preference: ${track.social_vibe}` : ''}
${track.target_region ? `Target region: ${track.target_region} — optimize hashtags, trends, posting times and cultural references for this market` : ''}
${track.want_tiktok_content && !noSocial ? 'Include TikTok/Reels content ideas.' : ''}
${noSocial ? 'NO social media. Focus on: playlists, blogs, sync licensing, live shows, radio, press, artist collabs.' : ''}
${track.lyrics ? `
LYRICS (this is the most important input — base everything on what the song actually says):
${track.lyrics}

Understand the real meaning. Find key lines for captions. Create content that captures the lifestyle and emotions described.` : ''}
${audioFeatures?.analyzed ? `
AUDIO DATA (real, from the file — use these exact values):
BPM: ${audioFeatures.bpm} | Key: ${audioFeatures.key} | Energy: ${audioFeatures.energy}% | Danceability: ${audioFeatures.danceability}%
Peak moments: ${audioFeatures.peakMoments?.map(p => p.label).join(', ') || 'unknown'}
Use peak moment timestamps for video suggestions.` : 'No audio file uploaded — estimate BPM/energy from genre.'}

BANNED IDEAS (instant rejection): hand sign challenges, loyalty tests, generic transitions, "POV when the song hits different", any idea that works for ANY song.

Respond ONLY with JSON.`;

  try {
    console.log('🤖 Analyzing track...');
    const response = await callClaude(userPrompt, systemPrompt);
    const result = parseJSON(response);
    console.log('✅ Analysis complete!');
    return {
      tempo_bpm: result.tempo_bpm || 120, tempo_description: result.tempo_description || '',
      mood_tags: JSON.stringify(result.mood_tags || []),
      energy_percent: result.energy_percent || 50, energy_description: result.energy_description || '',
      genre_fit: result.genre_fit || '',
      audience_age: result.audience_age || '', audience_interests: result.audience_interests || '',
      audience_platforms: result.audience_platforms || '', audience_content_angle: result.audience_content_angle || '',
      audience_key_insight: result.audience_key_insight || '',
      reference_artists: JSON.stringify(result.reference_artists || []),
      video_edits: JSON.stringify(result.video_edits || []),
      diy_content_ideas: JSON.stringify(result.diy_content_ideas || []),
      pro_tip: result.pro_tip || '', creator_tip: result.creator_tip || '',
      model_used: 'claude-sonnet-4-20250514', audio_key: audioFeatures?.key || null,
      audio_danceability: audioFeatures?.danceability || null,
      audio_analyzed: audioFeatures?.analyzed || false,
      status: 'completed', completed_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('❌ Analysis failed:', err.message);
    return getFallback('Analysis failed: ' + err.message);
  }
}

// ── PROMO PLAN GENERATOR ──
export async function generatePromoPlan(track, analysis) {
  const moods = JSON.parse(analysis.mood_tags || '[]');
  const refs = JSON.parse(analysis.reference_artists || '[]');
  const noSocial = track.no_social === '1' || track.no_social === 1;

  const systemPrompt = `You are an elite music marketer. Create a specific, actionable 4-week launch plan. Always respond in English. Respond ONLY with valid JSON.

RULES:
1. Every task must be so specific the artist can do it immediately without googling
2. If lyrics are provided, build the strategy around the song's actual themes and emotions
3. Don't use the title as a gimmick — let the lyrics define the content strategy
4. Name REAL playlists, blogs, and platforms — not generic categories
5. Include a complete Meta Ads section with ready-to-paste ad copy and a specific daily budget recommendation with reasoning
6. NEVER suggest: hand sign tutorials, generic dance challenges, or repetitive "post luxury content" tasks. Each day must have a DIFFERENT type of task
7. Budget recommendation in meta_ads MUST include a specific dollar amount and reasoning
${noSocial ? '6. NO social media tasks. Focus entirely on playlists, blogs, sync, live, radio, press, collaborations.' : '6. Include specific social media content with exact descriptions of what to post'}

JSON structure:
{
  "plan_title": "",
  "plan_summary": "",
  "target_audience": {"description":"","best_platforms":["","",""],"best_posting_times":"","content_style":""},
  "weeks": [
    {"week_number":1,"title":"","goal":"","tasks":[{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]},
    {"week_number":2,"title":"","goal":"","tasks":[{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]},
    {"week_number":3,"title":"","goal":"","tasks":[{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]},
    {"week_number":4,"title":"","goal":"","tasks":[{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]}
  ],
  "playlist_strategy": {
    "approach":"",
    "editorial_playlists":[{"name":"","why":"","follower_estimate":""}],
    "independent_playlists":[{"name":"","curator_contact":"","why":""},{"name":"","curator_contact":"","why":""}],
    "pitch_template":"<ready-to-send pitch message>",
    "pitch_tips":"",
    "spotify_for_artists_pitch":"<text to paste into Spotify for Artists>"
  },
  "collaboration_ideas": [{"type":"","description":"","expected_impact":""},{"type":"","description":"","expected_impact":""}],
  "budget_tips": {"free_tactics":["","",""],"paid_options":[{"tactic":"","estimated_cost":"","expected_result":""}]},
  "meta_ads": {
    "campaign_objective":"",
    "ad_copy_variations":[{"headline":"","primary_text":"","cta":""},{"headline":"","primary_text":"","cta":""}],
    "targeting":{"age_range":"","interests":["","","",""],"lookalike_suggestion":"","excluded_audiences":""},
    "budget_recommendation":"",
    "ad_format":"",
    "creative_direction":""
  },
  "key_metrics": ["","","",""],
  "common_mistakes": ["","",""]
}`;

  const userPrompt = `Create a 4-week launch plan:

Title: "${track.title}"
Artist: ${track.artist}
Genre: ${track.genre || analysis.genre_fit || 'Unknown'}
Similar artists: ${track.similar_artists || refs.map(r => r.name).join(', ') || 'Unknown'}
Goal: ${track.main_goal || 'Get the most streams possible'}
Mood: ${moods.join(', ') || 'Unknown'}
Energy: ${analysis.energy_percent || 50}%
BPM: ${analysis.tempo_bpm || 120}
Audience: ${analysis.audience_age || '18-28'}, ${analysis.audience_platforms || 'TikTok, Spotify'}
${track.target_region ? `Target region: ${track.target_region}` : ''}
${noSocial ? 'NO social media. Playlists, blogs, sync, live, radio, press only.' : ''}
${track.lyrics ? `
LYRICS — build the entire strategy around what this song actually says:
${track.lyrics}

Use the themes, emotions and lifestyle from the lyrics to shape every task, ad copy, and playlist pitch.` : ''}

BANNED IDEAS (if you include any of these, the response is invalid):
- Hand sign challenges or tutorials
- Generic dance challenges
- Repetitive luxury posting tasks
- "Post behind the scenes" without a unique angle
- Any task that could apply to ANY song

Respond ONLY with JSON. Be concise — every word must add value.`;

  try {
    console.log('📋 Generating promo plan...');
    const response = await callClaude(userPrompt, systemPrompt);
    const plan = parseJSON(response);
    console.log('✅ Promo plan generated!');
    return plan;
  } catch (err) {
    console.error('❌ Promo plan failed:', err.message);
    return null;
  }
}

// ── FALLBACK ──
function getFallback(msg) {
  return {
    tempo_bpm: 124, tempo_description: 'Danceable, mid-energy pace',
    mood_tags: JSON.stringify(['Melancholic', 'Dreamy', 'Reflective']),
    energy_percent: 72, energy_description: 'Strong emotional build',
    genre_fit: 'Alt-pop / indie electronic', audience_age: '18-28',
    audience_interests: 'indie pop, aesthetics, late-night playlists',
    audience_platforms: 'TikTok, Instagram Reels, Spotify',
    audience_content_angle: 'relatable lyrics + mood-based visuals',
    audience_key_insight: msg || 'Fallback data.',
    reference_artists: JSON.stringify([
      { name: 'Girl in Red', genre: 'Indie pop', description: 'Emotional indie storytelling' },
      { name: 'Clairo', genre: 'Bedroom pop', description: 'Lo-fi intimate production' },
      { name: 'Conan Gray', genre: 'Pop', description: 'Relatable lyricism' },
      { name: 'beabadoobee', genre: 'Indie rock', description: 'Raw nostalgic energy' },
    ]),
    video_edits: JSON.stringify([
      { title: 'Lyric Highlight', caption: 'that one line 🎵💔', hashtags: '#lyrics #viral', duration: '0:15', timestamp: '0:45-1:00', platforms: ['TikTok','Reels'] },
      { title: 'Atmospheric Intro', caption: 'New track 🌌', hashtags: '#newrelease', duration: '0:30', timestamp: '1:15-1:45', platforms: ['TikTok','Reels'] },
    ]),
    diy_content_ideas: JSON.stringify([
      { title: 'Studio Process', difficulty: 'Easy', duration: '30-60 sec', virality: 85, description: 'Film yourself working.', howTo: ['Camera setup','Speed up','Keep authentic'], hashtags: '#studiolife' },
      { title: 'Before vs. After', difficulty: 'Medium', duration: '15-30 sec', virality: 78, description: 'Split-screen comparison.', howTo: ['Two versions','CapCut','Text overlay'], hashtags: '#beforeandafter' },
    ]),
    pro_tip: 'Use natural lighting or cheap LED strips for cinematic look.',
    creator_tip: 'Post 3-4 times per week at consistent times for algorithm momentum.',
    model_used: 'fallback', audio_key: null, audio_danceability: null, audio_analyzed: false,
    status: 'completed', completed_at: new Date().toISOString(),
  };
}
