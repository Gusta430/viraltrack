/**
 * AI Analysis Service + Promo Plan Generator
 * v3 — lyrics-driven, audience-aware, anti-cringe engine
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

// ── AUDIENCE TIER STRATEGY ──
// Injects fundamentally different tactical advice based on where the artist actually is.
// This isn't a disclaimer — it changes what types of ideas are even valid.

function getAudienceTierPrompt(audienceSize) {
  const tiers = {
    starting: `AUDIENCE TIER: JUST STARTING (0-500 followers)
This artist has almost NO existing audience. Every single suggestion must be a GROWTH tactic — putting the song in front of people who don't know this artist exists.

WHAT ACTUALLY WORKS AT 0-500:
- Commenting strategy: Leave genuine, interesting comments on videos by bigger artists in the same niche. Not "check my music" — real reactions that make people click the profile. This is the #1 free growth tactic for unknown artists.
- Niche community infiltration: Find 3-5 specific communities (subreddits, Discord servers, niche hashtag communities) where this song's target listeners hang out. Become a real member, then share music naturally.
- Micro-creator seeding: Find creators with 1K-10K followers in the song's niche. Offer early access or free use of the track. Micro-creators have 5-10% engagement rates and many accept free music over payment.
- Content volume: 20-30 short videos per release, each testing a different hook. The algorithm needs volume to learn who likes this sound.
- Email list from day one: Even 50 genuine emails beat 500 passive followers. Offer exclusive content for signups.
- Collaborate with same-sized artists for cross-promotion.
- Release singles every 5-6 weeks to keep triggering algorithmic discovery.

NEVER SUGGEST THESE (they require an audience that doesn't exist yet):
- "Host a live session" — nobody will join
- "Repost fan content" — there are no fans making content
- "Run a giveaway" — attracts freebie-hunters, not fans
- "DM big influencers" — they won't respond to unknowns
- Paid ads — never spend money before proving organic interest
- "Engage with your community" — there is no community yet
- Any tactic that assumes people are already listening`,

    small: `AUDIENCE TIER: SMALL (500-5,000 followers)
This artist has a small but real audience. Strategy splits between GROWING and ACTIVATING.

WHAT WORKS AT 500-5K:
- This is the micro-influencer sweet spot. Small accounts get 5-10% engagement (vs 1-2% for bigger ones). Lean into high engagement — algorithms love it.
- Fan-focused content: Feature fan reactions, covers, or stories. Make existing listeners feel invested.
- Behind-the-scenes with a REAL angle: Show a specific creative decision, a moment of doubt, a breakthrough. The story matters, not just footage of a studio.
- Playlist pitching becomes viable: Use SubmitHub, Musosoup, or direct outreach to independent curators.
- Community building: Create a small group chat (Discord, WhatsApp) for the most engaged followers. Even 50 active members create a launchpad.
- Strategic duets/stitches with creators slightly bigger (5K-20K range).

AVOID:
- Big influencer campaigns — terrible ROI at this level
- Trying to look bigger than they are — audiences detect inauthenticity instantly`,

    growing: `AUDIENCE TIER: GROWING (5,000-25,000 followers)
This artist has real momentum. Focus on CONVERTING followers into superfans and triggering algorithmic amplification.

WHAT WORKS AT 5K-25K:
- First 48 hours of a Spotify release are everything. High-quality engagement (saves, playlist adds, repeat plays) in this window triggers the algorithm to push wider.
- Drive short-form video audience to streaming at release — 47% of music discovery starts on TikTok/Reels.
- Test paid amplification: Only AFTER proving organic engagement. Boost best-performing organic content.
- World-building campaigns: Mystery countdowns, hidden clues, password-protected early access.
- Episodic content series building narrative tension toward release.
- Seed the track to 10-20 niche creators simultaneously for a coordinated push.
- Editorial playlist pitching through Spotify for Artists becomes high-priority.

AVOID:
- Relying only on organic reach — strategic amplification is needed now
- One-and-done promo pushes — sustained 4-week campaigns outperform release-day spikes`,

    established: `AUDIENCE TIER: ESTABLISHED (25,000+ followers)
This artist has a real fanbase. Focus on DEEPENING loyalty, reaching new audiences through existing fans, and leveraging scale.

WHAT WORKS AT 25K+:
- Superfan development: Identify and reward the top 1-5% most engaged fans with exclusive access. These fans drive 80% of organic promotion.
- Human curator outreach: Editorial playlist curators and blogs will actually listen at this level. Pitch with originality, story, emotional impact.
- Cross-genre collaboration to reach entirely new audiences.
- IRL activations: Pop-up listening parties, local shows create content AND deepen loyalty.
- Press and sync licensing become realistic targets.
- Fan-generated content campaigns: Amplify what fans are already making.
- Multi-platform coordinated rollout.

AVOID:
- Losing accessibility — fans chose this artist because they feel close to them
- Ignoring community in favor of scale`
  };

  return tiers[audienceSize] || tiers.small;
}

// ── TRACK ANALYSIS ──
export async function analyzeTrack(track, audioFeatures = null, trends = null) {
  const noSocial = track.no_social === '1' || track.no_social === 1;
  const audienceSize = track.audience_size || 'small';

  const systemPrompt = `You are an elite music marketer who has built real campaigns for independent artists. You think like a content creator who actually gets views, not like a marketing textbook. Always respond in English. Respond ONLY with valid JSON.

YOUR PROCESS (follow this exact order):
1. LYRICS FIRST: If lyrics are provided, read every line before doing anything else. Understand slang, double meanings, cultural references. The lyrics define the song — the title alone means nothing without them.
2. SONIC IDENTITY: Combine lyrical themes with audio energy (BPM, energy, mood) to define the song's world — what real-life moment does it soundtrack?
3. SUBCULTURE MATCH: Who lives in that world? Not "18-28 hip-hop fans" — specific subcultures. What do they watch, share, meme about, and wear?
4. CONTENT FROM TRUTH: Every suggestion must come from a specific lyric line, sonic moment, or emotional theme. If you can swap in a different song and the idea still works, it's garbage — rewrite it.

WHAT MAKES CONTENT ACTUALLY VIRAL (not theory — real mechanics):
- TikTok/Reels algorithm ranks by: completion rate > rewatches > shares > likes. Design for 70%+ completion.
- Optimal video length: 7-15 seconds for highest completion rates.
- The hook (first 2 seconds) is non-negotiable — if they don't stop scrolling, nothing else matters.
- 80% entertainment, 20% promotion. If it feels like an ad, it fails.
- Content that's remixable (fans can put their own spin on it) spreads further.
- Rewatchability matters heavily now — content people want to watch twice gets pushed harder.

WHAT MAKES CONTENT CRINGE (never do these):
- Forced, uncomfortable on-camera performance when the artist clearly isn't natural on camera
- "New heat dropping 🔥🔥🔥" energy in captions — nobody talks like this
- Over-produced promo that looks like an ad instead of organic content
- Copying trends that don't match the song's energy or the artist's personality
- Any suggestion that makes the artist look like they're trying too hard

${noSocial ? 'THE ARTIST DOES NOT WANT SOCIAL MEDIA CONTENT. Replace video_edits with playlist/blog/press strategies. Replace diy_content_ideas with offline tactics (sync licensing, live shows, radio, press, collaborations, playlist outreach).' : ''}

HARD BANNED (any of these = entire response is invalid):
- "POV when the song hits different" or any variation
- Hand sign challenges or tutorials
- Loyalty test videos
- Generic dance challenges not specific to this song's rhythm
- "Use this sound" without the exact visual concept
- Behind-the-scenes studio clips without a unique story angle
- Any caption with "🔥🔥🔥 new heat" energy
- Any idea where you swap the song title and it still makes perfect sense
- "Post consistently" or "engage with your audience" as advice

JSON structure:
{
  "tempo_bpm": <number>,
  "tempo_description": "<what the tempo FEELS like — walking pace? head-nod? driving fast? late-night slow burn?>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "energy_percent": <1-100>,
  "energy_description": "<what the energy feels like physically — chest-heavy? floaty? aggressive? melancholy warmth?>",
  "genre_fit": "<specific subgenre, not just 'hip-hop' or 'pop'>",
  "lyric_themes": {
    "core_story": "<2-3 sentences: what is this song actually about? Who is talking, to whom, about what?>",
    "quotable_lines": ["<exact lyric line that works as a caption>", "<another>", "<another>"],
    "emotional_core": "<the one universal feeling — what makes listeners think 'this is so me'>",
    "visual_world": "<colors, settings, time of day, textures that match lyrics + sound>"
  },
  "audience_age": "<age range>",
  "audience_interests": "<2-3 SPECIFIC subcultures/communities, not just demographics>",
  "audience_platforms": "<platforms ranked by priority for this audience>",
  "audience_content_angle": "<what content this audience actually watches and shares>",
  "audience_key_insight": "<one counterintuitive insight about reaching this audience that most artists miss>",
  "reference_artists": [
    {"name": "<artist>", "genre": "<genre>", "description": "<specific reason this reference is useful — what marketing tactic or audience overlap to learn from>"},
    {"name": "<artist>", "genre": "<genre>", "description": "<reason>"},
    {"name": "<lesser-known artist under 100K listeners>", "genre": "<genre>", "description": "<what they do differently that works>"},
    {"name": "<artist>", "genre": "<genre>", "description": "<reason>"}
  ],
  "video_edits": [
    {
      "title": "<descriptive title>",
      "caption": "<caption that sounds like a real person — tweet energy, not ad copy. If lyrics exist, reference or paraphrase a key line>",
      "hashtags": "<2-3 niche tags under 1M posts + 1-2 discovery tags — tags the target subculture actually uses>",
      "duration": "<7-15 sec for max completion>",
      "timestamp": "<specific part of the song to use — reference a peak moment if audio data available>",
      "platforms": ["TikTok", "Reels"],
      "concept": "<FULL creative brief: second-by-second what happens. First 2 sec = the hook (what stops scrolling). Middle = the payoff or tension. End = the share trigger. Include camera angle, lighting, edit style — 'cinematic' is not a direction, 'handheld warm tungsten slow push-in with grain' IS>",
      "song_moment": "<which specific lyric line, beat drop, or energy shift this video is built around>",
      "share_trigger": "<specific reason someone sends this to a friend>"
    },
    {"title":"","caption":"","hashtags":"","duration":"","timestamp":"","platforms":["TikTok","Reels"],"concept":"","song_moment":"","share_trigger":""}
  ],
  "diy_content_ideas": [
    {
      "title": "<name>",
      "difficulty": "Easy|Medium|Hard",
      "duration": "<length>",
      "virality": <1-100>,
      "description": "<FULL creative brief: exactly what to film, how to edit, what the viewer experiences. Include the hook (first thing viewer sees), the payoff, and why it's shareable. Reference a specific lyric theme or sonic element this idea is built from>",
      "howTo": ["<step 1 — specific and actionable>", "<step 2>", "<step 3>"],
      "hashtags": "<niche + broad mix>",
      "why_it_works": "<what psychological trigger — relatability, curiosity, emotion, humor?>"
    },
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":""},
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":""},
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":""}
  ],
  "pro_tip": "<one specific production tip for THIS song's visual style — lighting setup, camera technique, edit effect, color grade. Not generic>",
  "creator_tip": "<one specific growth tactic matched to this artist's audience tier — not 'post consistently'>",
  "viral_advice": "<2-3 sentences of specific advice for this artist at their current audience level — what should they focus on RIGHT NOW>",
  "viral_keys": {
    "hook": "<specific hook for THIS song — reference a lyric or sonic moment, describe the exact first 1-2 seconds>",
    "relatability": "<what universal experience from the lyrics will the audience recognize as their own life?>",
    "share_trigger": "<specific reason someone sends this to a friend — 'this is us' / 'this happened to me' / 'you need to hear this line'>"
  }
}`;

  const tierPrompt = getAudienceTierPrompt(audienceSize);

  const userPrompt = `Analyze this track and build a strategy this artist can actually execute:

Title: "${track.title}"
Artist: ${track.artist}
${track.genre ? `Genre: ${track.genre}` : ''}
${track.similar_artists ? `Similar artists: ${track.similar_artists}` : ''}
${track.main_goal ? `Goal: ${track.main_goal}` : ''}
${track.social_vibe ? `On-camera preference: ${track.social_vibe}. ALL visual content must respect this — if they said "no-face" or "minimal-face", never suggest talking-to-camera content.` : ''}
${track.target_region ? `Target region: ${track.target_region} — optimize hashtags, posting times, and cultural references for this market` : ''}
${track.want_tiktok_content && !noSocial ? 'Include TikTok/Reels/Shorts ideas.' : ''}
${noSocial ? 'NO social media. Focus on: playlists, blogs, sync licensing, live shows, radio, press, artist collabs.' : ''}

${tierPrompt}

${track.lyrics ? `
═══ LYRICS — THIS IS YOUR MOST IMPORTANT INPUT ═══
${track.lyrics}
═══ END LYRICS ═══

BEFORE writing ANY suggestion:
1. What is the core story? Who is talking, to whom, about what?
2. Find 3+ quotable lines that work as captions — relatable, hard-hitting, or emotionally raw
3. What LIFESTYLE do the lyrics describe? That lifestyle IS the content strategy
4. Note slang, cultural references, double meanings. The title's meaning comes ONLY from the lyrics
5. Every video concept and content idea MUST reference a specific lyric theme. If it doesn't connect to the lyrics, cut it` : 'No lyrics provided. Base strategy on genre, mood, energy, and similar artists. Mention that lyrics would significantly improve suggestions.'}

${audioFeatures?.analyzed ? `
AUDIO DATA (real values — use exactly):
BPM: ${audioFeatures.bpm} | Key: ${audioFeatures.key} | Energy: ${audioFeatures.energy}% | Danceability: ${audioFeatures.danceability}%
Duration: ${audioFeatures.duration}s
Peak moments: ${audioFeatures.peakMoments?.map(p => p.label).join(', ') || 'unknown'}
Use peak timestamps for video suggestions — these are the highest-energy, most viral-potential moments.` : 'No audio uploaded — estimate BPM/energy from genre. Mark as estimates.'}

${trends && trends.trends && trends.trends.length > 0 ? `CURRENT TRENDING FORMATS (adapt 1-2 to this song — don't force it):
${trends.trends.slice(0, 6).map(t => '- ' + t.name + ': ' + t.description).join('\n')}
Trending hashtags: ${(trends.trending_hashtags || []).join(', ')}` : ''}

FINAL SELF-CHECK:
For each suggestion: "If I swap '${track.title}' for a completely different song, does this idea still work?" If yes → rewrite it with specific references to this song's lyrics, sound, or themes.

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
      lyric_themes: JSON.stringify(result.lyric_themes || {}),
      audience_age: result.audience_age || '', audience_interests: result.audience_interests || '',
      audience_platforms: result.audience_platforms || '', audience_content_angle: result.audience_content_angle || '',
      audience_key_insight: result.audience_key_insight || '',
      reference_artists: JSON.stringify(result.reference_artists || []),
      video_edits: JSON.stringify(result.video_edits || []),
      diy_content_ideas: JSON.stringify(result.diy_content_ideas || []),
      pro_tip: result.pro_tip || '', creator_tip: result.creator_tip || '',
      viral_advice: result.viral_advice || '', viral_keys: JSON.stringify(result.viral_keys || {}),
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
  const lyricThemes = (() => { try { return JSON.parse(analysis.lyric_themes || '{}'); } catch(e) { return {}; } })();
  const noSocial = track.no_social === '1' || track.no_social === 1;
  const audienceSize = track.audience_size || 'small';
  const tierPrompt = getAudienceTierPrompt(audienceSize);

  const systemPrompt = `You are an elite music launch strategist who creates plans artists can follow day-by-day without googling anything. Always respond in English. Respond ONLY with valid JSON.

YOUR APPROACH:
1. Every task is a complete recipe — not "make a TikTok" but the exact concept, hook, visual direction, and caption ready to use.
2. Momentum arc: Week 1 plants seeds, Week 2 builds anticipation, Week 3 is the push, Week 4 sustains and converts.
3. Every task connects to the song's actual themes, lyrics, and emotional world.
4. Tasks are realistic for this artist's audience tier — don't suggest things that require an audience they don't have.

WHAT WORKS IN ${new Date().getFullYear()}:
- First 48 hours of a Spotify release determine algorithmic push
- 47% of music discovery starts on short-form video — video isn't optional
- Completion rate (70%+) and rewatches drive TikTok/Reels reach
- Micro-creators (1K-10K followers) convert 25% better than bigger influencers
- Organic proof first, paid amplification second

QUALITY RULES:
- Each day MUST have a DIFFERENT type of task — no repeating "post a clip" or "share lifestyle content"
- Name REAL playlists, REAL blogs, REAL platforms with actual names
- Pitch messages must be ready to copy-paste, written specifically for this song
- Meta Ads copy must capture the song's emotional core based on lyrics/themes
- Budget must include a specific dollar amount with reasoning
- For starting/small artists: maybe DON'T recommend ads — say "prove organic interest first"

HARD BANNED:
- Hand sign tutorials or challenges
- Generic dance challenges
- Repetitive "post luxury/lifestyle content" tasks
- "Post behind the scenes" without a unique story angle
- "Post a teaser" without describing exactly what the teaser shows
- "Engage with fans" without specifying exactly how and where
- Any task that works for any song — every task must reference this song's themes

JSON structure:
{
  "plan_title": "<creative title referencing the song's themes>",
  "plan_summary": "<2-3 sentences: what makes THIS plan different from a generic launch>",
  "target_audience": {
    "description": "<specific subculture, not demographics>",
    "best_platforms": ["<platform1>", "<platform2>", "<platform3>"],
    "best_posting_times": "<specific times with reasoning>",
    "content_style": "<visual/tonal direction matching the song's world>"
  },
  "weeks": [
    {
      "week_number": 1, "title": "<thematic>", "goal": "<specific, measurable>",
      "tasks": [
        {"day": "<day>", "task": "<name>", "platform": "<platform>", "details": "<COMPLETE creative brief: what to post, visual concept, caption, hashtags, timing. Artist should be able to execute immediately>"},
        {"day": "<day>", "task": "<>", "platform": "<>", "details": "<>"},
        {"day": "<day>", "task": "<>", "platform": "<>", "details": "<>"}
      ]
    },
    {"week_number": 2, "title": "", "goal": "", "tasks": [{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]},
    {"week_number": 3, "title": "", "goal": "", "tasks": [{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]},
    {"week_number": 4, "title": "", "goal": "", "tasks": [{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]}
  ],
  "playlist_strategy": {
    "approach": "<overall strategy tailored to audience tier>",
    "editorial_playlists": [{"name": "<real Spotify editorial playlist>", "why": "<why this song fits — reference mood, tempo, lyrical themes>", "follower_estimate": "<approx>"}],
    "independent_playlists": [{"name": "<real indie playlist>", "curator_contact": "<how to find/contact>", "why": "<reason>"}, {"name": "<>", "curator_contact": "<>", "why": "<>"}],
    "pitch_template": "<ready-to-send pitch that references this song's specific story, mood, and comps — NOT a generic template>",
    "pitch_tips": "<tips specific to this genre and tier>",
    "spotify_for_artists_pitch": "<exact text to paste, written for this song>"
  },
  "collaboration_ideas": [
    {"type": "<type>", "description": "<specific creator type/size, what the collab looks like, why it works for this song>", "expected_impact": "<realistic for this tier>"},
    {"type": "<>", "description": "<>", "expected_impact": "<>"}
  ],
  "budget_tips": {
    "free_tactics": ["<specific free tactic with execution details>", "<>", "<>"],
    "paid_options": [{"tactic": "<specific>", "estimated_cost": "<real cost>", "expected_result": "<realistic for tier>"}]
  },
  "meta_ads": {
    "campaign_objective": "<best objective for this song + tier>",
    "ad_copy_variations": [
      {"headline": "<captures the song's emotional core from lyrics>", "primary_text": "<speaks to target subculture using themes from the song>", "cta": "<>"},
      {"headline": "<different angle>", "primary_text": "<different angle>", "cta": "<>"}
    ],
    "targeting": {
      "age_range": "<>",
      "interests": ["<specific>", "<>", "<>", "<>"],
      "lookalike_suggestion": "<based on similar artists' audiences>",
      "excluded_audiences": "<who and why>"
    },
    "budget_recommendation": "<specific daily amount with reasoning — for starting artists consider 'don't spend yet, prove organic first'>",
    "ad_format": "<format with reasoning>",
    "creative_direction": "<specific visual direction matching the song's world>"
  },
  "key_metrics": ["<metric relevant to this tier>", "<>", "<>", "<>"],
  "common_mistakes": ["<mistake specific to this genre/tier>", "<>", "<>"]
}`;

  const userPrompt = `Create a 4-week launch plan. Every task must be specific enough to execute immediately.

Title: "${track.title}"
Artist: ${track.artist}
Genre: ${track.genre || analysis.genre_fit || 'Unknown'}
Similar artists: ${track.similar_artists || refs.map(r => r.name || r).join(', ') || 'Unknown'}
Goal: ${track.main_goal || 'Get the most streams possible'}
Mood: ${moods.join(', ') || 'Unknown'}
Energy: ${analysis.energy_percent || 50}%
BPM: ${analysis.tempo_bpm || 120}
Audience: ${analysis.audience_age || '18-28'}, ${analysis.audience_platforms || 'TikTok, Spotify'}
${track.target_region ? `Target region: ${track.target_region}` : ''}
${noSocial ? 'NO social media. Focus entirely on: playlists, blogs, sync licensing, live shows, radio, press, collaborations.' : ''}

${tierPrompt}

${lyricThemes.core_story ? `
THE SONG'S IDENTITY (from analysis):
Story: ${lyricThemes.core_story}
Emotional core: ${lyricThemes.emotional_core || ''}
Visual world: ${lyricThemes.visual_world || ''}
Quotable lines: ${(lyricThemes.quotable_lines || []).join(' | ')}

Every task, ad copy, and pitch must connect to these themes.` : ''}

${track.lyrics ? `
FULL LYRICS (use for ad copy, captions, pitch messages):
${track.lyrics}` : ''}

SELF-CHECK: For every task — "could any artist use this for any song?" If yes, rewrite with specific references to this song.

Respond ONLY with JSON.`;

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
    tempo_bpm: 124, tempo_description: 'Head-nod pace — walking tempo with weight',
    mood_tags: JSON.stringify(['Melancholic', 'Dreamy', 'Reflective']),
    energy_percent: 72, energy_description: 'Builds like pressure behind the chest — heavy but controlled',
    genre_fit: 'Alt-pop / indie electronic', audience_age: '18-28',
    lyric_themes: JSON.stringify({}),
    audience_interests: 'indie pop, lo-fi aesthetics, late-night playlist communities',
    audience_platforms: 'TikTok, Instagram Reels, Spotify',
    audience_content_angle: 'mood-based visuals + relatable lyric moments',
    audience_key_insight: msg || 'Fallback data.',
    reference_artists: JSON.stringify([
      { name: 'Girl in Red', genre: 'Indie pop', description: 'Built fanbase through raw vulnerability — her early TikToks felt like voice memos, not promo' },
      { name: 'Clairo', genre: 'Bedroom pop', description: 'Proved you don\'t need a label budget to build a visual world — DIY aesthetic became the brand' },
      { name: 'Conan Gray', genre: 'Pop', description: 'Turns personal stories into shareable moments — study how his lyrics become fan captions' },
      { name: 'beabadoobee', genre: 'Indie rock', description: 'Leveraged one TikTok moment into a touring career — shows how to convert viral attention into real fans' },
    ]),
    video_edits: JSON.stringify([
      { title: 'Lyric Highlight', caption: 'Upload a track with lyrics for personalized suggestions', hashtags: '#lyrics #indiemusic', duration: '0:15', timestamp: '0:45-1:00', platforms: ['TikTok','Reels'] },
    ]),
    diy_content_ideas: JSON.stringify([
      { title: 'Fallback', difficulty: 'Easy', duration: '30 sec', virality: 50, description: 'Upload a track with lyrics and audio for personalized, song-specific content ideas.', howTo: ['Upload a track','Add lyrics','Get real suggestions'], hashtags: '#music' },
    ]),
    pro_tip: 'Use warm low-angle lighting (a desk lamp on the floor works) for a moody, cinematic feel that matches introspective music.',
    creator_tip: 'Fallback data — analyze a real track for audience-specific growth tactics.',
    viral_advice: '', viral_keys: JSON.stringify({}),
    model_used: 'fallback', audio_key: null, audio_danceability: null, audio_analyzed: false,
    status: 'completed', completed_at: new Date().toISOString(),
  };
}
