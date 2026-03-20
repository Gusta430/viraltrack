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
export async function analyzeTrack(track) {
  const systemPrompt = `You are an extremely experienced music marketer with 15+ years in the music industry. You have worked with artists from bedroom pop to trap, and you know EXACTLY what separates generic advice from advice that actually delivers results. IMPORTANT: Always respond in English.

RULES YOU MUST FOLLOW:
- NEVER give generic advice like "post consistently" or "engage with your audience" — everyone knows this already
- NEVER suggest "behind the scenes" videos or "studio session" clips unless you have a SPECIFIC, UNIQUE angle on it
- All suggestions MUST be directly tied to this specific track's title, mood, or genre
- Video ideas must contain CONCRETE scenarios, not vague descriptions. Describe exactly what happens in the video second by second
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

  const userPrompt = `Analyze this track og lag en UNIK promo-strategi som denne artisten ikke ville funnet noe annet sted:

Tittel: "${track.title}"
Artist: ${track.artist}
${track.genre ? `Sjanger: ${track.genre}` : ''}
${track.similar_artists ? `Lignende artister: ${track.similar_artists}` : ''}
${track.main_goal ? `Hovedmål: ${track.main_goal}` : ''}
${track.want_tiktok_content ? 'Ønsker TikTok/Reels-innhold.' : ''}

TENK GJENNOM DETTE FØR DU SVARER:
1. Hva er det med TITTELEN "${track.title}" som kan brukes kreativt i markedsføring? Kan tittelen bli en trend, et konsept, eller en hook?
2. Basert på sjangeren og lignende artister — hva er det SPESIFIKKE soniske landskapet? Ikke bare "indie pop", men hvilken FØLELSE og VISUELL ESTETIKK passer?
3. Hvilke KONKRETE TikTok-trender akkurat nå kan denne låten passe inn i? Tenk på spesifikke lyder, formater og memes.
4. Hva gjør artister i denne nisjen FEIL med markedsføring, og hvordan kan vi gjøre det MOTSATTE?

For video-ideer: Beskriv hvert videoklipp som en mini-fortelling. Hva skjer i starten? Hva er "plottwisten" eller øyeblikket som får folk til å se om igjen? Tenk som en kreativ regissør, ikke en markedsfører.

For DIY-ideer: Tenk utenfor boksen. Ingen "film deg selv i studio" med mindre det har en HELT NY TWIST. Hva kan artisten gjøre som er overraskende, morsomt, emosjonelt, eller kontroversiellt (på en god måte)?

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
      model_used: 'claude-sonnet-4-20250514', status: 'completed', completed_at: new Date().toISOString(),
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
    "approach": "<strategi for å komme på spillelister>",
    "target_playlists": ["<spilleliste1>", "<spilleliste2>", "<spilleliste3>", "<spilleliste4>", "<spilleliste5>"],
    "pitch_tips": "<tips for å pitche til kuratorer>"
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

  const userPrompt = `Create a detailed 4-ukers launch plan for this track som er SÅ SPESIFIKK at artisten kan følge den dag for dag uten å google noe:

Tittel: "${track.title}"
Artist: ${track.artist}
Sjanger: ${track.genre || analysis.genre_fit || 'Ukjent'}
Lignende artister: ${track.similar_artists || refs.map(r => r.name).join(', ') || 'Ukjent'}
Hovedmål: ${track.main_goal || 'Få flest mulig streams'}
Stemning: ${moods.join(', ') || 'Ukjent'}
Energi: ${analysis.energy_percent || 50}%
Tempo: ${analysis.tempo_bpm || 120} BPM
Målgruppe: ${analysis.audience_age || '18-28'}, ${analysis.audience_platforms || 'TikTok, Spotify'}

TENK PÅ DETTE:
- Hvordan kan låttittelen "${track.title}" bli en hashtag, trend, eller konsept som folk bruker?
- Hvilke SPESIFIKKE Spotify-spillelister (nevn ekte navn) passer denne låtens stemning og sjanger?
- Hva er den SMARTESTE rekkefølgen å rulle ut innhold? Ikke bare "tease → release → promote"
- Hvilke uventede plattformer eller communities kan denne musikken treffe?
- Hva bør artisten IKKE gjøre som de fleste nye artister gjør feil?

For each day-task: Give a complete recipe. Not just "make a TikTok" — describe the concept, hook, and visual style.

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
