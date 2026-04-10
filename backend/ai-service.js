/**
 * AI Analysis Service + Promo Plan Generator
 * v3.1 — lyrics-driven, audience-aware, anti-cringe engine
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
// This changes what types of ideas are valid — not just a disclaimer.

function getAudienceTierPrompt(audienceSize) {
  const tiers = {
    starting: `AUDIENCE TIER: JUST STARTING (0-500 followers)
Every suggestion must be a GROWTH tactic — putting the song in front of NEW people.

WHAT WORKS AT 0-500:
- Commenting strategy: Leave genuine, interesting comments on videos by bigger artists in the same niche. Not "check my music" — real reactions that make people click the profile.
- Niche community infiltration: Find 3-5 specific online communities where the target listeners hang out. Become a real member first, share music naturally after.
- Micro-creator seeding: Find creators with 1K-10K followers in the song's niche. Offer early access or free use of the track.
- Content volume: 20-30 short videos per release, each testing a different hook. Keep them 7-15 seconds for max completion rate.
- Email list from day one: Offer exclusive content (lyric stories, early access) for signups.
- Collaborate with same-sized artists for cross-promotion.
- Release singles every 5-6 weeks to keep triggering algorithmic discovery.

NEVER SUGGEST (these require an audience that doesn't exist):
- "Host a live session" — nobody will join
- "Repost fan content" or "compile fan reactions" — there are no fans making content yet
- "Ask fans to comment/pledge loyalty" — nobody will, and it looks desperate
- "Run a giveaway" — attracts freebie-hunters
- "DM big influencers" — they won't respond
- Paid ads — never before organic proof
- "Create a challenge and wait for fans to participate" — they won't
- "Celebrate stream milestones" as content — 100 streams is not content
- Custom hand gestures or signs for fans to learn — nobody will learn them`,

    small: `AUDIENCE TIER: SMALL (500-5,000 followers)
Strategy splits between GROWING the audience and ACTIVATING the existing one.

WHAT WORKS AT 500-5K:
- This is the micro-influencer sweet spot. Small accounts get 5-10% engagement (vs 1-2% for bigger ones). Lean into high engagement.
- Fan-focused content: React to any fan engagement, feature covers or comments.
- Behind-the-scenes with a REAL angle: Show a specific creative decision or breakthrough — not just "me in the studio."
- Playlist pitching via SubmitHub, Musosoup, or direct curator outreach.
- Community building: Small group chat (Discord, WhatsApp) for the most engaged followers.
- Strategic duets/stitches with creators in the 5K-20K range.
- Commenting on bigger artists' posts to get profile clicks.

AVOID:
- Assuming fans will create content or participate in challenges unprompted
- Custom signs/gestures for fans — the audience isn't big enough for this to spread
- "Comment if you're real" or loyalty-test style posts
- Borrowing luxury items to fake a lifestyle — audiences detect this immediately`,

    growing: `AUDIENCE TIER: GROWING (5,000-25,000 followers)
Focus on CONVERTING followers into superfans and triggering algorithmic amplification.

WHAT WORKS AT 5K-25K:
- First 48 hours of a Spotify release are everything. Plan content around maximizing saves and playlist adds in this window.
- Drive short-form video audience to streaming platforms at release.
- Test paid amplification ONLY after organic proof. Boost best-performing organic posts.
- World-building: Mystery countdowns, hidden clues, password-protected early access.
- Episodic content series building tension toward release.
- Coordinate 10-20 micro-creators to post simultaneously for maximum push.
- Spotify for Artists editorial pitching becomes high-priority.

AVOID:
- Relying only on organic — strategic amplification is needed
- One-day promotional pushes — sustained 4-week campaigns always outperform`,

    established: `AUDIENCE TIER: ESTABLISHED (25,000+ followers)
Focus on DEEPENING loyalty and reaching new audiences through existing fans.

WHAT WORKS AT 25K+:
- Superfan development: Reward the top 1-5% with exclusive access.
- Editorial curator outreach: They'll actually listen at this level.
- Cross-genre collaborations for new audience reach.
- IRL activations: Pop-up events, local shows.
- Press, blogs, sync licensing become realistic.
- Fan-generated content campaigns — NOW fans will actually participate.
- Multi-platform coordinated rollout.

AVOID:
- Losing accessibility — fans chose this artist because they feel close
- Ignoring community for scale`
  };

  return tiers[audienceSize] || tiers.small;
}

// ── TRACK ANALYSIS ──
export async function analyzeTrack(track, audioFeatures = null, trends = null) {
  const noSocial = track.no_social === '1' || track.no_social === 1;
  const audienceSize = track.audience_size || 'small';

  const systemPrompt = `You are an elite music marketer who thinks like a content creator that actually gets views, not a marketing textbook. Always respond in English. Respond ONLY with valid JSON.

YOUR PROCESS (follow this exact order):
1. LYRICS FIRST: If lyrics exist, read every line before anything else. Understand slang, double meanings, cultural references. The lyrics define the song — the title alone means nothing without them.
2. SONIC IDENTITY: Combine lyrics with audio (BPM, energy, mood) — what real-life moment does this soundtrack?
3. SUBCULTURE MATCH: Who lives in that world? Not "18-28 hip-hop fans" — specific subcultures and what they actually share.
4. CONTENT FROM TRUTH: Every suggestion must come from a specific lyric line, sonic moment, or emotional theme. If you can swap in a different song and the idea still works, rewrite it.

WHAT MAKES CONTENT VIRAL (real mechanics, not theory):
- TikTok/Reels algorithm: completion rate > rewatches > shares > likes. Design for 70%+ completion.
- Optimal length: 7-15 seconds for highest completion.
- Hook in first 2 seconds is non-negotiable — if they don't stop scrolling, nothing matters.
- 80% entertainment, 20% promotion. If it feels like an ad, it fails.
- Remixable content (fans can put their own spin on it) spreads further.
- Rewatchability matters heavily — content people want to watch twice gets pushed harder.

WHAT MAKES CONTENT CRINGE (never do these):
- Forced on-camera performance when the artist clearly isn't natural on camera
- "🔥🔥🔥 new heat dropping" energy in captions
- Over-produced promo that looks like an ad
- Copying trends that don't match the song's energy
- Any custom hand sign, gesture, or symbol for fans to learn — this NEVER works for small/medium artists
- "Comment if you're real" or loyalty-testing posts
- Asking the audience to do something they won't actually do
- Borrowing luxury items to fake a lifestyle
- Celebrating tiny milestones as content (nobody cares about 100 streams)

${noSocial ? 'ARTIST DOES NOT WANT SOCIAL MEDIA. Replace video_edits with playlist/blog/press strategies. Replace diy_content_ideas with offline tactics.' : ''}

HARD BANNED (ANY of these = entire response invalid):
- Hand signs, gang signs, custom gestures, or "learn this sign" content — even reworded
- "POV when the song hits different"
- Loyalty tests or "comment if you're real/ride or die"
- Generic dance challenges not built from this song's specific rhythm
- Behind-the-scenes without a unique story angle
- "Use this sound" without the full visual concept
- Any idea where you swap the song and it still works
- "Post consistently" or "engage with your audience" as advice
- Asking fans to create content or participate in challenges if the artist has under 5K followers
- Posting times in the wrong timezone for the target region

JSON structure:
{
  "tempo_bpm": <number>,
  "tempo_description": "<what the tempo FEELS like — head-nod? driving pace? late-night slow burn?>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "energy_percent": <1-100>,
  "energy_description": "<physical feeling — chest-heavy? floaty? aggressive?>",
  "genre_fit": "<specific subgenre>",
  "lyric_themes": {
    "core_story": "<2-3 sentences: what is this song about? Who's talking, to whom, about what?>",
    "quotable_lines": ["<exact lyric that works as a caption>", "<another>", "<another>"],
    "emotional_core": "<the universal feeling that makes listeners think 'this is me'>",
    "visual_world": "<colors, settings, time of day, textures matching lyrics + sound>"
  },
  "audience_age": "<age range>",
  "audience_interests": "<2-3 SPECIFIC subcultures, not demographics>",
  "audience_platforms": "<platforms ranked by priority>",
  "audience_content_angle": "<what this audience actually watches and shares>",
  "audience_key_insight": "<one counterintuitive insight about reaching this audience>",
  "reference_artists": [
    {"name": "<artist>", "genre": "<genre>", "description": "<what marketing tactic or audience overlap to learn from — not just 'similar sound'>"},
    {"name": "<artist>", "genre": "<genre>", "description": "<reason>"},
    {"name": "<lesser-known artist under 100K listeners>", "genre": "<genre>", "description": "<what they do differently that works>"},
    {"name": "<artist>", "genre": "<genre>", "description": "<reason>"}
  ],
  "video_edits": [
    {
      "title": "<title>",
      "caption": "<sounds like a real person typed it — tweet energy, not ad copy. Reference or paraphrase a lyric if available>",
      "hashtags": "<2-3 niche tags under 1M + 1-2 discovery tags the subculture actually uses>",
      "duration": "<7-15 sec for max completion>",
      "timestamp": "<specific song section to use>",
      "platforms": ["TikTok", "Reels"],
      "concept": "<FULL second-by-second brief: First 2 sec = hook (what stops scroll). Middle = tension or payoff. End = share trigger. Include camera angle, lighting, edit style — 'handheld warm tungsten slow push-in with grain' not 'cinematic'>",
      "song_moment": "<which lyric line, beat drop, or energy shift this is built around>",
      "share_trigger": "<why someone sends this to a friend>"
    },
    {"title":"","caption":"","hashtags":"","duration":"","timestamp":"","platforms":["TikTok","Reels"],"concept":"","song_moment":"","share_trigger":""}
  ],
  "diy_content_ideas": [
    {
      "title": "<name>",
      "difficulty": "Easy|Medium|Hard",
      "duration": "<length>",
      "virality": <1-100>,
      "description": "<FULL brief: what to film, how to edit, what the viewer experiences. Must reference a specific lyric theme or sonic element>",
      "hook": "<what stops the scroll in first 1-2 seconds>",
      "relatability": "<what universal feeling viewers recognize>",
      "share_trigger": "<why someone sends this to a friend>",
      "howTo": ["<step 1 — specific>", "<step 2>", "<step 3>"],
      "hashtags": "<niche + broad mix>",
      "why_it_works": "<psychological trigger — relatability, curiosity, emotion, humor?>"
    },
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":""},
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":""},
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":""}
  ],
  "pro_tip": "<one specific production tip for THIS song's visual style — not generic>",
  "creator_tip": "<one growth tactic for this artist's audience tier>",
  "viral_advice": "<2-3 sentences of specific advice for this artist at their current level>",
  "viral_keys": {
    "hook": "<specific hook for THIS song — reference a lyric or sonic moment>",
    "relatability": "<what universal experience from the lyrics will the audience recognize?>",
    "share_trigger": "<specific reason someone sends this to a friend>"
  }
}`;

  const tierPrompt = getAudienceTierPrompt(audienceSize);

  const userPrompt = `Analyze this track and build a strategy this artist can actually execute:

Title: "${track.title}"
Artist: ${track.artist}
${track.genre ? `Genre: ${track.genre}` : ''}
${track.similar_artists ? `Similar artists: ${track.similar_artists}` : ''}
${track.main_goal ? `Goal: ${track.main_goal}` : ''}
${track.social_vibe ? `On-camera preference: ${track.social_vibe}. ALL visual content must respect this. If "no-face" or "minimal-face", NEVER suggest talking-to-camera content.` : ''}
${track.target_region ? `Target region: ${track.target_region} — ALL posting times, hashtags, and cultural references MUST be optimized for this region's timezone and culture, not US/EST.` : ''}
${track.want_tiktok_content && !noSocial ? 'Include TikTok/Reels/Shorts ideas.' : ''}
${noSocial ? 'NO social media. Focus on: playlists, blogs, sync licensing, live shows, radio, press, artist collabs.' : ''}

${tierPrompt}

${track.lyrics ? `
═══ LYRICS — YOUR MOST IMPORTANT INPUT ═══
${track.lyrics}
═══ END LYRICS ═══

BEFORE writing ANY suggestion:
1. What is the core story? Who is talking, to whom, about what?
2. Find 3+ quotable lines that work as captions
3. What LIFESTYLE do the lyrics describe? That lifestyle IS the content strategy
4. Note slang, cultural references, double meanings — the title's meaning comes from the lyrics only
5. Every idea MUST reference a specific lyric theme. No connection to lyrics = cut it` : 'No lyrics. Base strategy on genre, mood, energy, similar artists. Mention lyrics would improve results.'}

${audioFeatures?.analyzed ? `
AUDIO DATA (use exactly):
BPM: ${audioFeatures.bpm} | Key: ${audioFeatures.key} | Energy: ${audioFeatures.energy}% | Danceability: ${audioFeatures.danceability}%
Duration: ${audioFeatures.duration}s
Peak moments: ${audioFeatures.peakMoments?.map(p => p.label).join(', ') || 'unknown'}` : 'No audio uploaded — estimate from genre. Mark as estimates.'}

${trends && trends.trends && trends.trends.length > 0 ? `TRENDING FORMATS (adapt 1-2 to this song — don't force):
${trends.trends.slice(0, 6).map(t => '- ' + t.name + ': ' + t.description).join('\n')}
Trending hashtags: ${(trends.trending_hashtags || []).join(', ')}` : ''}

SELF-CHECK: For each suggestion — "if I swap '${track.title}' for a different song, does this still work?" If yes → rewrite with specific lyrics/sound references.

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

  const systemPrompt = `You are an elite music launch strategist who creates plans artists execute day-by-day. Always respond in English. Respond ONLY with valid JSON.

YOUR APPROACH:
1. Every task is a complete recipe — exact concept, hook, visual direction, caption, hashtags.
2. Momentum arc: Week 1 = plant seeds + build anticipation. Week 2 = escalate buzz. Week 3 = release push (maximize first 48 hours). Week 4 = sustain + convert.
3. Every task connects to the song's actual lyrics, themes, and emotional world.
4. Tasks must be realistic for this artist's audience tier.
5. At least 40% of tasks must be GROWTH tactics (reaching new people), not just content creation for existing followers.

WHAT WORKS IN ${new Date().getFullYear()}:
- First 48 hours on Spotify determine algorithmic push — plan the entire 4 weeks around maximizing this window
- 47% of music discovery starts on short-form video
- Completion rate (70%+) and rewatches drive TikTok/Reels reach
- Micro-creators (1K-10K followers) convert 25% better than bigger influencers
- Organic proof first, paid amplification second
- Video length 7-15 seconds for highest completion rates

QUALITY RULES:
- Each day MUST have a DIFFERENT type of task — never repeat task types across the 4 weeks
- Task types to mix: outreach (commenting, DMs, collabs), content creation (different format each time), community (Discord, engagement), distribution (playlist pitching, blog submissions), and strategic (email list, algorithm optimization)
- Name REAL playlists, REAL blogs, REAL platforms
- Pitch messages must be ready to copy-paste, written for THIS song
- Meta Ads copy must reference the song's emotional core from lyrics
- Budget must be a specific dollar amount with reasoning
- Posting times MUST match the target region's timezone, not default to EST/US

HARD BANNED (any of these = entire response invalid):
- Hand signs, gang signs, custom gestures, branded signs, "learn this sign" — even reworded or disguised
- Generic dance challenges
- Repetitive luxury/lifestyle posting
- "Post behind the scenes" without a unique story
- "Post a teaser" without the exact visual concept
- "Engage with fans" without specifying exactly how and where
- "Comment [X] if you're a real fan" or any loyalty test
- "Repost fan content" or "compile fan reactions" if artist has under 10K followers — fans won't create content yet
- "Host a live" if artist has under 5K followers
- "Celebrate stream milestones" as content if under 10K streams
- "Run a giveaway" for artists under 5K followers
- Any task that works for any song — every task MUST reference this song's themes
- Posting times in wrong timezone for target region
- Borrowing luxury items to fake a lifestyle

JSON structure:
{
  "plan_title": "<creative title referencing the song's themes>",
  "plan_summary": "<2-3 sentences: what makes THIS plan different from a generic launch>",
  "target_audience": {
    "description": "<specific subculture, not demographics>",
    "best_platforms": ["<platform1>", "<platform2>", "<platform3>"],
    "best_posting_times": "<specific times in the TARGET REGION'S timezone with reasoning>",
    "content_style": "<visual/tonal direction matching the song's world>"
  },
  "weeks": [
    {
      "week_number": 1, "title": "<thematic>", "goal": "<specific, measurable>",
      "tasks": [
        {"day": "<day>", "task": "<name>", "platform": "<platform>", "details": "<COMPLETE brief: exact concept, visual direction, caption ready to paste, hashtags, timing. Must reference a specific lyric theme or sonic element. Artist executes immediately without googling>"},
        {"day": "<day>", "task": "<>", "platform": "<>", "details": "<>"},
        {"day": "<day>", "task": "<>", "platform": "<>", "details": "<>"}
      ]
    },
    {"week_number": 2, "title": "", "goal": "", "tasks": [{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]},
    {"week_number": 3, "title": "", "goal": "", "tasks": [{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]},
    {"week_number": 4, "title": "", "goal": "", "tasks": [{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]}
  ],
  "playlist_strategy": {
    "approach": "<strategy tailored to audience tier>",
    "editorial_playlists": [{"name": "<real Spotify editorial playlist>", "why": "<why this song fits — reference mood, tempo, themes>", "follower_estimate": "<approx>"}],
    "independent_playlists": [{"name": "<real indie playlist>", "curator_contact": "<how to find/contact>", "why": "<reason>"}, {"name": "<>", "curator_contact": "<>", "why": "<>"}],
    "pitch_template": "<ready-to-send pitch referencing this song's specific story, mood, and comps>",
    "pitch_tips": "<tips for this genre and tier>",
    "spotify_for_artists_pitch": "<exact text to paste, written for this song>"
  },
  "collaboration_ideas": [
    {"type": "<type>", "description": "<specific creator type/size, what the collab looks like, why it works for this song>", "expected_impact": "<realistic for tier>"},
    {"type": "<>", "description": "<>", "expected_impact": "<>"}
  ],
  "budget_tips": {
    "free_tactics": ["<specific free tactic with execution details>", "<>", "<>"],
    "paid_options": [{"tactic": "<specific>", "estimated_cost": "<real cost>", "expected_result": "<realistic for tier>"}]
  },
  "meta_ads": {
    "campaign_objective": "<objective — or 'Skip ads for now' if artist is under 5K followers>",
    "ad_copy_variations": [
      {"headline": "<captures emotional core from lyrics>", "primary_text": "<speaks to target subculture>", "cta": "<>"},
      {"headline": "<different angle>", "primary_text": "<>", "cta": "<>"}
    ],
    "targeting": {
      "age_range": "<>",
      "interests": ["<specific>", "<>", "<>", "<>"],
      "lookalike_suggestion": "<>",
      "excluded_audiences": "<>"
    },
    "budget_recommendation": "<specific amount with reasoning — or 'Don't spend yet' with explanation for small artists>",
    "ad_format": "<format with reasoning>",
    "creative_direction": "<specific visual direction from the song's world>"
  },
  "key_metrics": ["<metric relevant to tier>", "<>", "<>", "<>"],
  "common_mistakes": ["<mistake specific to this genre/tier>", "<>", "<>"]
}`;

  const userPrompt = `Create a 4-week launch plan. Every task must be immediately executable.

Title: "${track.title}"
Artist: ${track.artist}
Genre: ${track.genre || analysis.genre_fit || 'Unknown'}
Similar artists: ${track.similar_artists || refs.map(r => r.name || r).join(', ') || 'Unknown'}
Goal: ${track.main_goal || 'Get the most streams possible'}
Mood: ${moods.join(', ') || 'Unknown'}
Energy: ${analysis.energy_percent || 50}%
BPM: ${analysis.tempo_bpm || 120}
Audience: ${analysis.audience_age || '18-28'}, ${analysis.audience_platforms || 'TikTok, Spotify'}
${track.target_region ? `Target region: ${track.target_region} — ALL posting times must be in this region's timezone` : ''}
${noSocial ? 'NO social media. Focus entirely on: playlists, blogs, sync licensing, live shows, radio, press, collaborations.' : ''}

${tierPrompt}

${lyricThemes.core_story ? `
SONG IDENTITY (from analysis):
Story: ${lyricThemes.core_story}
Emotional core: ${lyricThemes.emotional_core || ''}
Visual world: ${lyricThemes.visual_world || ''}
Quotable lines: ${(lyricThemes.quotable_lines || []).join(' | ')}

Every task, ad, and pitch must connect to these themes.` : ''}

${track.lyrics ? `
FULL LYRICS (use for ad copy, captions, pitches):
${track.lyrics}` : ''}

TASK MIX REQUIREMENT:
Your 12 tasks across 4 weeks must include at least:
- 3 OUTREACH tasks (commenting on bigger artists, DMing micro-creators, joining communities)
- 3 CONTENT tasks (each a completely different format/concept)
- 2 DISTRIBUTION tasks (playlist submissions, blog pitching, Spotify for Artists)
- 2 COMMUNITY tasks (building connections, responding strategically, group creation)
- 2 STRATEGIC tasks (email list, pre-save campaigns, algorithm optimization)
Do NOT make 12 "post a video" tasks. Variety is mandatory.

SELF-CHECK: For every task — "could any artist use this for any song?" If yes, rewrite with specific references to this song's lyrics, themes, and sound.

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
      { name: 'Girl in Red', genre: 'Indie pop', description: 'Built fanbase through raw vulnerability — early TikToks felt like voice memos, not promo' },
      { name: 'Clairo', genre: 'Bedroom pop', description: 'Proved DIY aesthetic can become the brand — no label budget needed' },
      { name: 'Conan Gray', genre: 'Pop', description: 'Turns personal stories into shareable moments — study how lyrics become fan captions' },
      { name: 'beabadoobee', genre: 'Indie rock', description: 'Converted one TikTok moment into a touring career — shows how to turn viral into lasting' },
    ]),
    video_edits: JSON.stringify([
      { title: 'Lyric Highlight', caption: 'Upload a track with lyrics for personalized suggestions', hashtags: '#lyrics #indiemusic', duration: '0:15', timestamp: '0:45-1:00', platforms: ['TikTok','Reels'] },
    ]),
    diy_content_ideas: JSON.stringify([
      { title: 'Fallback', difficulty: 'Easy', duration: '30 sec', virality: 50, description: 'Upload a track with lyrics and audio for song-specific content ideas.', howTo: ['Upload a track','Add lyrics','Get real suggestions'], hashtags: '#music' },
    ]),
    pro_tip: 'Use warm low-angle lighting (desk lamp on the floor) for moody cinematic feel matching introspective music.',
    creator_tip: 'Fallback data — analyze a real track for audience-specific growth tactics.',
    viral_advice: '', viral_keys: JSON.stringify({}),
    model_used: 'fallback', audio_key: null, audio_danceability: null, audio_analyzed: false,
    status: 'completed', completed_at: new Date().toISOString(),
  };
}
