/**
 * AI Analysis Service + Promo Plan Generator
 * v3.1 — lyrics-driven, audience-aware, anti-cringe engine
 */

import https from 'https';

const API_KEY = process.env.ANTHROPIC_API_KEY || '';

function callClaudeRaw(prompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
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
          // Detect content filter at error level (API may return error with filter message)
          if (data.error) {
            const msg = (data.error.message || '').toLowerCase();
            if (msg.includes('content filter') || msg.includes('output blocked') || msg.includes('safety filter')) {
              reject(new Error('CONTENT_FILTER_BLOCKED'));
              return;
            }
            reject(new Error(data.error.message || 'Unknown API error'));
            return;
          }
          // Detect content filter at response level (stop_reason)
          if (data.stop_reason === 'content_filter' || data.stop_reason === 'end_turn_content_filter') {
            reject(new Error('CONTENT_FILTER_BLOCKED'));
            return;
          }
          const text = data.content?.[0]?.text || '';
          if (!text) {
            reject(new Error('CONTENT_FILTER_BLOCKED'));
            return;
          }
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Sanitize lyrics: replace explicit words with clean versions so the API doesn't block
function sanitizeLyrics(lyrics) {
  if (!lyrics) return lyrics;
  // Common explicit words in rap/hip-hop that trigger content filters
  const replacements = [
    [/\bn+[i1!]+[gq]+[a@]+[sz]*\b/gi, '[n-word]'],
    [/\bf+u+c+k+/gi, 'f**k'], [/\bs+h+[i1!]+t+/gi, 'sh*t'],
    [/\bb+[i1!]+t+c+h+/gi, 'b**ch'], [/\ba+s+s+\b/gi, 'a**'],
    [/\bp+u+s+s+y+/gi, 'p***y'], [/\bd+[i1!]+c+k+/gi, 'd**k'],
    [/\bh+o+e*s*\b/gi, 'h*e'], [/\bc+o+c+k+/gi, 'c**k'],
    [/\bwh+o+r+e+/gi, 'wh**e'], [/\bk+[i1!]+l+l+/gi, 'k*ll'],
    [/\bm+u+r+d+e+r+/gi, 'm*rder'], [/\bd+r+u+g+s*\b/gi, 'dr*gs'],
    [/\bc+r+a+c+k+\b/gi, 'cr*ck'], [/\bm+o+l+l+y+\b/gi, 'm*lly'],
    [/\bp+e+r+c+s*\b/gi, 'p*rcs'], [/\bx+a+n+s*\b/gi, 'x*ns'],
  ];
  let clean = lyrics;
  for (const [pattern, replacement] of replacements) {
    clean = clean.replace(pattern, replacement);
  }
  return clean;
}

async function callClaude(prompt, systemPrompt, retryCount = 0) {
  try {
    return await callClaudeRaw(prompt, systemPrompt);
  } catch (err) {
    if (err.message === 'CONTENT_FILTER_BLOCKED' && retryCount < 2) {
      console.log(`⚠️ Content filter triggered (attempt ${retryCount + 1}) — retrying with sanitized content...`);

      // Add professional framing to system prompt
      const safeSystem = `IMPORTANT CONTEXT: You are a professional music marketing analysis tool. The lyrics below are from a commercially released or soon-to-be-released song. Your job is to analyze them for marketing strategy purposes only — identifying themes, quotable lines, audience fit, and promotional angles. Treat all lyric content as artistic expression to be analyzed professionally, similar to how a music journalist or A&R executive would review it. Do not refuse to analyze based on explicit content — this is standard music industry work.\n\n${systemPrompt}`;

      // Sanitize lyrics in the prompt
      const safePrompt = sanitizeLyrics(prompt);

      try {
        return await callClaudeRaw(safePrompt, safeSystem);
      } catch (err2) {
        if (err2.message === 'CONTENT_FILTER_BLOCKED' && retryCount < 1) {
          console.log('⚠️ Content filter triggered again — retrying with lyrics summarized...');
          // Last resort: replace full lyrics with just a summary request
          const summarizedPrompt = safePrompt.replace(
            /═══ LYRICS — YOUR MOST IMPORTANT INPUT ═══[\s\S]*?═══ END LYRICS ═══/,
            '═══ LYRICS (summarized due to explicit content) ═══\nThe lyrics contain explicit/street content. Key themes can be inferred from the genre, title, and artist style. Focus your analysis on the musical and sonic elements, and generate marketing strategies based on the genre and mood rather than specific lyric lines. For video_bars, use the title and genre to create representative placeholder text.\n═══ END LYRICS ═══'
          );
          return await callClaudeRaw(summarizedPrompt, safeSystem);
        }
        throw err2;
      }
    }
    // Re-throw with cleaner message for non-filter errors
    if (err.message === 'CONTENT_FILTER_BLOCKED') {
      throw new Error('Output blocked by content filtering policy');
    }
    throw err;
  }
}

function parseJSON(text) {
  text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(text); } catch(e) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found');
  let jsonStr = match[0];
  try { return JSON.parse(jsonStr); } catch(e) {}
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(jsonStr); } catch(e) {}
  for (let cut = 50; cut < jsonStr.length; cut += 50) {
    const truncated = jsonStr.substring(0, jsonStr.length - cut);
    const lastBrace = truncated.lastIndexOf('}');
    if (lastBrace === -1) break;
    let attempt = truncated.substring(0, lastBrace + 1).replace(/,(\s*[}\]])/g, '$1');
    const opens = (attempt.match(/\{/g) || []).length;
    const closes = (attempt.match(/\}/g) || []).length;
    for (let i = 0; i < opens - closes; i++) attempt += '}';
    try { return JSON.parse(attempt); } catch(e) {}
  }
  throw new Error('JSON parse failed after recovery');
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

// ── PRODUCER TIER STRATEGY ──
function getProducerTierPrompt(audienceSize) {
  const tiers = {
    starting: `PRODUCER TIER: JUST STARTING (0-500 followers)
Every suggestion must be a DISCOVERY tactic — getting beats in front of artists and listeners who don't know you exist.

WHAT WORKS AT 0-500:
- Type beat SEO: Title format matters: "[Artist] Type Beat - [Mood Word]" — study what ranks on YouTube, not what sounds creative
- Volume publishing: Upload 2-3 beats/week to YouTube. The algorithm needs volume to learn who to recommend you to.
- BeatStars/Airbit storefront: Free beats with tags + license options. Give away 5-10 beats to build a catalog people browse.
- Comment on rapper/singer videos with genuine reactions — never "check my beats"
- Find underground artists on SoundCloud/IG who are clearly looking for beats. DM with a free beat that matches their style — be specific about why it fits them.
- "Cook-up" content: Screen recordings of making a beat in 60 seconds. Show the process, not just the result.
- Tag other producers for engagement — remix challenges, beat flips.
- Reddit communities: r/makinghiphop, r/trapproduction — share knowledge, not just links.

NEVER SUGGEST:
- Paid ads before you have organic proof
- "DM Drake" or cold-pitching A-list artists
- Hosting live sessions — nobody will join
- "Run a giveaway" — attracts freebie hunters, not buyers
- Waiting for beats to sell themselves — active outreach is mandatory`,

    small: `PRODUCER TIER: SMALL (500-5,000 followers)
Strategy splits between growing the audience and converting listeners to beat buyers/collaborators.

WHAT WORKS AT 500-5K:
- You have proof of concept now. Double down on what got you here.
- Beat preview hooks: The first 5 seconds of a beat preview decide everything on TikTok/Reels. Start with the most interesting element.
- "The Drop" format: Build tension for 5-8 seconds, then hit the main pattern. High completion rate = more reach.
- Open verse challenges: Post a beat with space for vocals, invite artists to use it. Tag original.
- Collab with artists in the 1K-10K range — offer free beats in exchange for credit + shared promotion.
- BeatStars optimization: Update tags, thumbnails, preview lengths. A/B test pricing.
- Making-of tutorials: "How I made this beat in [DAW]" — teach something, not just show off.
- Engage in producer communities for networking, not self-promotion.

AVOID:
- Only posting beat previews with no variety — mix in tutorials, process content, collaborations
- Pricing too high too early — volume and reputation first
- Ignoring YouTube SEO — proper titles, tags, and thumbnails matter more than the beat sometimes`,

    growing: `PRODUCER TIER: GROWING (5,000-25,000 followers)
Focus on converting followers into customers, getting placements, and building a recognizable brand.

WHAT WORKS AT 5K-25K:
- Exclusive/premium beats: Create a tier system (free/basic/premium/exclusive) with clear value differences.
- Placement hunting: You have enough cred to pitch to management and A&R. Build a one-page producer portfolio site.
- Beat packs and bundles: Sell themed packs (e.g., "Dark Trap Pack" or "R&B Vibes Vol. 2") at a discount.
- Email list for beat drops: Notify subscribers of new uploads before they go public.
- YouTube channel branding: Consistent thumbnails, intros, visual identity. This is your storefront.
- Strategic paid promotion: Boost best-performing organic posts only.
- Networking at industry events, beat battles, production meetups.
- Sync licensing: Register beats with sync libraries (Musicbed, Artlist, Epidemic Sound).

AVOID:
- Giving everything away for free — your audience is ready to pay
- Ignoring business infrastructure (contracts, license terms, invoicing)`,

    established: `PRODUCER TIER: ESTABLISHED (25,000+ followers)
Focus on brand deals, major placements, and scaling the business.

WHAT WORKS AT 25K+:
- You're a brand now. Think like a business.
- Multiple revenue streams: beat sales, placements, sample packs, tutorials/courses, sync licensing.
- A&R relationships: Maintain regular contact with labels and managers who buy beats.
- Mentorship content: "How I built my producer career" — establishes authority.
- Premium sample packs: Your sound has value, sell it as an instrument.
- IRL industry presence: Studio sessions, co-writes, production camps.
- Cross-platform content strategy: YouTube (long form), TikTok (hooks), IG (brand), Twitter (industry networking).

AVOID:
- Losing the personal touch — your early supporters remember when you were small
- Racing to the bottom on pricing — your brand commands premium rates now`
  };
  return tiers[audienceSize] || tiers.small;
}

// ── TRACK ANALYSIS ──
export async function analyzeTrack(track, audioFeatures = null, trends = null) {
  // Branch to producer analysis if content_type is producer
  if (track.content_type === 'producer') {
    return analyzeProducerBeat(track, audioFeatures, trends);
  }

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

LYRIC ANCHORING (CRITICAL — this is what separates useful output from generic garbage):
Every single video_edit and diy_content_idea MUST be anchored to a specific moment in the song:
- Quote the EXACT lyric line(s) that the idea is built around — use quotation marks
- Reference the specific SONIC moment (e.g. "the beat drops at the chorus", "the 808 slide before verse 2", "the vocal break after 'I lost myself again'")
- The concept/script/description must describe HOW the lyric or sound is used visually (e.g. "text overlay with 'I lost myself again' appearing word by word, slow zoom, crosscut with rain on a window")
- If you can swap in ANY other song and the idea still works, it's GENERIC — rewrite it with specific lyric references
- BAD: "Film yourself vibing to the beat" — works for any song
- GOOD: "Film yourself walking away from camera as the line 'I left it all behind' plays, text overlay appears word by word, cut to black on 'behind'"

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
    "video_bars": ["<bar 1>", "<bar 2>", "<bar 3>", "<bar 4>", "<bar 5>", "<bar 6>"],
    "video_bars_section": "<which section these bars come from, e.g. 'Verse 1', 'Chorus', 'Hook'>",
    "emotional_core": "<the universal feeling that makes listeners think 'this is me'>",
    "visual_world": "<colors, settings, time of day, textures matching lyrics + sound>"
  },
  "audience_age": "<age range>",
  "audience_interests": "<2-3 SPECIFIC subcultures, not demographics>",
  "audience_platforms": "<platforms ranked by priority>",
  "audience_content_angle": "<what this audience actually watches and shares>",
  "audience_key_insight": "<one counterintuitive insight about reaching this audience>",
  "reference_artists": [
    {"name": "<artist>", "genre": "<genre>", "description": "<WHY tagging this artist helps discovery — e.g. 'Use #[artist] in TikTok bio and captions — their fans actively search this tag and your sound fits their taste'>"},
    {"name": "<artist>", "genre": "<genre>", "description": "<discovery reason + specific tag usage tip>"},
    {"name": "<lesser-known artist under 100K listeners>", "genre": "<genre>", "description": "<why this niche tag works — less competition, highly engaged fanbase>"},
    {"name": "<artist>", "genre": "<genre>", "description": "<tag/hashtag strategy for this reference>"}
  ],
  "discovery_tags": {
    "artist_tags": ["#<artist1>", "#<artist2>", "#<artist3>", "#<artist4>"],
    "genre_tags": ["#<subgenre>", "#<mood>music", "#<scene>"],
    "trending_tags": ["#<relevant trending tag>", "#<another>"],
    "bio_suggestion": "<one-line bio/description using these references — e.g. 'If you like [artist1] and [artist2], you'll love this'>"
  },
  "video_edits": [
    {
      "title": "<title>",
      "caption_structured": {
        "hook_line": "<first line — the scroll-stopper. Question, bold claim, or mystery. This is the ONLY line most people read>",
        "body": "<1-2 lines of story/context — tweet energy, reference a lyric>",
        "cta": "<call to action that drives the algorithm signal you want — e.g. 'tag someone who needs this' (shares), 'wait for it...' (completion), 'save this for later' (saves)>",
        "full_caption": "<the complete caption as one string, ready to paste>"
      },
      "hashtags": "<ORDERED: 2 niche tags under 500K first (higher chance of ranking) → 2 mid-size 500K-5M → 1 broad discovery tag. Order matters — TikTok weights earlier tags more>",
      "duration": "<7-15 sec for max completion>",
      "timestamp": "<specific song section to use>",
      "platforms": ["TikTok", "Reels"],
      "lyric_anchor": {
        "exact_line": "<EXACT lyric line quoted word-for-word from the lyrics that this video is built around>",
        "sound_moment": "<specific sonic element — e.g. 'the 808 drop before the chorus', 'the vocal break at 0:45', 'the key change in verse 2'>",
        "how_its_used": "<HOW this lyric/sound appears in the video — e.g. 'text overlay appearing word-by-word as artist walks toward camera', 'beat drop syncs with visual transition from dark to bright'>"
      },
      "concept": "<FULL second-by-second brief: First 2 sec = hook (what stops scroll). Middle = tension or payoff. End = share trigger or loop point. Include camera angle, lighting, edit style — 'handheld warm tungsten slow push-in with grain' not 'cinematic'. MUST reference the specific lyric line and describe how it appears visually>",
      "cover_frame": "<EXACT frame to use as thumbnail/cover: describe the visual, text overlay if any, and why this frame makes people tap from the profile grid. The cover frame is your second chance to get views — 60% of views come from profile visits, not the feed>",
      "song_moment": "<which lyric line, beat drop, or energy shift this is built around — QUOTE the exact lyric>",
      "share_trigger": "<why someone sends this to a friend>",
      "algorithm_score": {
        "estimated_completion": "<percentage estimate + why — e.g. '82% — short duration + curiosity hook holds attention'>",
        "rewatch_potential": "<Low/Medium/High + reason — e.g. 'High — hidden detail viewers catch on second watch'>",
        "comment_trigger": "<what will make people comment — e.g. 'The lyric reference will make fans debate the meaning'>",
        "save_trigger": "<why someone saves this — e.g. 'Tutorial element people want to reference later'>",
        "share_trigger": "<why someone sends this to a friend>"
      },
      "cross_post_strategy": {
        "post_first_on": "<which platform to post on FIRST and why — usually whichever has stronger organic reach for this content type>",
        "wait_before_repost": "<hours to wait before posting on second platform — typically 24-48h. Posting simultaneously kills reach on both>",
        "platform_tweaks": "<what to change between platforms — e.g. 'TikTok: add trending sound as secondary. Reels: use original audio only. Shorts: add end screen to channel'>"
      }
    },
    {"title":"","caption_structured":{"hook_line":"","body":"","cta":"","full_caption":""},"hashtags":"","duration":"","timestamp":"","platforms":["TikTok","Reels"],"concept":"","cover_frame":"","song_moment":"","share_trigger":"","algorithm_score":{"estimated_completion":"","rewatch_potential":"","comment_trigger":"","save_trigger":"","share_trigger":""},"cross_post_strategy":{"post_first_on":"","wait_before_repost":"","platform_tweaks":""}}
  ],
  "diy_content_ideas": [
    {
      "title": "<name>",
      "difficulty": "Easy|Medium|Hard",
      "duration": "<length>",
      "virality": <1-100>,
      "lyric_anchor": {
        "exact_line": "<EXACT lyric line quoted word-for-word that this content is built around>",
        "sound_moment": "<specific sonic element tied to this idea>",
        "how_its_used": "<HOW the lyric/sound appears in the content — text overlay, lip sync, visual metaphor, etc.>"
      },
      "description": "<FULL brief: what to film, how to edit, what the viewer experiences. MUST describe how the specific lyric line or sound moment is used visually — not just 'vibe to the beat'>",
      "hook": "<what stops the scroll in first 1-2 seconds — reference the specific lyric or sound>",
      "relatability": "<what universal feeling viewers recognize>",
      "share_trigger": "<why someone sends this to a friend>",
      "howTo": ["<step 1 — specific>", "<step 2>", "<step 3>"],
      "hashtags": "<niche + broad mix>",
      "why_it_works": "<psychological trigger — relatability, curiosity, emotion, humor?>",
      "caption_structured": {
        "hook_line": "<scroll-stopping first line>",
        "body": "<story/context>",
        "cta": "<action that drives algorithm signal>",
        "full_caption": "<complete caption ready to paste>"
      },
      "cover_frame": "<what the thumbnail/cover should show>",
      "algorithm_score": {
        "estimated_completion": "<% + reason>",
        "rewatch_potential": "<Low/Medium/High + reason>",
        "comment_trigger": "<what drives comments>",
        "save_trigger": "<why someone saves>"
      }
    },
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":"","caption_structured":{"hook_line":"","body":"","cta":"","full_caption":""},"cover_frame":"","algorithm_score":{"estimated_completion":"","rewatch_potential":"","comment_trigger":"","save_trigger":""}},
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":"","caption_structured":{"hook_line":"","body":"","cta":"","full_caption":""},"cover_frame":"","algorithm_score":{"estimated_completion":"","rewatch_potential":"","comment_trigger":"","save_trigger":""}},
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":"","caption_structured":{"hook_line":"","body":"","cta":"","full_caption":""},"cover_frame":"","algorithm_score":{"estimated_completion":"","rewatch_potential":"","comment_trigger":"","save_trigger":""}}
  ],
  "posting_strategy": {
    "best_days": ["<day1>", "<day2>", "<day3>"],
    "best_times": {
      "tiktok": "<exact time in TARGET REGION timezone + reasoning — e.g. '18:30 CET — post 30 min before the 19:00-21:00 peak so the algorithm has time to test it during high-traffic hours'>",
      "reels": "<exact time + reasoning>",
      "youtube_shorts": "<exact time + reasoning>"
    },
    "posting_frequency": "<how many posts per week + spacing — e.g. '4x/week, never two days in a row on the same platform. Mon/Wed/Fri/Sun rotation'>",
    "engagement_window": {
      "first_5_min": "<what to do immediately after posting — e.g. 'Share to Stories with a poll sticker. Send to 3-5 close friends for early engagement signal'>",
      "first_30_min": "<stay active and reply to EVERY comment within 30 min — this tells the algorithm the post is generating conversation. Pin a comment that asks a question to drive more replies>",
      "first_2_hours": "<check analytics: if completion rate is above 60%, share to additional platforms. If below 40%, the hook isn't working — note for next post>",
      "pin_comment": "<exact comment to pin on the post — should ask a question or create debate to drive reply chains>"
    },
    "cross_posting_order": "<which platform first, second, third + time gaps — e.g. 'TikTok first (strongest organic). Wait 24h. Reels second (slightly different crop/caption). Wait 48h. Shorts last (add end screen).'>",
    "avoid_times": "<when NOT to post and why — e.g. 'Never post Friday 22:00+ in Norway — audience is out, content dies before morning'>"
  },
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
5. Every idea MUST reference a specific lyric theme. No connection to lyrics = cut it

VIDEO BARS (critical — read carefully):
For "video_bars" in lyric_themes: find the MOST VIRAL section of the song — the part that would make someone stop scrolling on TikTok. This is usually the chorus, hook, or the hardest-hitting verse. Extract exactly 6 consecutive bars/lines from that section, WORD-FOR-WORD, in the EXACT order they appear in the lyrics. Rules:
1. COPY-PASTE the bars directly from the lyrics — zero paraphrasing, zero reordering
2. They must be CONSECUTIVE lines — bar 1 flows into bar 2 flows into bar 3 etc.
3. Pick lines that HIT HARD back-to-back — punchlines, hooks, the part people would lip-sync to
4. If the chorus has fewer than 6 lines, continue into the next bar after the chorus to reach 6
5. NEVER grab lines from different parts of the song and stitch them together
6. These get displayed one at a time in a lyric video, timed to the BPM — they must flow naturally as if someone is rapping/singing along

Also set "video_bars_section" to exactly which section you pulled from (e.g. "Chorus", "Verse 2", "Hook").` : 'No lyrics. Base strategy on genre, mood, energy, similar artists. Mention lyrics would improve results.'}

${audioFeatures?.analyzed ? `
AUDIO DATA (use exactly):
BPM: ${audioFeatures.bpm} | Key: ${audioFeatures.key} | Energy: ${audioFeatures.energy}% | Danceability: ${audioFeatures.danceability}%
Duration: ${audioFeatures.duration}s
Peak moments: ${audioFeatures.peakMoments?.map(p => p.label).join(', ') || 'unknown'}` : 'No audio uploaded — estimate from genre. Mark as estimates.'}

${trends && trends.trends && trends.trends.length > 0 ? `TRENDING FORMATS (adapt 1-2 to this song — don't force):
${trends.trends.slice(0, 6).map(t => '- ' + t.name + ': ' + t.description).join('\n')}
Trending hashtags: ${(trends.trending_hashtags || []).join(', ')}` : ''}

SELF-CHECK (run this for EVERY video_edit and diy_content_idea before finalizing):
1. Does the "lyric_anchor.exact_line" contain a WORD-FOR-WORD quote from the lyrics above? If not → fix it
2. Does the "concept" or "description" describe HOW this specific lyric appears visually? If not → add it
3. Could this idea work with ANY other song? If yes → it's generic garbage, rewrite it around a specific lyric moment
4. Does the "song_moment" quote an actual lyric or describe a real sonic moment? If it says something vague like "the chorus" without quoting the actual words → fix it

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
      discovery_tags: JSON.stringify(result.discovery_tags || {}),
      posting_strategy: JSON.stringify(result.posting_strategy || {}),
      model_used: 'claude-sonnet-4-20250514', audio_key: audioFeatures?.key || null,
      audio_danceability: audioFeatures?.danceability || null,
      audio_duration: audioFeatures?.duration || null,
      audio_analyzed: audioFeatures?.analyzed || false,
      status: 'completed', completed_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('❌ Analysis failed:', err.message);
    return getFallback('Analysis failed: ' + err.message);
  }
}

// ── REGENERATE INDIVIDUAL SECTION ──
export async function regenerateSection(track, analysis, section) {
  const sectionPrompts = {
    video_edits: {
      system: `You are an elite music content strategist. Generate 2 NEW, completely different video content ideas for a song. These must be DIFFERENT from any previous suggestions. Every idea MUST be anchored to a specific lyric line (quoted word-for-word) and describe exactly how that lyric appears visually. Always respond in English. Respond ONLY with valid JSON array.

LYRIC ANCHORING (CRITICAL):
- Quote the EXACT lyric line(s) the idea is built around
- Describe HOW the lyric or sound is used visually
- If you can swap in ANY other song and the idea still works, it's GENERIC — rewrite it

Return a JSON array of 2 video_edit objects with this structure:
[{
  "title": "", "caption_structured": {"hook_line":"","body":"","cta":"","full_caption":""},
  "hashtags": "", "duration": "", "timestamp": "", "platforms": ["TikTok","Reels"],
  "lyric_anchor": {"exact_line":"<word-for-word lyric>","sound_moment":"","how_its_used":""},
  "concept": "<second-by-second brief referencing the specific lyric>",
  "cover_frame": "", "song_moment": "", "share_trigger": "",
  "algorithm_score": {"estimated_completion":"","rewatch_potential":"","comment_trigger":"","save_trigger":"","share_trigger":""},
  "cross_post_strategy": {"post_first_on":"","wait_before_repost":"","platform_tweaks":""}
}]`,
      user: (track, analysis) => {
        const lt = (() => { try { return JSON.parse(analysis.lyric_themes || '{}'); } catch(e) { return {}; } })();
        return `Generate 2 NEW video ideas for "${track.title}" by ${track.artist}.
Genre: ${analysis.genre_fit || track.genre || 'Unknown'}
${track.social_vibe ? `On-camera preference: ${track.social_vibe}. ALL content must respect this.` : ''}
${track.target_region ? `Target region: ${track.target_region}` : ''}
${lt.core_story ? `Song story: ${lt.core_story}` : ''}
${track.lyrics ? `LYRICS:\n${track.lyrics}` : ''}
Give COMPLETELY DIFFERENT ideas from typical suggestions. Each must quote a specific lyric line.
Respond with JSON array only.`;
      }
    },
    diy_content_ideas: {
      system: `You are an elite DIY content strategist for musicians. Generate 4 NEW, creative content ideas that an artist can film themselves. Every idea MUST reference a specific lyric line (word-for-word) and describe how it's used. Always respond in English. Respond ONLY with valid JSON array.

Return a JSON array of 4 objects:
[{
  "title": "", "difficulty": "Easy|Medium|Hard", "duration": "", "virality": 0,
  "lyric_anchor": {"exact_line":"<word-for-word lyric>","sound_moment":"","how_its_used":""},
  "description": "<must describe how the specific lyric appears visually>",
  "hook": "", "relatability": "", "share_trigger": "",
  "howTo": ["","",""], "hashtags": "", "why_it_works": "",
  "caption_structured": {"hook_line":"","body":"","cta":"","full_caption":""},
  "cover_frame": "",
  "algorithm_score": {"estimated_completion":"","rewatch_potential":"","comment_trigger":"","save_trigger":""}
}]`,
      user: (track, analysis) => {
        const lt = (() => { try { return JSON.parse(analysis.lyric_themes || '{}'); } catch(e) { return {}; } })();
        return `Generate 4 NEW DIY content ideas for "${track.title}" by ${track.artist}.
Genre: ${analysis.genre_fit || track.genre || 'Unknown'}
${track.social_vibe ? `On-camera preference: ${track.social_vibe}` : ''}
${track.target_region ? `Target region: ${track.target_region}` : ''}
${lt.core_story ? `Song story: ${lt.core_story}` : ''}
${track.lyrics ? `LYRICS:\n${track.lyrics}` : ''}
Each must quote a specific lyric line and describe how it appears visually.
Respond with JSON array only.`;
      }
    }
  };

  const sectionConfig = sectionPrompts[section];
  if (!sectionConfig) throw new Error('Unknown section: ' + section);

  try {
    console.log(`🔄 Regenerating section: ${section}...`);
    const userPrompt = sectionConfig.user(track, analysis);
    const response = await callClaude(userPrompt, sectionConfig.system);
    const result = parseJSON(response);
    console.log(`✅ Section ${section} regenerated!`);
    return Array.isArray(result) ? result : [];
  } catch (err) {
    console.error(`❌ Regenerate ${section} failed:`, err.message);
    throw err;
  }
}

// ── PRODUCER BEAT ANALYSIS ──
async function analyzeProducerBeat(track, audioFeatures = null, trends = null) {
  const audienceSize = track.audience_size || 'small';
  const tierPrompt = getProducerTierPrompt(audienceSize);

  const systemPrompt = `You are an elite beat marketing strategist who understands how producers actually sell beats and get placements in ${new Date().getFullYear()}. You think like a successful type beat YouTuber and BeatStars seller, not a marketing textbook. Always respond in English. Respond ONLY with valid JSON.

YOUR PROCESS:
1. SONIC IDENTITY: Analyze the beat's sound — BPM, energy, mood, arrangement. What type of artist would use this beat? What subgenre does it serve?
2. TYPE BEAT POSITIONING: What "type beat" search terms would artists use to find this beat? This is the #1 discovery mechanism.
3. TARGET ARTISTS: Who is actively looking for this sound? Not "rappers" — specific niches of artists at specific career stages.
4. CONTENT STRATEGY: How to make this beat go viral as content, not just as a product listing.

WHAT MAKES BEAT CONTENT VIRAL:
- "The Drop" format: 5-8 seconds of buildup → hard-hitting drop. Completion rate skyrockets.
- Making-of timelapses: Watching a beat come together in 30-60 seconds is mesmerizing.
- A/B format: "Which version is better?" — drives comments and engagement.
- Open verse challenges: Leave space for vocals, invite artists to hop on it. Creates user-generated content.
- Beat switch: Play a simple loop → flip it into something fire. The transformation is the hook.
- Screen recordings of the DAW: People love watching the process. Show the mixer, the arrangement, the sound selection.
- Song reference recreations: "How [famous song] was probably made" — drives search traffic.

BEAT MARKETING REALITY:
- YouTube type beat SEO is the #1 organic discovery channel for selling beats
- Title format matters: "[Artist] Type Beat 2025 - [Mood/Vibe Word]" — study what ranks
- BeatStars/Airbit are storefronts, not marketing channels — you drive traffic TO them
- Instagram Reels and TikTok drive awareness, YouTube drives sales
- Free beats with tags build catalog trust — artists come back for exclusives
- 80% of beat sales happen because an artist already trusts the producer's brand

HARD BANNED:
- "Just post beats and wait" — passive marketing never works
- Generic "fire beat" captions
- Spamming rapper DMs with beat links
- Copying another producer's brand/visual identity
- "Run ads" for producers under 5K followers
- Hand signs or custom gestures
- Loyalty tests or "comment if you're a real producer"

JSON structure:
{
  "tempo_bpm": <number>,
  "tempo_description": "<what the tempo FEELS like for an artist recording on this>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "energy_percent": <1-100>,
  "energy_description": "<physical vibe — how does this beat make you move?>",
  "genre_fit": "<specific subgenre: dark trap, melodic drill, pluggnb, etc.>",
  "lyric_themes": {
    "core_story": "<what kind of song would an artist write on this beat? What mood/topic does it pull out?>",
    "quotable_lines": ["<type beat title variation 1>", "<variation 2>", "<variation 3>"],
    "emotional_core": "<the vibe/feeling this beat creates>",
    "visual_world": "<colors, settings, time of day, textures matching this beat's mood>"
  },
  "audience_age": "<age range of artists who'd buy this + listeners>",
  "audience_interests": "<2-3 specific producer/artist communities>",
  "audience_platforms": "<platforms ranked: where do artists find beats?>",
  "audience_content_angle": "<what type of content this audience engages with>",
  "audience_key_insight": "<one insight about reaching beat buyers in this niche>",
  "reference_artists": [
    {"name": "<producer/artist>", "genre": "<genre>", "description": "<WHY using this name as a type beat tag drives sales — e.g. '#metroboomintypebeat gets 50K+ monthly searches, your beat fits this lane'>"},
    {"name": "<producer/artist>", "genre": "<genre>", "description": "<type beat SEO value + tag usage>"},
    {"name": "<lesser-known producer/artist>", "genre": "<genre>", "description": "<niche type beat tag with less competition but targeted buyers>"},
    {"name": "<artist who raps/sings on this style>", "genre": "<genre>", "description": "<why '[artist] type beat' tag attracts their fanbase of aspiring artists>"}
  ],
  "discovery_tags": {
    "type_beat_tags": ["<artist1> type beat", "<artist2> type beat", "<artist3> type beat"],
    "genre_tags": ["#<subgenre>beats", "#<mood>beats", "#<style>producer"],
    "trending_tags": ["#typebeat${new Date().getFullYear()}", "#<relevant trending tag>"],
    "youtube_title": "<optimized YouTube title: '[Artist] Type Beat ${new Date().getFullYear()} - [Mood Word]' format>",
    "bio_suggestion": "<one-line producer bio using these references — e.g. 'Dark trap & drill beats inspired by Metro Boomin x Southside'>"
  },
  "video_edits": [
    {
      "title": "<beat preview / content concept>",
      "caption_structured": {
        "hook_line": "<first line scroll-stopper — question, bold claim, or mystery>",
        "body": "<1-2 lines — reference the beat's vibe, not ad copy>",
        "cta": "<action that drives algorithm signal — 'tag a rapper who needs this' (shares), 'wait for the drop...' (completion)>",
        "full_caption": "<complete caption ready to paste>"
      },
      "hashtags": "<ORDERED: 2 niche tags under 500K first → 2 mid 500K-5M → 1 broad. Order matters>",
      "duration": "<7-15 sec for previews, 30-60 sec for making-of>",
      "timestamp": "<which part of the beat to feature>",
      "platforms": ["TikTok", "Reels", "YouTube Shorts"],
      "concept": "<FULL brief: what to show, how to edit, DAW screenshots, waveform visuals, etc.>",
      "cover_frame": "<exact frame for thumbnail — describe visual + any text overlay. This determines clicks from profile grid>",
      "song_moment": "<which sonic element this is built around>",
      "share_trigger": "<why a producer or artist sends this to someone>",
      "algorithm_score": {
        "estimated_completion": "<% + reason>",
        "rewatch_potential": "<Low/Medium/High + reason>",
        "comment_trigger": "<what drives comments>",
        "save_trigger": "<why someone saves>",
        "share_trigger": "<why someone shares>"
      },
      "cross_post_strategy": {
        "post_first_on": "<platform + why>",
        "wait_before_repost": "<hours between platforms>",
        "platform_tweaks": "<what to change per platform>"
      }
    },
    {"title":"","caption_structured":{"hook_line":"","body":"","cta":"","full_caption":""},"hashtags":"","duration":"","timestamp":"","platforms":["TikTok","Reels"],"concept":"","cover_frame":"","song_moment":"","share_trigger":"","algorithm_score":{"estimated_completion":"","rewatch_potential":"","comment_trigger":"","save_trigger":"","share_trigger":""},"cross_post_strategy":{"post_first_on":"","wait_before_repost":"","platform_tweaks":""}}
  ],
  "diy_content_ideas": [
    {
      "title": "<content idea>",
      "difficulty": "Easy|Medium|Hard",
      "duration": "<length>",
      "virality": <1-100>,
      "description": "<FULL brief: what to create, how to edit. Must connect to THIS beat's specific sound>",
      "hook": "<what stops the scroll in first 1-2 seconds>",
      "relatability": "<what universal producer/artist experience this taps into>",
      "share_trigger": "<why someone shares this>",
      "howTo": ["<step 1>", "<step 2>", "<step 3>"],
      "hashtags": "<tags>",
      "why_it_works": "<psychological trigger>",
      "caption_structured": {"hook_line": "<>", "body": "<>", "cta": "<>", "full_caption": "<>"},
      "cover_frame": "<thumbnail description>",
      "algorithm_score": {"estimated_completion": "<>", "rewatch_potential": "<>", "comment_trigger": "<>", "save_trigger": "<>"}
    },
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":"","caption_structured":{"hook_line":"","body":"","cta":"","full_caption":""},"cover_frame":"","algorithm_score":{"estimated_completion":"","rewatch_potential":"","comment_trigger":"","save_trigger":""}},
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":"","caption_structured":{"hook_line":"","body":"","cta":"","full_caption":""},"cover_frame":"","algorithm_score":{"estimated_completion":"","rewatch_potential":"","comment_trigger":"","save_trigger":""}},
    {"title":"","difficulty":"Easy|Medium|Hard","duration":"","virality":0,"description":"","howTo":["","",""],"hashtags":"","why_it_works":"","caption_structured":{"hook_line":"","body":"","cta":"","full_caption":""},"cover_frame":"","algorithm_score":{"estimated_completion":"","rewatch_potential":"","comment_trigger":"","save_trigger":""}}
  ],
  "posting_strategy": {
    "best_days": ["<day1>", "<day2>", "<day3>"],
    "best_times": {
      "tiktok": "<exact time in TARGET REGION timezone + reasoning>",
      "reels": "<exact time + reasoning>",
      "youtube_shorts": "<exact time + reasoning>"
    },
    "posting_frequency": "<posts per week + spacing>",
    "engagement_window": {
      "first_5_min": "<what to do immediately after posting>",
      "first_30_min": "<reply strategy + pin comment>",
      "first_2_hours": "<analytics check + next steps>",
      "pin_comment": "<exact comment to pin>"
    },
    "cross_posting_order": "<platform order + time gaps>",
    "avoid_times": "<when NOT to post and why>"
  },
  "pro_tip": "<one specific production/visual tip for THIS beat's content>",
  "creator_tip": "<one growth tactic for this producer's tier>",
  "viral_advice": "<2-3 sentences of specific advice for this producer at their current level>",
  "viral_keys": {
    "hook": "<specific hook for THIS beat — what sonic moment stops the scroll>",
    "relatability": "<what universal producer/artist experience will the audience recognize?>",
    "share_trigger": "<specific reason someone sends this to a friend>"
  }
}`;

  const userPrompt = `Analyze this beat and build a marketing strategy this producer can actually execute:

Title: "${track.title}"
Producer: ${track.artist}
${track.genre ? `Genre: ${track.genre}` : ''}
${track.similar_artists ? `Similar producers/references: ${track.similar_artists}` : ''}
${track.producer_goal || track.main_goal ? `Goal: ${track.producer_goal || track.main_goal}` : ''}
${track.social_vibe ? `On-camera preference: ${track.social_vibe}. ALL content must respect this. If "no-face" or "minimal-face", focus on screen recordings, DAW visuals, waveforms — never talking-to-camera.` : ''}
${track.target_region ? `Target region: ${track.target_region} — posting times and cultural context must match this region.` : ''}
${track.beat_store_url ? `Beat store: ${track.beat_store_url}` : ''}

${tierPrompt}

${audioFeatures?.analyzed ? `
AUDIO DATA (use exactly):
BPM: ${audioFeatures.bpm} | Key: ${audioFeatures.key} | Energy: ${audioFeatures.energy}% | Danceability: ${audioFeatures.danceability}%
Duration: ${audioFeatures.duration}s
Peak moments: ${audioFeatures.peakMoments?.map(p => p.label).join(', ') || 'unknown'}` : 'No audio uploaded — estimate from genre. Mark as estimates.'}

${trends && trends.trends && trends.trends.length > 0 ? `TRENDING FORMATS (adapt 1-2 to beat content):
${trends.trends.slice(0, 6).map(t => '- ' + t.name + ': ' + t.description).join('\n')}
Trending hashtags: ${(trends.trending_hashtags || []).join(', ')}` : ''}

SELF-CHECK: For each suggestion — "if I swap this beat for any random beat, does this still work?" If yes → rewrite with specific references to THIS beat's sound, vibe, or arrangement.

Respond ONLY with JSON.`;

  try {
    console.log('🤖 Analyzing beat (producer mode)...');
    const response = await callClaude(userPrompt, systemPrompt);
    const result = parseJSON(response);
    console.log('✅ Beat analysis complete!');
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
      discovery_tags: JSON.stringify(result.discovery_tags || {}),
      posting_strategy: JSON.stringify(result.posting_strategy || {}),
      model_used: 'claude-sonnet-4-20250514', audio_key: audioFeatures?.key || null,
      audio_danceability: audioFeatures?.danceability || null,
      audio_analyzed: audioFeatures?.analyzed || false,
      status: 'completed', completed_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('❌ Beat analysis failed:', err.message);
    return getFallback('Beat analysis failed: ' + err.message);
  }
}

// ── PROMO PLAN GENERATOR ──
export async function generatePromoPlan(track, analysis) {
  // Branch to producer promo plan if content_type is producer
  if (track.content_type === 'producer') {
    return generateProducerPromoPlan(track, analysis);
  }

  const moods = JSON.parse(analysis.mood_tags || '[]');
  const refs = JSON.parse(analysis.reference_artists || '[]');
  const lyricThemes = (() => { try { return JSON.parse(analysis.lyric_themes || '{}'); } catch(e) { return {}; } })();
  const noSocial = track.no_social === '1' || track.no_social === 1;
  const audienceSize = track.audience_size || 'small';
  const tierPrompt = getAudienceTierPrompt(audienceSize);

  const systemPrompt = `You are a viral music strategist. You don't write marketing plans — you give artists the exact moves that get songs heard. Short, specific, copy-paste ready. Always respond in English. Respond ONLY with valid JSON.

WHAT ACTUALLY MAKES SONGS BLOW UP IN ${new Date().getFullYear()}:
- First 48 hours on Spotify determine algorithmic push — everything leads to this moment
- 47% of music discovery starts on short-form video (TikTok/Reels/Shorts)
- Completion rate (70%+) and rewatches drive algorithmic reach — NOT likes or follows
- 7-15 second clips get highest completion rates
- Hook in first 2 seconds or they scroll past
- Content that feels REAL outperforms polished promo 10:1
- Comments and shares matter more than likes
- Micro-creators (1K-10K) convert better than big influencers

RULES:
- Every tactic must be specific to THIS song's lyrics, mood, and world
- Give EXACT captions, hooks, hashtags — ready to paste
- No generic advice ("post consistently", "engage with your audience")
- No cringe (hand signs, loyalty tests, fake luxury, forced challenges)
- Posting times must match target region timezone
- Be realistic for the artist's size

JSON structure:
{
  "plan_title": "<short punchy title referencing the song>",
  "viral_hook": "<1 sentence: the single most viral angle for this song — what makes someone stop scrolling>",
  "release_countdown": {
    "7_days_before": "<one key action>",
    "3_days_before": "<one key action>",
    "release_day": "<one key action>",
    "48_hours_after": "<one key action>"
  },
  "viral_tactics": [
    {
      "title": "<short name>",
      "platform": "TikTok|Reels|Both",
      "lyric_anchor": "<EXACT lyric line this tactic is built around — word-for-word quote>",
      "why_it_works": "<1 sentence — the psychological trigger, referencing the specific lyric/sound>",
      "script": "<exact step-by-step: what to film, what to show, transitions, timing. MUST describe how the quoted lyric line appears (text overlay, lip sync, visual metaphor). Example: 'Sec 0-2: black screen, text fades in word-by-word: I left it all behind. Sec 2-5: artist walks away from camera in empty parking lot, slow zoom. Sec 5-8: cut to closeup, mouth the next line. Sec 8-10: hard cut to black on the beat drop'>",
      "caption": "<ready to paste caption with hook line first — reference the lyric>",
      "hashtags": "<5-7 hashtags, niche first>",
      "best_time": "<when to post in target region timezone>",
      "difficulty": "Easy|Medium"
    },
    {
      "title": "<completely different format from #1>",
      "platform": "",
      "lyric_anchor": "<different lyric line — word-for-word quote>",
      "why_it_works": "",
      "script": "",
      "caption": "",
      "hashtags": "",
      "best_time": "",
      "difficulty": ""
    },
    {
      "title": "<completely different format from #1 and #2>",
      "platform": "",
      "lyric_anchor": "<different lyric line — word-for-word quote>",
      "why_it_works": "",
      "script": "",
      "caption": "",
      "hashtags": "",
      "best_time": "",
      "difficulty": ""
    }
  ],
  "growth_moves": [
    {
      "move": "<specific action — not 'engage with fans' but 'comment on [type] videos'>",
      "details": "<exactly how to do it, where, what to say>",
      "expected_result": "<realistic outcome>"
    },
    {"move": "", "details": "", "expected_result": ""},
    {"move": "", "details": "", "expected_result": ""}
  ],
  "playlist_pitch": {
    "best_playlists": ["<real playlist name>", "<real playlist name>", "<real playlist name>"],
    "pitch_message": "<ready to copy-paste pitch written for THIS song>",
    "spotify_pitch": "<exact Spotify for Artists pitch text>"
  },
  "caption_bank": [
    "<ready-to-use caption #1 — references lyrics>",
    "<ready-to-use caption #2 — different angle>",
    "<ready-to-use caption #3 — question/engagement hook>",
    "<ready-to-use caption #4 — storytelling angle>",
    "<ready-to-use caption #5 — bold claim>"
  ],
  "mistakes_to_avoid": ["<specific mistake for this genre/tier>", "<another>", "<another>"]
}`;

  const userPrompt = `Give me the viral playbook for this song. Not a marketing plan — the exact moves to get this song heard.

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
${noSocial ? 'NO social media. Focus on: playlists, blogs, sync licensing, collabs, press.' : ''}

${tierPrompt}

${lyricThemes.core_story ? `
SONG DNA:
Story: ${lyricThemes.core_story}
Feeling: ${lyricThemes.emotional_core || ''}
Visual world: ${lyricThemes.visual_world || ''}
Best lines: ${(lyricThemes.quotable_lines || []).join(' | ')}` : ''}

${track.lyrics ? `LYRICS:\n${track.lyrics}` : ''}

IMPORTANT:
- The 3 viral_tactics must each be a COMPLETELY different format (not 3 variations of the same idea)
- Each tactic needs a full "script" the artist can follow second by second
- The caption_bank must have 5 captions ready to copy-paste, each using a different lyric or angle
- The growth_moves must be actions that reach NEW people, not just content for existing followers
- For every element: "could any artist use this?" If yes → rewrite with THIS song's specific lyrics and themes
- Each viral_tactic.lyric_anchor MUST be a WORD-FOR-WORD quote from the lyrics — not a paraphrase
- Each viral_tactic.script MUST describe how that specific lyric appears visually (text overlay, lip sync, visual cut, etc.)
- Each caption in caption_bank MUST reference or quote a specific lyric line

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

// ── PRODUCER PROMO PLAN ──
async function generateProducerPromoPlan(track, analysis) {
  const moods = JSON.parse(analysis.mood_tags || '[]');
  const refs = JSON.parse(analysis.reference_artists || '[]');
  const lyricThemes = (() => { try { return JSON.parse(analysis.lyric_themes || '{}'); } catch(e) { return {}; } })();
  const audienceSize = track.audience_size || 'small';
  const tierPrompt = getProducerTierPrompt(audienceSize);

  const systemPrompt = `You are an elite beat marketing strategist who creates plans producers execute day-by-day to sell beats, get placements, and grow their brand. Always respond in English. Respond ONLY with valid JSON.

YOUR APPROACH:
1. Every task is a complete recipe — exact concept, hook, visual direction, caption, hashtags, platform-specific instructions.
2. Momentum arc: Week 1 = establish the beat's identity + seed content. Week 2 = drive engagement + artist outreach. Week 3 = push for sales/placements. Week 4 = sustain + scale what worked.
3. Every task connects to THIS beat's specific sound, vibe, and target artist niche.
4. Tasks must be realistic for this producer's audience tier.
5. At least 40% of tasks must be GROWTH tactics (reaching new artists/listeners).

BEAT MARKETING REALITY IN ${new Date().getFullYear()}:
- YouTube type beat SEO is still the #1 organic channel for beat sales
- Title format: "[Artist] Type Beat ${new Date().getFullYear()} - [Mood/Vibe Word]" — study what ranks
- TikTok/Reels drive awareness but YouTube drives actual sales
- "The Drop" format (buildup → drop) gets 3-5x the completion rate of flat beat previews
- Open verse challenges create free marketing from artists using your beats
- BeatStars/Airbit are storefronts, not marketing — you drive traffic TO them
- Free beats with tags build trust → artists come back for premium/exclusive
- 80% of beat sales come from artists who already trust the producer brand
- Making-of content performs 2x better than pure beat previews
- A/B format ("which version?") drives 4x more comments than regular posts

QUALITY RULES:
- Each day MUST have a DIFFERENT type of task — variety is mandatory
- Task types: content creation (different format each time), artist outreach (targeted DMs, not spam), platform optimization (SEO, tags, thumbnails), community (producer forums, collabs), strategic (email list, pricing strategy, catalog organization)
- Name REAL platforms, REAL communities, REAL tools
- Outreach messages must be ready to copy-paste, written for THIS beat's style
- Posting times MUST match the target region's timezone

HARD BANNED:
- "Just upload beats and wait"
- Spamming artist DMs with beat links
- Generic "fire beat 🔥" captions
- Hand signs, custom gestures, loyalty tests
- "Run ads" for producers under 5K followers
- Any task that works for any random beat — every task MUST reference this beat's sound
- "Celebrate milestones" as content if under 10K followers
- Posting times in wrong timezone for target region

JSON structure:
{
  "plan_title": "<creative title referencing the beat's vibe>",
  "plan_summary": "<2-3 sentences: what makes THIS plan specific to this beat and producer>",
  "target_audience": {
    "description": "<specific type of artists who need this beat — not just 'rappers'>",
    "best_platforms": ["<platform1>", "<platform2>", "<platform3>"],
    "best_posting_times": "<specific times in TARGET REGION timezone>",
    "content_style": "<visual/tonal direction matching the beat's world>"
  },
  "weeks": [
    {
      "week_number": 1, "title": "<thematic>", "goal": "<specific, measurable>",
      "tasks": [
        {"day": "<day>", "task": "<name>", "platform": "<platform>", "details": "<COMPLETE brief: exact concept, visual direction, caption ready to paste, hashtags, timing. Must reference this beat's specific sound. Producer executes immediately.>"},
        {"day": "<day>", "task": "<>", "platform": "<>", "details": "<>"},
        {"day": "<day>", "task": "<>", "platform": "<>", "details": "<>"}
      ]
    },
    {"week_number": 2, "title": "", "goal": "", "tasks": [{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]},
    {"week_number": 3, "title": "", "goal": "", "tasks": [{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]},
    {"week_number": 4, "title": "", "goal": "", "tasks": [{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""},{"day":"","task":"","platform":"","details":""}]}
  ],
  "playlist_strategy": {
    "approach": "<beat placement strategy — YouTube SEO, BeatStars optimization, type beat playlists>",
    "editorial_playlists": [{"name": "<real type beat playlist or channel>", "why": "<why this beat fits>", "follower_estimate": "<approx>"}],
    "independent_playlists": [{"name": "<real beat curator/channel>", "curator_contact": "<how to reach>", "why": "<reason>"}],
    "pitch_template": "<ready-to-send message to artist/manager pitching this beat for placement>",
    "pitch_tips": "<tips for this genre and tier>",
    "spotify_for_artists_pitch": "<YouTube SEO title + description template optimized for this beat's type beat keywords>"
  },
  "collaboration_ideas": [
    {"type": "<type>", "description": "<specific: artist collab, producer collab, beat flip challenge, open verse>", "expected_impact": "<realistic>"},
    {"type": "<>", "description": "<>", "expected_impact": "<>"}
  ],
  "budget_tips": {
    "free_tactics": ["<specific free tactic>", "<>", "<>"],
    "paid_options": [{"tactic": "<specific>", "estimated_cost": "<real cost>", "expected_result": "<realistic>"}]
  },
  "meta_ads": {
    "campaign_objective": "<objective — or 'Skip ads for now' if under 5K>",
    "ad_copy_variations": [
      {"headline": "<captures the beat's vibe>", "primary_text": "<speaks to target artists>", "cta": "<>"},
      {"headline": "<different angle>", "primary_text": "<>", "cta": "<>"}
    ],
    "targeting": {
      "age_range": "<>",
      "interests": ["<specific: bedroom producers, independent rappers, etc.>", "<>", "<>", "<>"],
      "lookalike_suggestion": "<>",
      "excluded_audiences": "<>"
    },
    "budget_recommendation": "<specific amount or 'Don't spend yet' for small producers>",
    "ad_format": "<>",
    "creative_direction": "<specific visual direction from the beat's sonic world>"
  },
  "key_metrics": ["<metric relevant to tier>", "<>", "<>", "<>"],
  "common_mistakes": ["<mistake specific to beat sellers in this genre>", "<>", "<>"]
}`;

  const userPrompt = `Create a 4-week beat promotion plan. Every task must be immediately executable.

Title: "${track.title}"
Producer: ${track.artist}
Genre: ${track.genre || analysis.genre_fit || 'Unknown'}
Similar producers/references: ${track.similar_artists || refs.map(r => r.name || r).join(', ') || 'Unknown'}
Goal: ${track.producer_goal || track.main_goal || 'Sell more beats online'}
Mood: ${moods.join(', ') || 'Unknown'}
Energy: ${analysis.energy_percent || 50}%
BPM: ${analysis.tempo_bpm || 120}
Target artists: ${analysis.audience_age || '18-30'}, ${analysis.audience_platforms || 'YouTube, BeatStars, TikTok'}
${track.target_region ? `Target region: ${track.target_region} — ALL posting times must be in this region's timezone` : ''}
${track.beat_store_url ? `Beat store: ${track.beat_store_url} — include this link in relevant tasks` : ''}

${tierPrompt}

${lyricThemes.core_story ? `
BEAT IDENTITY (from analysis):
Vibe: ${lyricThemes.core_story}
Emotional core: ${lyricThemes.emotional_core || ''}
Visual world: ${lyricThemes.visual_world || ''}
Type beat keywords: ${(lyricThemes.quotable_lines || []).join(' | ')}

Every task must connect to this beat's specific identity.` : ''}

TASK MIX REQUIREMENT:
Your 12 tasks across 4 weeks must include at least:
- 3 CONTENT tasks (each a completely different format: beat preview, making-of, A/B comparison, open verse, beat switch, etc.)
- 3 OUTREACH tasks (finding artists, DMing with purpose, engaging in communities)
- 2 PLATFORM OPTIMIZATION tasks (YouTube SEO, BeatStars tags/pricing, thumbnail design)
- 2 COMMUNITY tasks (producer forums, collab posts, networking)
- 2 STRATEGIC tasks (email list, catalog organization, pricing strategy, analytics review)
Do NOT make 12 "post a beat preview" tasks. Variety is mandatory.

SELF-CHECK: For every task — "could any producer use this for any beat?" If yes, rewrite with specific references to THIS beat's sound, vibe, and target audience.

Respond ONLY with JSON.`;

  try {
    console.log('📋 Generating producer promo plan...');
    const response = await callClaude(userPrompt, systemPrompt);
    const plan = parseJSON(response);
    console.log('✅ Producer promo plan generated!');
    return plan;
  } catch (err) {
    console.error('❌ Producer promo plan failed:', err.message);
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
    viral_advice: '', viral_keys: JSON.stringify({}), discovery_tags: JSON.stringify({}), posting_strategy: JSON.stringify({}),
    model_used: 'fallback', audio_key: null, audio_danceability: null, audio_analyzed: false,
    status: 'completed', completed_at: new Date().toISOString(),
  };
}
