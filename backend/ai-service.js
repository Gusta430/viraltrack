/**
 * AI Analysis Service + Promo Plan Generator
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
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error('No JSON found');
}

// ── TRACK ANALYSIS ──────────────────────────────────────
export async function analyzeTrack(track, audioFeatures = null) {
  const systemPrompt = `You are an extremely experienced music marketer with 15+ years in the music industry. You have worked with artists from bedroom pop to trap, and you know EXACTLY what separates generic advice from advice that actually delivers results. IMPORTANT: Always respond in English.

RULES YOU MUST FOLLOW:
- AUDIENCE FIRST: Before creating ANY content suggestion, identify the EXACT subculture and community that would love this song. Not just "18-28 hip-hop fans" — be specific: "car meet TikTok", "gym motivation community", "late night stoners", "skate culture", "anime edit community", "streetwear Twitter". Every single suggestion must be designed to spread within THAT specific community.
- For each video idea, name the SPECIFIC type of account that would repost it (e.g. "accounts like @carculture, @trapedits, @chilledcow")
- Think about WHERE this song would naturally play in real life (car, gym, bedroom, party, walking alone at night) — that context IS the content
- NEVER give generic advice like "post consistently" or "engage with your audience" — everyone knows this already
- NEVER suggest "behind the scenes" videos or "studio session" clips unless you have a SPECIFIC, UNIQUE angle on it
- Suggestions should be driven primarily by the track's MOOD, ENERGY and GENRE — not just the title. The title can inspire 1 idea, but the rest should come from the sonic feel and emotional vibe of the music
- Video ideas must contain CONCRETE scenarios optimized for VIRALITY. Describe exactly what happens second by second. Think: what makes someone stop scrolling? What makes them watch again? What makes them share?
- For each video idea, think about what TREND FORMAT it fits (POV, transition, reaction, slow reveal, etc.) — the format matters as much as the content
- VIDEO VISUALS MUST MATCH THE SONG'S ENERGY AND SUBCULTURE:
  * High-energy trap/drill/rage = cars drifting, dirt bikes doing wheelies, urban nightlife, fast cuts, aggressive energy
  * Chill hip-hop/lo-fi = nature edits, slow-motion walks, sunset drives, peaceful city shots
  * Dark/emo rap = moody lighting, rain, empty streets, cinematic noir, silhouettes
  * Pop/dance = colorful, high-energy choreography, festival vibes, party scenes
  * R&B/soul = intimate settings, soft lighting, couple moments, luxury minimalism
  * Afrobeats/dancehall = dance challenges, vibrant colors, group energy, cultural celebration
  Think about what visuals the TARGET AUDIENCE actually watches and shares. A trap fan shares car edits and street content, not nature videos. An indie fan shares aesthetic mood content, not party videos. MATCH THE CULTURE.
- Hashtags skal inkludere NISJE-hashtags (under 1M innlegg) som faktisk treffer målgruppen, ikke bare store generiske tags
- Captions skal ha en hook i første linje som får folk til å stoppe scrollingen
- DIY-ideer skal være KREATIVE og OVERRASKENDE — ting artisten ikke ville tenkt på selv
- Reference artists skal ikke bare være de mest åpenbare — inkluder minst 2 mindre kjente artister som har lignende sound men en unik markedsføringsstrategi å lære av
- Key insight skal være EN spesifikk, kontraintuitiv innsikt — ikke en generisk observasjon

VIKTIG: ALWAYS respond with valid JSON og INGENTING annet.

JSON-struktur:
{
  "tempo_bpm": <60-200>,
  "tempo_description": "<beskrivelse>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "energy_percent": <1-100>,
  "energy_description": "<beskrivelse>",
  "genre_fit": "<sjanger>",
  "audience_age": "<aldersgruppe>",
  "audience_interests": "<interesser>",
  "audience_platforms": "<plattformer>",
  "audience_content_angle": "<vinkel>",
  "audience_key_insight": "<innsikt>",
  "reference_artists": [{"name":"<>","genre":"<>","description":"<>"},{"name":"<>","genre":"<>","description":"<>"},{"name":"<>","genre":"<>","description":"<>"},{"name":"<>","genre":"<>","description":"<>"}],
  "video_edits": [{"title":"<>","caption":"<>","hashtags":"<>","duration":"<>","timestamp":"<>","platforms":["TikTok","Reels"]},{"title":"<>","caption":"<>","hashtags":"<>","duration":"<>","timestamp":"<>","platforms":["TikTok","Reels"]}],
  "diy_content_ideas": [{"title":"<>","difficulty":"Easy|Medium|Hard","duration":"<>","virality":<1-100>,"description":"<>","howTo":["<>","<>","<>"],"hashtags":"<>"},{"title":"<>","difficulty":"Easy|Medium|Hard","duration":"<>","virality":<1-100>,"description":"<>","howTo":["<>","<>","<>"],"hashtags":"<>"},{"title":"<>","difficulty":"Easy|Medium|Hard","duration":"<>","virality":<1-100>,"description":"<>","howTo":["<>","<>","<>"],"hashtags":"<>"},{"title":"<>","difficulty":"Easy|Medium|Hard","duration":"<>","virality":<1-100>,"description":"<>","howTo":["<>","<>","<>"],"hashtags":"<>"}],
  "pro_tip": "<tips>",
  "creator_tip": "<tips>"
}`;

  const userPrompt = `Analyze this track and create a VIRAL STRATEGY:

Title: "${track.title}"
Artist: ${track.artist}
${track.genre ? `Genre: ${track.genre}` : ''}
${track.similar_artists ? `Similar artists: ${track.similar_artists}` : ''}
${track.main_goal ? `Main goal: ${track.main_goal}` : ''}
${track.social_vibe ? `Content style: ${track.social_vibe}` : ''}
${track.want_tiktok_content ? 'Wants TikTok/Reels content.' : ''}
${track.lyrics ? `

SONG LYRICS — read these to understand the song's deeper meaning:
${track.lyrics}

INSTRUCTIONS FOR USING LYRICS:
- Analyze the lyrics to understand the CORE EMOTIONS, THEMES and STORY
- DO NOT quote lyrics directly in captions or content ideas
- Instead, use the FEELINGS and THEMES as inspiration for visual concepts
- Combine the lyrical themes with the audio energy level to create content that FEELS like the song
- Example: if lyrics are about heartbreak and energy is high, create intense emotional content — not just "sad" content
- Think about what VISUAL WORLD the lyrics describe — colors, settings, moods, situations
- Content should make viewers FEEL the same emotions as the song, without needing to hear it
- The best viral content captures a universal feeling that the lyrics express — jealousy, freedom, obsession, confidence — and turns it into a relatable visual moment` : ''}
${audioFeatures && audioFeatures.analyzed ? `
REAL AUDIO ANALYSIS DATA (from actual audio file - use these exact values, do NOT make up different numbers):
- BPM: ${audioFeatures.bpm}
- Key: ${audioFeatures.key}
- Energy: ${audioFeatures.energy}% (0=very calm, 100=very intense)
- Danceability: ${audioFeatures.danceability}% (0=not danceable, 100=very danceable)
- Duration: ${audioFeatures.duration} seconds

- Peak energy moments (best for TikTok clips): ${audioFeatures.peakMoments ? audioFeatures.peakMoments.map(p => p.label).join(', ') : 'unknown'}

IMPORTANT: Use the EXACT BPM and energy values above. These are from the actual audio file.
For video suggestions, recommend using the PEAK MOMENTS timestamps above — these are the most intense, energetic parts of the song with the highest viral potential. Each video idea should reference a specific timestamp from these peaks.` : 'NOTE: No audio file was uploaded. Estimate BPM and energy based on genre and similar artists, and mark them as estimates.'}
${track.social_vibe ? `Social media vibe: ${track.social_vibe}. ALL content suggestions must match this vibe. The artist wants their social presence to feel ${track.social_vibe}.` : ''}

THINK THROUGH THIS BEFORE ANSWERING:
1. What is the MOOD, ENERGY and VIBE of this track? What visuals, colors, settings and emotions does the music evoke? This should drive MOST of your suggestions.
2. What SPECIFIC TikTok/Reels trend formats could this track fit? Think about current viral formats: POVs, transitions, slow reveals, reaction videos, "watch till the end" hooks. Match the format to the track's energy.
3. The title "${track.title}" — can it inspire ONE creative concept? But don't force all ideas around the title.
4. What do artists in this niche do WRONG with marketing, and how can we do the OPPOSITE?

For video ideas: VIRALITY IS THE #1 PRIORITY. For each video, explain:
- The hook (first 1-2 seconds that stop the scroll)
- The payoff (why someone watches to the end)
- The share trigger (why someone sends it to a friend)
Think like a viral content creator, not a marketer. At least 1 video should use a currently trending format.

For DIY ideas: Think outside the box. No "film yourself in the studio" unless it has a COMPLETELY NEW TWIST. What can the artist do that is surprising, funny, emotional, or controversial (in a good way)? Focus on what has the highest chance of going viral.

Svar KUN med JSON.`;

  try {
    console.log('🤖 Analyserer låt...');
    const response = await callClaude(userPrompt, systemPrompt);
    const result = parseJSON(response);
    console.log('✅ Analyse fullført!');
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
      model_used: 'claude-sonnet-4-20250514', audio_key: audioFeatures?.key || null, audio_danceability: audioFeatures?.danceability || null, audio_analyzed: audioFeatures?.analyzed || false, status: 'completed', completed_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error('❌ Analyse feilet:', err.message);
    return getFallback('Analyse feilet: ' + err.message);
  }
}

// ── PROMO PLAN GENERATOR ────────────────────────────────
export async function generatePromoPlan(track, analysis) {
  const moods = JSON.parse(analysis.mood_tags || '[]');
  const refs = JSON.parse(analysis.reference_artists || '[]');

  const systemPrompt = `You are an elite music marketer who has helped artists go from 0 to 100K+ monthly listeners. You do NOT create generic launch plans — you create tailored, surprising strategies adapted to this one specific track. IMPORTANT: Always respond in English.

RULES:
- EVERY task must be so specific that the artist can do it immediately without thinking "but what does that actually mean?"
- DO NOT write "post engaging content" — write EXACTLY what they should post, with example captions and visual descriptions
- Playlist strategy must mention REAL playlist names that exist on Spotify, not generic categories
- Collaboration ideas must include SPECIFIC types of creators to contact (not just "influencers"), with suggestions for what the collaboration should contain
- Budget-tips skal ha REELLE tall basert på hva som faktisk fungerer i ${new Date().getFullYear()}
- Unngå disse klisjeene: "consistency is key", "engage with your community", "post regularly", "be authentic"
- Tenk på hva som er KONTRAINTUITIVT — hvilke strategier VIRKER rare men faktisk fungerer?
- Inkluder minst én "growth hack" som utnytter en plattform-mekanikk de fleste ikke vet om

VIKTIG: ALWAYS respond with valid JSON og INGENTING annet.

JSON-struktur:
{
  "plan_title": "<tittel på planen>",
  "plan_summary": "<2-3 setninger som oppsummerer strategien>",
  "target_audience": {
    "description": "<detaljert beskrivelse av målgruppen>",
    "best_platforms": ["<plattform1>", "<plattform2>", "<plattform3>"],
    "best_posting_times": "<konkrete tidspunkter for posting>",
    "content_style": "<hvilken type innhold som treffer denne gruppen>"
  },
  "weeks": [
    {
      "week_number": 1,
      "title": "<tittel for uken>",
      "goal": "<mål for denne uken>",
      "tasks": [
        {"day": "<dag/dager>", "task": "<konkret oppgave>", "platform": "<plattform>", "details": "<detaljer>"},
        {"day": "<dag/dager>", "task": "<oppgave>", "platform": "<plattform>", "details": "<detaljer>"},
        {"day": "<dag/dager>", "task": "<oppgave>", "platform": "<plattform>", "details": "<detaljer>"}
      ]
    },
    {
      "week_number": 2,
      "title": "<tittel>",
      "goal": "<mål>",
      "tasks": [
        {"day": "<>", "task": "<>", "platform": "<>", "details": "<>"},
        {"day": "<>", "task": "<>", "platform": "<>", "details": "<>"},
        {"day": "<>", "task": "<>", "platform": "<>", "details": "<>"}
      ]
    },
    {
      "week_number": 3,
      "title": "<tittel>",
      "goal": "<mål>",
      "tasks": [
        {"day": "<>", "task": "<>", "platform": "<>", "details": "<>"},
        {"day": "<>", "task": "<>", "platform": "<>", "details": "<>"},
        {"day": "<>", "task": "<>", "platform": "<>", "details": "<>"}
      ]
    },
    {
      "week_number": 4,
      "title": "<tittel>",
      "goal": "<mål>",
      "tasks": [
        {"day": "<>", "task": "<>", "platform": "<>", "details": "<>"},
        {"day": "<>", "task": "<>", "platform": "<>", "details": "<>"},
        {"day": "<>", "task": "<>", "platform": "<>", "details": "<>"}
      ]
    }
  ],
  "playlist_strategy": {
    "approach": "<detailed strategy for getting on playlists>",
    "editorial_playlists": [{"name": "<real Spotify editorial playlist>", "why": "<why this song fits>", "follower_estimate": "<approx followers>"}],
    "independent_playlists": [{"name": "<real independent/user playlist>", "curator_contact": "<how to find/contact curator>", "why": "<why this fits>"},{"name": "<playlist>", "curator_contact": "<contact method>", "why": "<why>"}],
    "pitch_template": "<a ready-to-send pitch email/message for playlist curators — specific to this song>",
    "pitch_tips": "<additional tips>",
    "spotify_for_artists_pitch": "<exact text to paste into Spotify for Artists editorial pitch tool>"
  },
  "collaboration_ideas": [
    {"type": "<type samarbeid>", "description": "<beskrivelse>", "expected_impact": "<forventet effekt>"},
    {"type": "<type>", "description": "<beskrivelse>", "expected_impact": "<effekt>"}
  ],
  "budget_tips": {
    "free_tactics": ["<gratis taktikk 1>", "<gratis taktikk 2>", "<gratis taktikk 3>"],
    "paid_options": [
      {"tactic": "<betalt taktikk>", "estimated_cost": "<kostnad>", "expected_result": "<resultat>"},
      {"tactic": "<taktikk>", "estimated_cost": "<kostnad>", "expected_result": "<resultat>"}
    ]
  },
  "meta_ads": {
    "campaign_objective": "<best Meta Ads objective for this track>",
    "ad_copy_variations": [
      {"headline": "<headline>", "primary_text": "<primary text>", "cta": "<call to action>"},
      {"headline": "<headline>", "primary_text": "<primary text>", "cta": "<call to action>"}
    ],
    "targeting": {
      "age_range": "<age range>",
      "interests": ["<interest1>", "<interest2>", "<interest3>", "<interest4>"],
      "lookalike_suggestion": "<lookalike audience suggestion>",
      "excluded_audiences": "<who to exclude>"
    },
    "budget_recommendation": "<daily budget recommendation with reasoning>",
    "ad_format": "<recommended ad format (video, carousel, etc.)>",
    "creative_direction": "<specific visual direction for the ad>"
  },
  "key_metrics": ["<metrikk å følge med på 1>", "<metrikk 2>", "<metrikk 3>", "<metrikk 4>"],
  "common_mistakes": ["<feil å unngå 1>", "<feil 2>", "<feil 3>"]
}`;

  const userPrompt = `Create a detailed 4-week launch plan for this track. Be EXTREMELY specific — the artist should be able to follow it day by day without googling anything.

Title: "${track.title}"
Artist: ${track.artist}
Genre: ${track.genre || analysis.genre_fit || 'Unknown'}
Similar artists: ${track.similar_artists || refs.map(r => r.name).join(', ') || 'Unknown'}
Main goal: ${track.main_goal || 'Get the most streams possible'}
Mood: ${moods.join(', ') || 'Unknown'}
Energy: ${analysis.energy_percent || 50}%
Tempo: ${analysis.tempo_bpm || 120} BPM
Audience: ${analysis.audience_age || '18-28'}, ${analysis.audience_platforms || 'TikTok, Spotify'}
${track.lyrics ? `
SONG LYRICS — use these to understand what the song is ABOUT:
${track.lyrics}

The promo plan MUST be built around the song's actual THEMES and EMOTIONS from the lyrics. Do NOT just use the title as a gimmick. The content strategy should capture the FEELING of the song and turn it into relatable, shareable moments.` : ''}

IMPORTANT RULES:
- The song title can be used for hashtags, but content ideas must come from the song's MOOD, ENERGY and LYRICAL THEMES — not just wordplay on the title
- Which SPECIFIC Spotify playlists (name real ones) match this song's mood and genre?
- What is the SMARTEST rollout sequence? Not just "tease, release, promote"
- What unexpected platforms or communities could this music reach?
- What should the artist NOT do that most new artists get wrong?

For each day-task: Give a complete recipe. Not just "make a TikTok" — describe the concept, the hook (first 2 seconds), and the visual style. Every piece of content should be designed to make viewers FEEL the same emotion as the song.

For Meta Ads: Create ad copy that captures the song's emotional core, not just promotes it generically. Target audiences who would relate to the themes in the lyrics.

IMPORTANT: Include a complete Meta Ads section with:
- 2 ad copy variations (headline + primary text + CTA) ready to paste into Meta Ads Manager
- Specific audience targeting (age, interests, lookalikes, exclusions)
- Daily budget recommendation with reasoning
- Recommended ad format and creative direction

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

// ── FALLBACK ────────────────────────────────────────────
function getFallback(msg) {
  return {
    tempo_bpm: 124, tempo_description: 'Danceable, mid-energy pace',
    mood_tags: JSON.stringify(['Melancholic', 'Dreamy', 'Reflective']),
    energy_percent: 72, energy_description: 'Strong emotional build',
    genre_fit: 'Alt-pop / indie electronic', audience_age: '18-28',
    audience_interests: 'indie pop, aesthetics, late-night playlists',
    audience_platforms: 'TikTok, Instagram Reels, Spotify',
    audience_content_angle: 'relatable lyrics + mood-based visuals',
    audience_key_insight: msg || 'Fallback demo-data.',
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
      { title: 'Studio Process', difficulty: 'Easy', duration: '30-60 sec', virality: 85, description: 'Film yourself working.', howTo: ['Cameras','Speed up','Authentic'], hashtags: '#studiolife' },
      { title: 'Before vs. After', difficulty: 'Medium', duration: '15-30 sec', virality: 78, description: 'Split-screen comparison.', howTo: ['Two versions','CapCut','Text'], hashtags: '#beforeandafter' },
      { title: 'Lyric Writing', difficulty: 'Easy', duration: '15-30 sec', virality: 72, description: 'Top-down lyric writing.', howTo: ['Overhead','Natural','Close-up'], hashtags: '#songwriter' },
      { title: 'First Reaction', difficulty: 'Easy', duration: '30-60 sec', virality: 68, description: 'Friends react.', howTo: ['Authentic','Timestamps','Anticipation'], hashtags: '#reaction' },
    ]),
    pro_tip: 'Fallback-data.', creator_tip: 'Sjekk Terminal for feilmelding.',
    model_used: 'fallback', status: 'completed', completed_at: new Date().toISOString(),
  };
}
