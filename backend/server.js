import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execFile, execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import db from './db.js';
import { analyzeTrack, generatePromoPlan, regenerateSection } from './ai-service.js';
import { analyzeAudio } from './audio-analysis.js';
import { getTrends, refreshTrends, formatTrendsForPrompt } from './trend-service.js';
import { checkAnalysis, checkPromoPlan, checkRegenerate, checkVideoGeneration, recordAnalysis, recordPromoPlan, recordRegenerate, recordVideoGeneration, getUsageStats } from './rate-limiter.js';

// Check FFmpeg availability — try ffmpeg-static first, then system ffmpeg
let FFMPEG_BIN = null;
function testFfmpeg(bin) {
  try {
    // Fix permissions if needed (ffmpeg-static sometimes lacks +x)
    try { fs.chmodSync(bin, 0o755); } catch(e) {}
    const out = execFileSync(bin, ['-version'], { timeout: 5000, stdio: 'pipe' }).toString();
    const ver = out.split('\n')[0];
    console.log(`🎬 FFmpeg OK: ${bin} → ${ver}`);
    return true;
  } catch(e) { return false; }
}
if (ffmpegPath && testFfmpeg(ffmpegPath)) {
  FFMPEG_BIN = ffmpegPath;
} else if (testFfmpeg('/usr/bin/ffmpeg')) {
  FFMPEG_BIN = '/usr/bin/ffmpeg';
} else if (testFfmpeg('ffmpeg')) {
  FFMPEG_BIN = 'ffmpeg';
} else {
  console.log('⚠️ No working FFmpeg found — videos will be images only');
}

// Check ImageMagick availability (for burning lyrics onto images)
let MAGICK_BIN = null;
for (const bin of ['magick', 'convert', '/usr/bin/convert']) {
  try {
    execFileSync(bin, ['-version'], { timeout: 5000, stdio: 'pipe' });
    MAGICK_BIN = bin;
    console.log(`🖼️ ImageMagick OK: ${bin}`);
    break;
  } catch(e) {}
}
if (!MAGICK_BIN) console.log('⚠️ No ImageMagick found — lyrics won\'t appear in video');

// Find a usable font file
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];
let LYRICS_FONT = '';
for (const fp of FONT_CANDIDATES) { if (fs.existsSync(fp)) { LYRICS_FONT = fp; break; } }
console.log('🔤 Lyrics font:', LYRICS_FONT || 'none');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, '..', 'frontend', 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const VIDS_DIR = path.join(__dirname, 'data', 'videos');
const FONTS_DIR = path.join(__dirname, 'data', 'fonts');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(VIDS_DIR, { recursive: true });
fs.mkdirSync(FONTS_DIR, { recursive: true });

// Download Poppins Bold font if not available on this system
const POPPINS_BOLD = path.join(FONTS_DIR, 'Poppins-Bold.ttf');
const POPPINS_URL = 'https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf';
function ensureFont() {
  // Check system paths first
  const systemPaths = [
    '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf',
    '/usr/share/fonts/truetype/poppins/Poppins-Bold.ttf',
  ];
  for (const sp of systemPaths) { if (fs.existsSync(sp)) { console.log('🔤 Font found:', sp); return; } }
  // Check local copy
  if (fs.existsSync(POPPINS_BOLD) && fs.statSync(POPPINS_BOLD).size > 10000) {
    console.log('🔤 Font found:', POPPINS_BOLD); return;
  }
  // Download it
  console.log('🔤 Downloading Poppins-Bold font...');
  https.get(POPPINS_URL, (resp) => {
    if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
      https.get(resp.headers.location, (r2) => {
        if (r2.statusCode >= 300 && r2.statusCode < 400 && r2.headers.location) {
          https.get(r2.headers.location, (r3) => { r3.pipe(fs.createWriteStream(POPPINS_BOLD)); r3.on('end', () => console.log('🔤 Font downloaded')); });
        } else { r2.pipe(fs.createWriteStream(POPPINS_BOLD)); r2.on('end', () => console.log('🔤 Font downloaded')); }
      });
    } else { resp.pipe(fs.createWriteStream(POPPINS_BOLD)); resp.on('end', () => console.log('🔤 Font downloaded')); }
  }).on('error', (e) => console.log('⚠️ Font download failed:', e.message));
}
ensureFont();

// ── LYRICS VIDEO (fal.ai FLUX images + FFmpeg) ──
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        file.close(); fs.unlinkSync(dest);
        return downloadFile(resp.headers.location, dest).then(resolve).catch(reject);
      }
      if (resp.statusCode >= 400) {
        file.close(); fs.unlink(dest, () => {});
        return reject(new Error(`Download failed: HTTP ${resp.statusCode}`));
      }
      resp.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// Generate a single image via fal.ai FLUX schnell (sync API, ~1-2 sec)
function generateImage(falKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      prompt,
      aspect_ratio: "9:16",
      num_images: 1
    });
    const opts = {
      hostname: 'fal.run',
      path: '/fal-ai/flux-pro/v1.1-ultra',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Key ' + falKey,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const r = https.request(opts, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const url = data.images?.[0]?.url;
          if (url) resolve(url);
          else reject(new Error('No image URL: ' + JSON.stringify(data).substring(0, 300)));
        } catch(e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

// Run a single FFmpeg command — returns a promise
function ffmpegRun(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const bin = FFMPEG_BIN || 'ffmpeg';
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        // Show more stderr context for debugging — find the actual error line
        if (stderr) {
          const lines = stderr.split('\n');
          const errorLine = lines.find(l => /error|not found|invalid|no such/i.test(l)) || '';
          const tail = stderr.substring(Math.max(0, stderr.length - 800));
          console.error('FFmpeg error detail:', errorLine);
          reject(new Error(errorLine || tail));
        } else {
          reject(new Error(err.message));
        }
      } else resolve();
    });
  });
}

// Check if drawtext filter is available in this FFmpeg build
let HAS_DRAWTEXT = false;
if (FFMPEG_BIN) {
  try {
    const out = execFileSync(FFMPEG_BIN, ['-filters'], { timeout: 5000, stdio: 'pipe' }).toString();
    HAS_DRAWTEXT = out.includes('drawtext');
    console.log(`🔤 FFmpeg drawtext filter: ${HAS_DRAWTEXT ? 'available' : 'NOT available'}`);
  } catch(e) { console.log('⚠️ Could not check FFmpeg filters'); }
}

// Burn lyric text onto an image using ImageMagick (no FFmpeg drawtext needed)
function burnTextOnImage(inputPath, outputPath, text) {
  return new Promise((resolve, reject) => {
    if (!MAGICK_BIN || !LYRICS_FONT) return resolve(false);
    // Use caption: to auto-wrap text within a box that fits inside the frame
    // 640px wide (720 - 80px padding) centered in the lower third of the image
    const args = [
      inputPath,
      '-resize', '720x1280!',
      // Create a text overlay that auto-wraps within 640px width
      '(', '-size', '640x', '-background', 'none',
        '-font', LYRICS_FONT, '-pointsize', '40',
        '-fill', 'white', '-stroke', 'black', '-strokewidth', '3',
        '-gravity', 'center', `caption:${text}`,
      ')',
      // Composite the text onto the image, centered horizontally, in the lower third
      '-gravity', 'south', '-geometry', '+0+180',
      '-composite',
      outputPath
    ];
    execFile(MAGICK_BIN, args, { timeout: 15000 }, (err) => {
      if (err) { console.log('⚠️ ImageMagick failed:', err.message); resolve(false); }
      else resolve(true);
    });
  });
}

// Build lyrics video using concat demuxer approach (low memory, works on any host)
// Step 1: burn lyrics onto images with ImageMagick + scale to 720x1280
// Step 2: convert each image to a short clip
// Step 3: concat clips into final video
async function createLyricsVideo(imagePaths, outputPath, lyricLines, totalDuration) {
  const W = 720, H = 1280;
  const numImages = imagePaths.length;

  // ── Proportional timing: longer bars get more time, shorter ones get less ──
  // This makes the video feel like natural speech/rap rhythm
  const charCounts = [];
  let totalChars = 0;
  for (let i = 0; i < numImages; i++) {
    const chars = (lyricLines && lyricLines[i]) ? lyricLines[i].length : 20;
    charCounts.push(chars);
    totalChars += chars;
  }
  // Calculate duration per clip proportional to character count
  const durations = charCounts.map(c => {
    const proportion = c / Math.max(1, totalChars);
    const raw = proportion * totalDuration;
    // Clamp each clip between 1.2s and 5s
    return Math.max(1.2, Math.min(5.0, raw));
  });
  // Normalize so total matches totalDuration exactly
  const rawTotal = durations.reduce((a, b) => a + b, 0);
  const scale = totalDuration / rawTotal;
  const finalDurations = durations.map(d => (d * scale).toFixed(2));

  console.log(`🎵 Per-line timing: ${finalDurations.map((d, i) => `"${(lyricLines[i] || '').substring(0, 20)}…" → ${d}s`).join(' | ')}`);

  const clipPaths = [];
  const tempPaths = [];
  const dir = path.dirname(outputPath);

  for (let i = 0; i < numImages; i++) {
    const lyric = (lyricLines && lyricLines[i]) ? lyricLines[i] : '';
    let imgToUse = imagePaths[i];

    // ── STEP 1: Burn lyric text onto image with ImageMagick ──
    if (lyric && MAGICK_BIN && LYRICS_FONT) {
      const burnedPath = path.join(dir, path.basename(outputPath, '.mp4') + `-burned${i}.png`);
      const ok = await burnTextOnImage(imagePaths[i], burnedPath, lyric);
      if (ok && fs.existsSync(burnedPath) && fs.statSync(burnedPath).size > 500) {
        imgToUse = burnedPath;
        tempPaths.push(burnedPath);
        console.log(`🔤 Lyrics burned on image ${i}`);
      }
    }

    // ── STEP 2: Image → video clip ──
    const clipPath = path.join(dir, path.basename(outputPath, '.mp4') + `-clip${i}.mp4`);
    clipPaths.push(clipPath);

    // If ImageMagick already resized, we just need to encode.
    // If not (no lyrics or failed), we need to scale with FFmpeg.
    const vf = imgToUse === imagePaths[i]
      ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
      : `setsar=1`;

    await ffmpegRun([
      '-y', '-loop', '1', '-t', finalDurations[i], '-i', imgToUse,
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '25',
      clipPath
    ]);
    console.log(`🎬 Clip ${i}/${numImages} done`);
  }

  // ── STEP 3: Concat all clips into final video ──
  const listPath = path.join(dir, path.basename(outputPath, '.mp4') + '-list.txt');
  fs.writeFileSync(listPath, clipPaths.map(p => `file '${p}'`).join('\n'));

  await ffmpegRun([
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    outputPath
  ]);
  console.log('🎬 Video concatenated — done');

  // Cleanup temp files
  clipPaths.forEach(p => fs.unlink(p, () => {}));
  tempPaths.forEach(p => fs.unlink(p, () => {}));
  fs.unlink(listPath, () => {});
}

// Background process: generate images → save URLs → try FFmpeg slideshow → update DB
// Analyze lyrics to generate scene descriptions that match the song's vibe
function buildScenePrompts(lyricLines, genre, title, artist, moodTags) {
  const allLyrics = lyricLines.join(' ').toLowerCase();
  const moods = (moodTags || []).join(' ').toLowerCase();
  const genreLow = (genre || '').toLowerCase();
  const titleLow = (title || '').toLowerCase();

  // Detect vibes from lyrics content
  const vibeKeywords = {
    beach: /beach|ocean|wave|summer|sun|sand|coast|shore|surf|palm|island|tropical|paradise|swim/,
    party: /party|club|dance|night|vip|bottle|champagne|lit|turnt|drink|bar|rave|dj|bass drop/,
    luxury: /flex|money|cash|drip|ice|chain|watch|lambo|ferrari|gucci|designer|rich|band|stack|foreign|whip|benz|rolls|rolex/,
    street: /trap|block|hood|street|gang|hustle|grind|plug|real|savage|pull up|slide|opps/,
    love: /love|heart|kiss|baby|babe|hold|touch|feel|miss|forever|together|mine|yours|us/,
    heartbreak: /cry|tears|gone|leave|lost|broke|pain|hurt|alone|empty|ghost|forget|remember/,
    night: /night|dark|moon|star|city|light|glow|neon|downtown|drive|late/,
    nature: /mountain|river|forest|rain|sky|cloud|wind|earth|field|flower|garden|tree/,
    hype: /fire|flame|hot|burn|explode|boom|energy|power|beast|king|queen|goat|legend/,
    chill: /chill|vibe|relax|smoke|high|float|dream|peace|calm|easy|slow|sunset/,
  };

  const detectedVibes = [];
  for (const [vibe, regex] of Object.entries(vibeKeywords)) {
    if (regex.test(allLyrics) || regex.test(moods) || regex.test(genreLow) || regex.test(titleLow)) {
      detectedVibes.push(vibe);
    }
  }

  // Genre-based scene defaults — candid real moments
  const genreScenes = {
    'hip hop': ['someone leaning on a nice car in a dimly lit parking garage', 'studio session with someone behind the mic and red light on', 'group of friends walking through city streets at night', 'crowd at a hip hop show with hands in the air', 'someone counting money on a hotel bed', 'sneakers and chains laid out on a bed'],
    'hip-hop': ['someone leaning on a nice car in a dimly lit parking garage', 'studio session with someone behind the mic and red light on', 'group of friends walking through city streets at night', 'crowd at a hip hop show with hands in the air', 'someone counting money on a hotel bed'],
    'rap': ['someone recording in a dim studio with red lights', 'expensive car on a dark street with headlights on', 'someone showing off jewelry and watches closeup', 'mosh pit at a rap concert crowd going crazy', 'late night drive through the city from inside the car'],
    'trap': ['dark street corner with neon store signs at night', 'someone sitting on the hood of a car at a gas station', 'gold chains and designer clothes on a messy bed', 'concert crowd moshing with flash photography', 'purple LED lights in a room with smoke', 'fast food and cash on a car dashboard at night'],
    'r&b': ['couple slow dancing in a living room with warm light', 'someone lying in bed staring at the ceiling', 'rain on a window with blurry city lights behind', 'candles and wine glasses on a table set for two', 'couple asleep together on a couch with tv glow'],
    'rnb': ['couple slow dancing in a living room with warm light', 'someone lying in bed staring at the ceiling', 'rain on a window with blurry city lights behind', 'candles and wine glasses on a table set for two', 'couple asleep together on a couch with tv glow'],
    'pop': ['friends at a music festival with confetti falling', 'road trip selfie from a car window on a highway', 'someone dancing alone in their room with headphones', 'rooftop hangout with city lights at sunset', 'group of friends laughing at a diner late at night'],
    'reggaeton': ['pool party with people dancing', 'beach at sunset with music playing from a speaker', 'nightclub dance floor with colored lights', 'friends in a convertible with windows down on coast', 'someone dancing in a kitchen at a house party'],
    'country': ['old pickup truck parked on a dirt road at sunset', 'bonfire with friends sitting on tailgates', 'someone walking through a wheat field', 'small town main street with christmas lights', 'guitar leaning against a porch railing at sunset'],
    'rock': ['band playing in a garage with one overhead light', 'packed crowd at a rock show moshing', 'someone driving fast on a desert highway', 'graffiti covered alley with skateboards', 'someone stage diving at a small venue'],
    'edm': ['huge festival crowd with laser lights above', 'friends at a rave with glow sticks and face paint', 'dj booth from behind looking at massive crowd', 'someone dancing in a parking lot with car headlights', 'sunrise after a festival with tents and trash'],
    'indie': ['someone reading in a coffee shop window on a rainy day', 'film camera and old photos scattered on a table', 'empty street at night with puddles reflecting lights', 'wildflowers in an overgrown lot at golden hour', 'vinyl records and a turntable in a messy bedroom'],
    'afrobeats': ['crowded street party with people dancing', 'beach scene with colorful outfits and speakers', 'group dance circle at a celebration', 'busy market street with vibrant colors', 'sunset party with friends and good energy'],
    'latin': ['classic car parked on a colorful street', 'couple dancing under string lights at night', 'beach with palm trees and golden sunset', 'street food vendor at night with warm lighting', 'friends at an outdoor party with music and lights'],
  };

  // Vibe-based scene pools — candid real moments like from someone's old camera roll
  const vibeScenes = {
    beach: ['group of friends running into ocean waves at sunset', 'messy beach blanket with snacks and sunglasses left behind', 'someone caught mid-laugh sitting on the sand', 'blurry photo of friends doing cannonball into pool', 'sandy feet dangling off a pier with ocean below', 'friends in a convertible driving along coast road windows down', 'someone sleeping on a beach towel with sunburn', 'bonfire on beach with people sitting around at night'],
    party: ['blurry photo of people dancing in a dark club with flash', 'group photo at a house party someone has red eyes from flash', 'hands holding up drinks at a crowded bar', 'crowd at a concert everyone holding phones up', 'someone standing on a table at a party', 'backstage at a show with equipment and dim lighting', 'friends pregaming in a messy apartment', 'people leaving a club at 3am on a wet street'],
    luxury: ['someone leaning on an expensive car in a parking garage', 'wrist with gold watch and bracelets on a steering wheel', 'shopping bags from designer stores on car backseat', 'sneaker collection laid out on bedroom floor', 'stacks of cash on a kitchen counter', 'someone trying on chains in a jewelry store', 'bottle service table at a club with sparklers', 'brand new shoes still in the box on a doorstep'],
    street: ['group of guys hanging out on a street corner at night', 'someone walking alone down a dark alley with one streetlight', 'bikes and cars parked outside a corner store', 'graffiti wall with someone standing in front of it', 'basketball game on an outdoor court under lights', 'someone recording on their phone from a car window', 'foggy street with tail lights disappearing', 'fast food wrappers on the hood of a parked car at night'],
    love: ['couple from behind walking down an empty road holding hands', 'someone asleep on their partners shoulder on a bus', 'two people sharing earbuds sitting on stairs', 'blurry selfie of a couple kissing with flash', 'handwritten note left on a pillow', 'two pairs of shoes by a front door', 'couple watching sunset from a car hood', 'someone putting a jacket around someone else in the cold'],
    heartbreak: ['empty passenger seat with the seatbelt still buckled', 'someone sitting alone on a curb at night under streetlight', 'phone screen showing missed calls in the dark', 'rain on a car windshield in a parking lot at night', 'empty side of a bed with messy sheets', 'old polaroid photo lying on a table', 'someone walking away down a long hallway', 'wilted flowers on a kitchen counter'],
    night: ['blurry city lights from inside a moving car', 'empty gas station at 2am with fluorescent lights', 'someone smoking on a fire escape overlooking the city', 'car dashboard at night with highway lights streaking', 'convenience store glow on a dark empty street', 'friends in the backseat of a car at night laughing', 'foggy parking lot with one car under a lamp', 'silhouette in a window with city lights behind'],
    nature: ['someone hiking on a mountain trail looking at the view', 'campfire with marshmallows and peoples legs around it', 'rain hitting a puddle on a dirt road', 'someone lying in tall grass staring at the sky', 'view from a car window of mountains and clouds', 'sunrise through a tent opening at a campsite', 'someone standing at the edge of a cliff looking out', 'dog running through a field at golden hour'],
    hype: ['crowd going absolutely crazy at a concert pit', 'someone celebrating with arms raised on a rooftop', 'group of friends hyping someone up before they go on stage', 'fireworks reflected in someones sunglasses', 'burnout marks on pavement next to a muscle car', 'athlete crossing finish line with crowd cheering', 'flash photo of someone flexing in a gym mirror', 'crowd surfing at a festival'],
    chill: ['someone lying on a couch with tv glow on their face', 'record player spinning in a room with warm lamplight', 'feet up on a balcony railing watching the sunset', 'smoke rising from an ashtray in dim moody light', 'cat sleeping on someones lap while they watch tv', 'messy desk with laptop open and coffee mug', 'someone staring out a window on a rainy day', 'empty swing swaying at a playground at dusk'],
  };

  // Build scene list: match lyrics line-by-line to scenes
  const scenes = [];
  const numImages = Math.min(Math.max(3, lyricLines.length), 6);

  // First, try to match each lyric line to a vibe
  for (let i = 0; i < numImages; i++) {
    const line = lyricLines[i % lyricLines.length].toLowerCase();
    let bestScene = null;

    // Check which vibe this specific line matches
    for (const [vibe, regex] of Object.entries(vibeKeywords)) {
      if (regex.test(line) && vibeScenes[vibe]) {
        const pool = vibeScenes[vibe];
        bestScene = pool[i % pool.length];
        break;
      }
    }

    // Fall back to detected vibes from full song
    if (!bestScene && detectedVibes.length > 0) {
      const vibe = detectedVibes[i % detectedVibes.length];
      if (vibeScenes[vibe]) {
        bestScene = vibeScenes[vibe][i % vibeScenes[vibe].length];
      }
    }

    // Fall back to genre scenes
    if (!bestScene) {
      const genreKey = Object.keys(genreScenes).find(g => genreLow.includes(g));
      if (genreKey) {
        bestScene = genreScenes[genreKey][i % genreScenes[genreKey].length];
      }
    }

    // Ultimate fallback
    if (!bestScene) {
      const fallback = ['blurry city lights from a moving car at night', 'group of friends caught mid laugh at a party', 'someone walking alone on an empty street at night', 'sunset seen through a dirty car windshield', 'empty room with just a window and warm light coming in', 'convenience store parking lot at 2am with fluorescent glow'];
      bestScene = fallback[i % fallback.length];
    }

    scenes.push(bestScene);
  }

  // Make sure we don't repeat the exact same scene
  const uniqueScenes = [...new Set(scenes)];
  while (uniqueScenes.length < numImages) {
    const vibe = detectedVibes[uniqueScenes.length % Math.max(1, detectedVibes.length)] || 'night';
    const pool = vibeScenes[vibe] || vibeScenes.night;
    uniqueScenes.push(pool[uniqueScenes.length % pool.length]);
  }

  return uniqueScenes.slice(0, numImages);
}

async function processVideoGeneration(videoId, lyricLines, falKey, genre, songContext, audioFilePath = null) {
  try {
    const { title, artist, mood_tags } = songContext || {};
    console.log(`🎬 Starting generation ${videoId}: ${lyricLines.length} lyrics, genre: ${genre}, title: ${title}`);

    // Generate scene-matched images based on lyrics content
    const scenePrompts = buildScenePrompts(lyricLines, genre, title, artist, mood_tags);
    const numImages = scenePrompts.length;

    const imagePromises = [];
    for (let i = 0; i < numImages; i++) {
      const imgPrompt = `Amateur photo taken on a cheap digital camera or old camcorder, ${scenePrompts[i]}. Low resolution feel, slightly overexposed, flash photography, red eye, timestamp in corner aesthetic, 2000s disposable camera vibes, grainy, not professional, real candid moment caught on tape, no text no words no letters no watermarks. Vertical 9:16.`;
      console.log(`📸 Image ${i}: ${scenePrompts[i]}`);
      imagePromises.push(generateImage(falKey, imgPrompt));
    }

    console.log(`📸 Generating ${numImages} images via FLUX...`);
    const imageUrls = await Promise.all(imagePromises);
    console.log(`📸 All ${numImages} images generated:`, imageUrls.map(u => u.substring(0, 60)));

    // Save images to DB — use status 'building_video' so frontend knows MP4 is still coming
    await db.updateVideoGeneration(videoId, {
      status: 'building_video',
      image_urls: JSON.stringify(imageUrls),
      video_url: ''
    });
    console.log(`✅ Images saved to DB — now building MP4...`);

    // ── Build MP4 video with FFmpeg ──
    if (!FFMPEG_BIN) {
      console.log(`⚠️ No FFmpeg available — marking completed with images only`);
      await db.updateVideoGeneration(videoId, { status: 'completed' });
      return;
    }

    await buildVideoFromImages(videoId, imageUrls, lyricLines, songContext, audioFilePath);

  } catch (err) {
    console.error(`❌ Video ${videoId} failed:`, err.message);
    await db.updateVideoGeneration(videoId, { status: 'error', error_message: err.message || 'Generation failed' }).catch(() => {});
  }
}

// Separated so it can be called from recovery too
async function buildVideoFromImages(videoId, imageUrls, lyricLines, songContext, audioFilePath = null) {
  try {
    console.log(`🎬 Building MP4 with FFmpeg: ${FFMPEG_BIN}`);

    // Download images to disk
    const imagePaths = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const imgPath = path.join(VIDS_DIR, `${videoId}-img${i}.png`);
      // Skip download if already on disk (recovery case)
      if (fs.existsSync(imgPath) && fs.statSync(imgPath).size > 100) {
        console.log(`📥 Image ${i} already on disk (${(fs.statSync(imgPath).size/1024).toFixed(0)}KB)`);
      } else {
        await downloadFile(imageUrls[i], imgPath);
        if (!fs.existsSync(imgPath) || fs.statSync(imgPath).size < 100) {
          throw new Error(`Image ${i} download failed or empty`);
        }
        console.log(`📥 Image ${i} downloaded (${(fs.statSync(imgPath).size/1024).toFixed(0)}KB)`);
      }
      imagePaths.push(imgPath);
    }

    // ── BPM-aware timing ──
    const bpm = (songContext && songContext.bpm) || 120;
    const beatsPerBar = 4;
    const barsPerLine = 2;
    const secondsPerLine = (beatsPerBar * barsPerLine * 60) / bpm;
    const clampedSecondsPerLine = Math.max(1.5, Math.min(4.0, secondsPerLine));
    const totalDuration = Math.max(8, imagePaths.length * clampedSecondsPerLine);
    console.log(`🎵 Timing: BPM=${bpm}, ${clampedSecondsPerLine.toFixed(2)}s per line, total=${totalDuration.toFixed(1)}s`);

    const silentPath = path.join(VIDS_DIR, `${videoId}-silent.mp4`);
    const outputPath = path.join(VIDS_DIR, `${videoId}-lyrics.mp4`);

    // Build silent video first
    await createLyricsVideo(imagePaths, silentPath, lyricLines, totalDuration);

    if (!fs.existsSync(silentPath) || fs.statSync(silentPath).size < 1000) {
      console.log('⚠️ Silent video missing or too small — marking completed with images only');
      await db.updateVideoGeneration(videoId, { status: 'completed' });
      imagePaths.forEach(p => fs.unlink(p, () => {}));
      return;
    }

    // ── MUX AUDIO onto video ──
    if (audioFilePath && fs.existsSync(audioFilePath)) {
      try {
        const audioStartSec = (songContext && songContext.audioStartSec) || 0;
        console.log(`🎵 Muxing audio from ${path.basename(audioFilePath)} (seek to ${audioStartSec}s) onto video...`);
        // Combine video + audio, seek into the audio so lyrics match, trim to video length
        const ffArgs = ['-y', '-i', silentPath];
        // -ss before -i for fast seek on the audio input
        if (audioStartSec > 0) ffArgs.push('-ss', String(audioStartSec));
        ffArgs.push(
          '-i', audioFilePath,
          '-c:v', 'copy',
          '-c:a', 'aac', '-b:a', '192k',
          '-t', totalDuration.toFixed(2),
          '-shortest',
          '-movflags', '+faststart',
          outputPath
        );
        await ffmpegRun(ffArgs);
        console.log(`🎵 Audio muxed successfully (offset: ${audioStartSec}s)`);
        // Clean up silent version
        fs.unlink(silentPath, () => {});
        // Clean up the source audio file — we don't keep artist music
        fs.unlink(audioFilePath, () => {});
      } catch (audioErr) {
        console.log(`⚠️ Audio mux failed: ${audioErr.message} — using silent video`);
        // Fall back to silent video
        if (fs.existsSync(silentPath)) {
          fs.renameSync(silentPath, outputPath);
        }
      }
    } else {
      // No audio file — just rename the silent video
      console.log(`🎬 No audio file available — video will be silent`);
      fs.renameSync(silentPath, outputPath);
    }

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      const mb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
      console.log(`✅ MP4 ready (${mb}MB) — updating DB`);
      await db.updateVideoGeneration(videoId, { status: 'completed', video_url: `/api/videos/${videoId}/file` });
    } else {
      console.log('⚠️ Output file missing or too small — marking completed with images only');
      await db.updateVideoGeneration(videoId, { status: 'completed' });
    }

    // Cleanup source images
    imagePaths.forEach(p => fs.unlink(p, () => {}));
  } catch (buildErr) {
    console.error(`⚠️ Video build failed for ${videoId}:`, buildErr.message);
    // Still mark completed so user sees images as fallback
    await db.updateVideoGeneration(videoId, { status: 'completed' }).catch(() => {});
  }
}

// ── BEAT VISUALIZER (waveform pulse video for producers) ──
async function createBeatVisualizer(videoId, audioFilePath, songContext) {
  try {
    const { title, artist, bpm, audioStartSec } = songContext || {};
    const genre = songContext.genre || '';
    const key = songContext.key || '';
    const duration = 15; // TikTok-optimal: 15 seconds
    const seekSec = audioStartSec || 0;

    console.log(`🎵 Creating beat visualizer for "${title}" by ${artist} (BPM: ${bpm}, seek: ${seekSec}s)`);

    const outputPath = path.join(VIDS_DIR, `${videoId}-beat.mp4`);

    // ── Build FFmpeg filter complex for waveform pulse visualization ──
    // Vertical 9:16 (720x1280), dark background, pulsing waveform, text overlays
    const W = 720, H = 1280;

    // Escape text for FFmpeg drawtext (single quotes, colons, backslashes)
    const esc = (s) => (s || '').replace(/\\/g, '\\\\\\\\').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\\\:').replace(/%/g, '%%');
    const safeTitle = esc(title);
    const safeArtist = esc(artist);
    const safeBpm = esc(`${bpm || '?'} BPM`);
    const safeKey = key ? esc(`Key: ${key}`) : '';
    const safeGenre = esc(genre);

    // Find available font
    const fontPaths = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ];
    const FN = fontPaths.find(f => fs.existsSync(f)) || '';
    const FB = fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
      ? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' : FN;
    const useText = HAS_DRAWTEXT && FN;

    console.log(`🎵 Beat visualizer drawtext: ${useText ? 'yes' : 'no'}`);

    // Build the filter graph:
    // 1. showwaves creates a waveform visualization from the audio
    // 2. We overlay it centered on a dark background
    // 3. Text overlays for title, artist, BPM, genre (if drawtext available)
    const parts = [
      // Create dark background
      `color=c=#09090b:s=${W}x${H}:d=${duration}:r=30[bg]`,
      // Create waveform visualization — single line mode, gold color, centered
      `[0:a]showwaves=s=${W - 80}x200:mode=cline:rate=30:colors=#c9a227|#c9a22744:scale=sqrt[wave]`,
      // Overlay waveform on background, centered vertically
      `[bg][wave]overlay=40:(${H}-200)/2:shortest=1[v1]`,
      // Add subtle glow line behind the waveform
      `[0:a]showwaves=s=${W - 60}x240:mode=cline:rate=30:colors=#c9a22718:scale=sqrt[glow]`,
      `[v1][glow]overlay=30:(${H}-240)/2:shortest=1[v2]`,
    ];

    let lastLabel = 'v2';
    let labelN = 2;

    if (useText) {
      const nextL = () => `v${++labelN}`;
      // Title text — large, centered, above waveform
      parts.push(`[${lastLabel}]drawtext=text='${safeTitle}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=${H/2 - 200}:fontfile=${FB}[${nextL()}]`);
      lastLabel = `v${labelN}`;
      // Artist name
      parts.push(`[${lastLabel}]drawtext=text='${safeArtist}':fontsize=28:fontcolor=#a1a1aa:x=(w-text_w)/2:y=${H/2 - 145}:fontfile=${FN}[${nextL()}]`);
      lastLabel = `v${labelN}`;
      // BPM badge
      parts.push(`[${lastLabel}]drawtext=text='${safeBpm}':fontsize=22:fontcolor=#c9a227:x=(w-text_w)/2:y=${H/2 + 200}:fontfile=${FB}[${nextL()}]`);
      lastLabel = `v${labelN}`;
      // Genre + Key
      const genreKeyText = `${safeGenre}${safeKey ? '  •  ' + safeKey : ''}`;
      if (genreKeyText.trim()) {
        parts.push(`[${lastLabel}]drawtext=text='${genreKeyText}':fontsize=18:fontcolor=#52525b:x=(w-text_w)/2:y=${H/2 + 235}:fontfile=${FN}[${nextL()}]`);
        lastLabel = `v${labelN}`;
      }
      // "Link in bio"
      parts.push(`[${lastLabel}]drawtext=text='${esc('link in bio')}':fontsize=16:fontcolor=#52525b:x=(w-text_w)/2:y=${H - 80}:fontfile=${FN}[${nextL()}]`);
      lastLabel = `v${labelN}`;
    }

    // Rename last label to vout
    const filterComplex = parts.join(';').replace(new RegExp(`\\[${lastLabel}\\]$`), '[vout]');

    const ffArgs = [
      '-y',
      '-ss', String(seekSec),
      '-i', audioFilePath,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-map', '0:a',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '192k',
      '-t', String(duration),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-shortest',
      outputPath
    ];

    await ffmpegRun(ffArgs, 180000); // 3 min timeout

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      const mb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
      console.log(`✅ Beat visualizer ready (${mb}MB)`);
      await db.updateVideoGeneration(videoId, { status: 'completed', video_url: `/api/videos/${videoId}/file` });
    } else {
      throw new Error('Output file missing or too small');
    }

    // Clean up source audio
    fs.unlink(audioFilePath, () => {});

  } catch (err) {
    console.error(`❌ Beat visualizer ${videoId} failed:`, err.message);
    await db.updateVideoGeneration(videoId, { status: 'error', error_message: 'Beat visualizer failed: ' + err.message }).catch(() => {});
  }
}

// ── DAW-STYLE VIDEO (fake DAW screen recording for producers) ──
async function createDAWVideo(videoId, audioFilePath, songContext) {
  try {
    const { title, artist, bpm, audioStartSec } = songContext || {};
    const genre = songContext.genre || '';
    const key = songContext.key || '';
    const dur = 15;
    const seek = audioStartSec || 0;
    const W = 720, H = 1280;

    // Find available font — check multiple paths
    const fontPaths = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    ];
    const FN = fontPaths.find(f => fs.existsSync(f)) || '';
    const FB = fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
      ? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' : FN;
    const FM = fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
      ? '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf' : FN;
    const useText = HAS_DRAWTEXT && FN;

    console.log(`🎹 Creating DAW video for "${title}" by ${artist} (drawtext: ${useText ? 'yes' : 'no'}, font: ${FN || 'none'})`);
    const outputPath = path.join(VIDS_DIR, `${videoId}-beat.mp4`);

    // FFmpeg drawtext escaping — escape characters that have special meaning
    const esc = (s) => (s || '')
      .replace(/\\/g, '\\\\\\\\')
      .replace(/'/g, "'\\\\\\''")
      .replace(/:/g, '\\\\:')
      .replace(/%/g, '%%')
      .replace(/\[/g, '\\\\[')
      .replace(/\]/g, '\\\\]')
      .replace(/;/g, '\\\\;');

    // Track definitions
    const tracks = [
      { name: 'DRUMS', c: '#e89522' }, { name: 'HI-HAT', c: '#4ecdc4' },
      { name: '808', c: '#ff6b6b' }, { name: 'MELODY', c: '#45b7d1' },
      { name: 'CHORDS', c: '#96ceb4' }, { name: 'FX', c: '#a06cd5' },
    ];

    // Layout constants
    const LW = 64, GX = LW, GW = W - GX - 8;
    const TH = 38, TG = 3;
    const TLH = 30;
    const AY = TLH, AH = tracks.length * (TH + TG) + 6;
    const WY = AY + AH + 8, WH = 130;
    const MY = WY + WH + 8, MB = H - 170, MH = MB - MY;
    const IY = MB + 24;

    // ── BPM-AWARE ARRANGEMENT ──
    const realBpm = bpm || 120;
    const beatsPerSec = realBpm / 60;
    const totalBeats = beatsPerSec * dur;
    const totalBars = Math.floor(totalBeats / 4);
    const barFrac = 1 / totalBars;

    function makeBlocks(trackIdx) {
      const blocks = [];
      switch (trackIdx) {
        case 0: for (let b = 0; b < totalBars; b += 4) { blocks.push([b * barFrac, Math.min(b + 3.9, totalBars) * barFrac]); } break;
        case 1: for (let b = 0; b < totalBars; b += 4) { blocks.push([(b + 0.1) * barFrac, Math.min(b + 3.8, totalBars) * barFrac]); } break;
        case 2: for (let b = 0; b < totalBars; b += 4) { blocks.push([b * barFrac, Math.min((b + 2) * barFrac, 1)]); if (b + 2.5 < totalBars) blocks.push([(b + 2.5) * barFrac, Math.min((b + 4) * barFrac, 1)]); } break;
        case 3: for (let b = 0; b < totalBars; b += 8) { blocks.push([b * barFrac, Math.min((b + 4) * barFrac, 1)]); if (b + 5 < totalBars) blocks.push([(b + 5) * barFrac, Math.min((b + 8) * barFrac, 1)]); } break;
        case 4: for (let b = 0; b < totalBars; b += 8) { blocks.push([b * barFrac, Math.min((b + 7) * barFrac, 1)]); } break;
        case 5: for (let b = 0; b < totalBars; b += 4) { blocks.push([(b + 3.5) * barFrac, Math.min((b + 4) * barFrac, 1)]); if (b === 0 || b % 8 === 0) blocks.push([b * barFrac, (b + 0.5) * barFrac]); } break;
      }
      return blocks.filter(([s, e]) => s < 1 && e > 0 && e - s > 0.005);
    }

    const mCh = ['KCK', 'SNR', 'HH', 'MEL', 'PAD', 'FX', 'MST'];
    const mW = Math.floor((W - 16) / mCh.length);

    // Filter chain builder
    const p = [];
    let ni = 0;
    const cv = () => `q${ni}`;
    const nv = () => `q${++ni}`;

    const box = (x, y, w, h, col) => p.push(`[${cv()}]drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${col}:t=fill[${nv()}]`);
    const boxE = (xE, y, w, h, col) => p.push(`[${cv()}]drawbox=x='${xE}':y=${y}:w=${w}:h=${h}:color=${col}:t=fill[${nv()}]`);
    const txt = (t, sz, col, x, y, f) => {
      if (!useText) return;
      p.push(`[${cv()}]drawtext=text='${esc(t)}':fontsize=${sz}:fontcolor=${col}:x=${x}:y=${y}:fontfile=${f || FN}[${nv()}]`);
    };
    const txtC = (t, sz, col, y, f) => {
      if (!useText) return;
      p.push(`[${cv()}]drawtext=text='${esc(t)}':fontsize=${sz}:fontcolor=${col}:x=(w-text_w)/2:y=${y}:fontfile=${f || FN}[${nv()}]`);
    };

    // ── BASE ──
    p.push(`color=c=#0c0c12:s=${W}x${H}:d=${dur}:r=30[${cv()}]`);
    // showwaves — omit draw=full (not available in older FFmpeg builds)
    p.push(`[0:a]showwaves=s=${W - 16}x${WH}:mode=p2p:rate=30:colors=#c9a22755:scale=sqrt[wv]`);
    p.push(`[${cv()}][wv]overlay=8:${WY}:shortest=1[${nv()}]`);

    // ── SECTION BACKGROUNDS ──
    box(0, 0, W, TLH, '#08080e');
    box(0, AY, W, AH, '#0e0e16');
    box(0, AY, LW - 2, AH, '#0a0a12');
    box(0, MY, W, MH, '#08080e');
    box(0, MB - 28, W, 28, '#060610');

    // ── TRACK LANES ──
    for (let i = 0; i < tracks.length; i++) box(GX, AY + 3 + i * (TH + TG), GW, TH, '#141420');

    // ── GRID LINES (BPM-aligned) ──
    const gridEvery = 4;
    for (let b = gridEvery; b < totalBars; b += gridEvery) {
      const gx = GX + Math.round(b * barFrac * GW);
      if (gx > GX && gx < GX + GW) box(gx, AY, 1, AH, '#1a1a28');
    }
    for (let b = 1; b < totalBars; b++) {
      if (b % gridEvery === 0) continue;
      const gx = GX + Math.round(b * barFrac * GW);
      if (gx > GX && gx < GX + GW) box(gx, AY, 1, AH, '#12121a');
    }

    // ── ARRANGEMENT BLOCKS (BPM-aligned) ──
    for (let i = 0; i < tracks.length; i++) {
      const y = AY + 3 + i * (TH + TG);
      for (const [s, e] of makeBlocks(i)) {
        const bx = GX + Math.round(s * GW) + 1;
        const bw = Math.max(4, Math.round((e - s) * GW) - 2);
        box(bx, y + 3, bw, TH - 6, tracks[i].c + '35');
        box(bx, y + 3, bw, 2, tracks[i].c + 'aa');
      }
    }

    // ── MIXER ──
    for (let i = 1; i < mCh.length; i++) box(8 + i * mW, MY + 4, 1, MH - 36, '#1a1a28');
    const fPos = [.35, .42, .38, .28, .50, .55, .20];
    for (let i = 0; i < mCh.length; i++) {
      const cx = 8 + i * mW + Math.floor(mW / 2);
      box(cx - 1, MY + 16, 3, MH - 50, '#1c1c2c');
      box(cx - 10, MY + 20 + Math.round((fPos[i] || .4) * (MH - 80)), 20, 5, '#778899');
    }

    // ── MOVING PLAYHEAD ──
    boxE(`${GX}+(t/${dur})*${GW}`, AY, 2, AH, '#ffffffd9');
    boxE(`${GX}+(t/${dur})*${GW}-3`, AY - 3, 8, 3, '#ffffffee');

    // ── TEXT (only if drawtext is available) ──
    for (let b = 0; b < totalBars; b += gridEvery) {
      const mx = GX + Math.round(b * barFrac * GW) + 2;
      if (mx < GX + GW - 20) txt(String(b + 1), 9, '#444455', mx, 9, FM);
    }
    for (let i = 0; i < tracks.length; i++) txt(tracks[i].name, 9, '#666680', 5, AY + 3 + i * (TH + TG) + 14, FB);
    for (let i = 0; i < mCh.length; i++) {
      txt(mCh[i], 9, '#555566', 8 + i * mW + Math.floor(mW / 2) - mCh[i].length * 3, MB - 18, FB);
    }
    txtC(title || 'Untitled', 36, 'white', IY, FB);
    txtC(artist || 'Producer', 22, '#888899', IY + 48, FN);
    const infoStr = [bpm ? `${bpm} BPM` : '', key || '', genre || ''].filter(Boolean).join('  ');
    if (infoStr) txtC(infoStr, 15, '#555566', IY + 82, FN);
    txtC('link in bio', 13, '#333344', H - 50, FN);

    // ── BUILD VIDEO ──
    const filterComplex = p.join(';');
    const lastLabel = `q${ni}`;
    console.log(`🎹 Filter chain: ${p.length} operations, ${filterComplex.length} chars, last=[${lastLabel}]`);

    const ffArgs = [
      '-y', '-ss', String(seek), '-i', audioFilePath,
      '-filter_complex', filterComplex,
      '-map', `[${lastLabel}]`, '-map', '0:a',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '192k',
      '-t', String(dur), '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-shortest',
      outputPath
    ];

    await ffmpegRun(ffArgs, 300000);

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      const mb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
      console.log(`✅ DAW video ready (${mb}MB)`);
      await db.updateVideoGeneration(videoId, { status: 'completed', video_url: `/api/videos/${videoId}/file` });
    } else {
      throw new Error('Output file missing or too small');
    }

    fs.unlink(audioFilePath, () => {});

  } catch (err) {
    console.error(`❌ DAW video ${videoId} failed:`, err.message);
    await db.updateVideoGeneration(videoId, { status: 'error', error_message: 'DAW video failed: ' + err.message }).catch(() => {});
  }
}

// ── TikTok token refresh helper ──
async function refreshTikTokToken(refreshToken) {
  const TT_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
  const TT_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
  if (!TT_CLIENT_KEY || !TT_CLIENT_SECRET) return null;

  const body = new URLSearchParams({
    client_key: TT_CLIENT_KEY,
    client_secret: TT_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  }).toString();

  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'open.tiktokapis.com',
      path: '/v2/oauth/token/',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, resp => {
      const chunks = []; resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (data.access_token) resolve(data);
          else resolve(null);
        } catch(e) { resolve(null); }
      });
    });
    r.on('error', () => resolve(null));
    r.write(body); r.end();
  });
}

const uuid = () => crypto.randomUUID();
const MIME_TYPES = { '.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon' };

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { const raw = Buffer.concat(chunks).toString(); try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
    req.on('error', reject);
  });
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const boundary = req.headers['content-type']?.split('boundary=')[1];
    if (!boundary) return resolve({ fields: {}, file: null });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const delim = Buffer.from(`--${boundary}`);
      const parts = []; let start = buffer.indexOf(delim) + delim.length + 2;
      while (true) { const end = buffer.indexOf(delim, start); if (end === -1) break; parts.push(buffer.slice(start, end)); start = end + delim.length + 2; }
      const fields = {}; let file = null;
      for (const part of parts) {
        const hEnd = part.indexOf('\r\n\r\n'); if (hEnd === -1) continue;
        const hdr = part.slice(0, hEnd).toString(), body = part.slice(hEnd + 4, part.length - 2);
        const nm = hdr.match(/name="([^"]+)"/), fn = hdr.match(/filename="([^"]+)"/);
        if (fn && nm) { const saved = `${uuid()}${path.extname(fn[1]).toLowerCase()}`; fs.writeFileSync(path.join(UPLOADS_DIR, saved), body); file = { filename: saved, originalname: fn[1], size: body.length }; }
        else if (nm) { fields[nm[1]] = body.toString(); }
      }
      resolve({ fields, file });
    });
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization' });
  res.end(JSON.stringify(data));
}
function cors(res) {
  res.writeHead(204, { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' });
  res.end();
}

async function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  return await db.getUserByToken(token);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const method = req.method;
  if (method === 'OPTIONS') return cors(res);

  try {
    // ── AUTH (no login required) ──
    if (p === '/api/auth/register' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.name || !body.email || !body.password) return json(res, { error: 'All fields required' }, 400);
      if (body.password.length < 6) return json(res, { error: 'Password must be at least 6 characters' }, 400);
      const user = await db.createUser(body.name, body.email, body.password);
      if (!user) return json(res, { error: 'Email already registered' }, 409);
      const session = await db.loginUser(body.email, body.password);
      return json(res, session, 201);
    }

    if (p === '/api/auth/login' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.email || !body.password) return json(res, { error: 'Email and password required' }, 400);
      const session = await db.loginUser(body.email, body.password);
      if (!session) return json(res, { error: 'Wrong email or password' }, 401);
      return json(res, session);
    }

    if (p === '/api/auth/logout' && method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) await db.logoutUser(token);
      return json(res, { success: true });
    }

    if (p === '/api/auth/me' && method === 'GET') {
      const user = await getUser(req);
      if (!user) return json(res, { error: 'Not logged in' }, 401);
      return json(res, user);
    }

    // ── Health check (public, no auth — used by keep-alive + frontend warm-up) ──
    if (p === '/api/health' && method === 'GET') {
      return json(res, { status: 'ok', uptime: Math.floor(process.uptime()) });
    }

    // ── TikTok OAuth callback (public — TikTok redirects here, no auth header) ──
    if (p === '/api/tiktok/callback' && method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state'); // contains our user token
      const error = url.searchParams.get('error');

      if (error || !code || !state) {
        // Redirect back to app with error
        res.writeHead(302, { 'Location': '/?tiktok=error&reason=' + encodeURIComponent(error || 'no_code') });
        res.end();
        return;
      }

      try {
        // Exchange authorization code for access token
        const TT_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
        const TT_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
        const TT_REDIRECT_URI = (process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || 'http://localhost:3000') + '/api/tiktok/callback';

        const tokenBody = new URLSearchParams({
          client_key: TT_CLIENT_KEY,
          client_secret: TT_CLIENT_SECRET,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: TT_REDIRECT_URI
        }).toString();

        const tokenRes = await new Promise((resolve, reject) => {
          const r = https.request({
            hostname: 'open.tiktokapis.com',
            path: '/v2/oauth/token/',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) }
          }, resp => {
            const chunks = []; resp.on('data', c => chunks.push(c));
            resp.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
          });
          r.on('error', reject); r.write(tokenBody); r.end();
        });

        console.log('🎵 TikTok token response:', JSON.stringify(tokenRes).substring(0, 300));

        if (tokenRes.error || !tokenRes.access_token) {
          res.writeHead(302, { 'Location': '/?tiktok=error&reason=' + encodeURIComponent(tokenRes.error_description || tokenRes.error || 'token_exchange_failed') });
          res.end();
          return;
        }

        // Validate the state token and find the user
        const tokenUser = await db.getUserByToken(state);
        if (!tokenUser) {
          res.writeHead(302, { 'Location': '/?tiktok=error&reason=invalid_session' });
          res.end();
          return;
        }

        // Calculate expiry timestamp
        const expiresAt = tokenRes.expires_in
          ? new Date(Date.now() + tokenRes.expires_in * 1000).toISOString()
          : null;

        // Save tokens to DB
        await db.saveTikTokToken(tokenUser.id, {
          access_token: tokenRes.access_token,
          refresh_token: tokenRes.refresh_token || null,
          open_id: tokenRes.open_id || null,
          expires_at: expiresAt,
          scope: tokenRes.scope || null
        });

        console.log(`✅ TikTok connected for user ${tokenUser.email}`);
        res.writeHead(302, { 'Location': '/?tiktok=connected' });
        res.end();
      } catch (err) {
        console.error('❌ TikTok callback error:', err.message);
        res.writeHead(302, { 'Location': '/?tiktok=error&reason=' + encodeURIComponent(err.message) });
        res.end();
      }
      return;
    }

    // ── Public stats (track count for landing page) ──
    if (p === '/api/stats' && method === 'GET') {
      const count = await db.getTotalTrackCount();
      return json(res, { tracks_analyzed: count });
    }

    // ── PUBLIC: Serve video files (no auth — loaded via <video src> which can't send headers) ──
    const videoFileMatch = p.match(/^\/api\/videos\/([^/]+)\/file$/);
    if (videoFileMatch && method === 'GET') {
      const lyricsFile = path.join(VIDS_DIR, videoFileMatch[1] + '-lyrics.mp4');
      const beatFile = path.join(VIDS_DIR, videoFileMatch[1] + '-beat.mp4');
      const videoFile = fs.existsSync(lyricsFile) ? lyricsFile : beatFile;
      if (fs.existsSync(videoFile)) {
        const stat = fs.statSync(videoFile);
        res.writeHead(200, {
          'Content-Type': 'video/mp4', 'Content-Length': stat.size,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400'
        });
        fs.createReadStream(videoFile).pipe(res);
        return;
      }
      return json(res, { error: 'Video file not found' }, 404);
    }

    // ── PROTECTED ROUTES ──
    const user = await getUser(req);
    if (p.startsWith('/api/') && !user) return json(res, { error: 'Login required' }, 401);

    if (p === '/api/dashboard' && method === 'GET') return json(res, await db.getStats(user.id));

    if (p === '/api/tracks' && method === 'GET') return json(res, await db.getTracks(user.id));

    if (p === '/api/tracks' && method === 'POST') {
      const isMultipart = req.headers['content-type']?.includes('multipart');
      let fields, file;
      if (isMultipart) { ({ fields, file } = await parseMultipart(req)); } else { fields = await parseBody(req); file = null; }
      const track = {
        id: uuid(), user_id: user.id, title: fields.title || 'Untitled', artist: fields.artist || 'Unknown',
        genre: fields.genre || null, similar_artists: fields.similar_artists || null,
        filename: file?.filename || null, original_name: file?.originalname || null,
        file_size: file?.size || null, spotify_url: fields.spotify_url || null,
        want_tiktok_content: fields.want_tiktok_content === '1' ? 1 : 0,
        main_goal: fields.main_goal || null, lyrics: fields.lyrics || null, social_vibe: fields.social_vibe || null, no_social: fields.no_social || '0', audience_size: fields.audience_size || null, target_region: fields.target_region || null,
        content_type: fields.content_type || 'artist', beat_store_url: fields.beat_store_url || null, producer_goal: fields.producer_goal || null,
        status: fields.status || 'uploaded',
      };
      return json(res, await db.createTrack(track), 201);
    }

    const trackMatch = p.match(/^\/api\/tracks\/([^/]+)$/);
    if (trackMatch && method === 'GET') {
      const track = await db.getTrack(trackMatch[1]);
      if (!track || track.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      const analysis = await db.getAnalysisByTrack(track.id);
      const promoPlan = await db.getPromoPlan(track.id);
      return json(res, { ...track, analysis, promo_plan: promoPlan });
    }

    if (trackMatch && method === 'DELETE') {
      const track = await db.getTrack(trackMatch[1]);
      if (!track || track.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      await db.deleteTrack(trackMatch[1]);
      return json(res, { success: true });
    }

    const analyzeMatch = p.match(/^\/api\/tracks\/([^/]+)\/analyze$/);
    if (analyzeMatch && method === 'POST') {
      const track = await db.getTrack(analyzeMatch[1]);
      if (!track || track.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      // Rate limit check
      const rateCheck = checkAnalysis(user.id);
      if (!rateCheck.allowed) return json(res, { error: rateCheck.reason, retry_after: rateCheck.retry_after }, 429);
      await db.updateTrack(track.id, { status: 'analyzing' });
      const analysisId = uuid();
      await db.createAnalysis({ id: analysisId, track_id: track.id, status: 'processing' });
      // Run real audio analysis if file was uploaded
      let audioFeatures = null;
      if (track.filename) {
        try {
          audioFeatures = await analyzeAudio(path.join(UPLOADS_DIR, track.filename));
        } catch (e) { console.error('Audio analysis failed:', e.message); }
      }
      const trends = await getTrends();
      console.log('Trends loaded:', JSON.stringify(trends).substring(0, 200));
      const result = await analyzeTrack(track, audioFeatures, trends);
      recordAnalysis(user.id);
      await db.updateAnalysis(analysisId, result);
      await db.updateTrack(track.id, { status: 'analyzed' });
      await db.createReport({ id: uuid(), track_id: track.id, analysis_id: analysisId, type: 'analysis', title: `${track.title} - Analysis`, status: 'complete' });
      // Keep audio file for video generation — it will be cleaned up after video is built or by the cleanup timer
      return json(res, { track: await db.getTrack(track.id), analysis: await db.getAnalysis(analysisId) });
    }

    const regenMatch = p.match(/^\/api\/tracks\/([^/]+)\/regenerate\/([^/]+)$/);
    if (regenMatch && method === 'POST') {
      const track = await db.getTrack(regenMatch[1]);
      if (!track || track.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      // Rate limit check
      const rateCheck = checkRegenerate(user.id);
      if (!rateCheck.allowed) return json(res, { error: rateCheck.reason, retry_after: rateCheck.retry_after }, 429);
      const analysis = await db.getAnalysisByTrack(track.id);
      if (!analysis) return json(res, { error: 'Analyze track first' }, 400);
      const section = regenMatch[2]; // video_edits or diy_content_ideas
      try {
        const result = await regenerateSection(track, analysis, section);
        recordRegenerate(user.id);
        // Update the analysis with new section data
        await db.updateAnalysis(analysis.id, { [section]: JSON.stringify(result) });
        return json(res, { section, data: result });
      } catch (err) {
        return json(res, { error: 'Regeneration failed: ' + err.message }, 500);
      }
    }

    const promoMatch = p.match(/^\/api\/tracks\/([^/]+)\/promo-plan$/);
    if (promoMatch && method === 'POST') {
      const track = await db.getTrack(promoMatch[1]);
      if (!track || track.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      // Rate limit check
      const rateCheck = checkPromoPlan(user.id);
      if (!rateCheck.allowed) return json(res, { error: rateCheck.reason, retry_after: rateCheck.retry_after }, 429);
      const analysis = await db.getAnalysisByTrack(track.id);
      if (!analysis) return json(res, { error: 'Analyze track first' }, 400);
      const plan = await generatePromoPlan(track, analysis);
      if (plan) {
        recordPromoPlan(user.id);
        await db.savePromoPlan(track.id, plan);
        await db.createReport({ id: uuid(), track_id: track.id, analysis_id: analysis.id, type: 'promo_plan', title: `${track.title} - Promo Plan`, status: 'complete' });
        return json(res, { plan });
      }
      return json(res, { error: 'Could not generate promo plan' }, 500);
    }

    if (p === '/api/demo' && method === 'POST') {
      // Rate limit — demo uses an analysis
      const rateCheck = checkAnalysis(user.id);
      if (!rateCheck.allowed) return json(res, { error: rateCheck.reason, retry_after: rateCheck.retry_after }, 429);
      const trackId = uuid();
      await db.createTrack({ id: trackId, user_id: user.id, title: 'Midnight Thoughts', artist: 'Luna Rose', genre: 'Indie pop', similar_artists: 'Billie Eilish, Clairo', filename: null, original_name: null, file_size: null, spotify_url: null, want_tiktok_content: 1, main_goal: 'Grow fanbase', status: 'analyzing' });
      const analysisId = uuid();
      await db.createAnalysis({ id: analysisId, track_id: trackId, status: 'processing' });
      const result = await analyzeTrack({ title: 'Midnight Thoughts', artist: 'Luna Rose', genre: 'Indie pop', similar_artists: 'Billie Eilish, Clairo', main_goal: 'Grow fanbase', want_tiktok_content: 1 });
      recordAnalysis(user.id);
      await db.updateAnalysis(analysisId, result);
      await db.updateTrack(trackId, { status: 'analyzed' });
      await db.createReport({ id: uuid(), track_id: trackId, analysis_id: analysisId, type: 'analysis', title: 'Midnight Thoughts - Analysis', status: 'complete' });
      return json(res, { trackId });
    }

    if (p === '/api/reports' && method === 'GET') return json(res, await db.getReports(user.id));

    // ── VIDEO GENERATION (fal.ai) ──
    if (p.startsWith('/api/videos') && p.indexOf('/generate') === -1 && p.indexOf('/status') === -1 && p.indexOf('/file') === -1 && method === 'GET') {
      const urlObj = new URL(req.url, 'http://localhost');
      const trackId = urlObj.searchParams.get('track_id');
      const videos = await db.getUserVideos(user.id, trackId);
      const todayCount = await db.getUserVideoCountToday(user.id);
      return json(res, { videos, today_count: todayCount, daily_limit: 999 });
    }

    if (p === '/api/videos/generate' && method === 'POST') {
      const FAL_KEY = process.env.FAL_API_KEY;
      if (!FAL_KEY) return json(res, { error: 'Video generation not configured' }, 500);
      // Rate limit check
      const rateCheck = checkVideoGeneration(user.id);
      if (!rateCheck.allowed) return json(res, { error: rateCheck.reason, retry_after: rateCheck.retry_after }, 429);

      const body = await parseBody(req);
      const lyricLines = body.lyric_lines || [];
      if (!lyricLines.length) return json(res, { error: 'No lyrics provided for video' }, 400);

      const videoId = uuid();
      const genre = body.genre || '';
      const trackId = body.track_id || '';
      const bpm = body.bpm || 0;
      const audioStartSec = parseInt(body.audio_start_sec) || 0;
      const songContext = { title: body.title || '', artist: body.artist || '', mood_tags: body.mood_tags || [], bpm, audioStartSec };

      // Check if audio file exists for this track
      let audioFilePath = null;
      if (trackId) {
        const srcTrack = await db.getTrack(trackId);
        if (srcTrack && srcTrack.filename) {
          const aPath = path.join(UPLOADS_DIR, srcTrack.filename);
          if (fs.existsSync(aPath)) {
            audioFilePath = aPath;
            console.log(`🎵 Audio file found for video: ${srcTrack.filename}`);
          }
        }
      }

      await db.createVideoGeneration({ id: videoId, user_id: user.id, prompt: genre + ' lyrics slideshow', status: 'processing', request_id: 'local', lyric_lines: JSON.stringify(lyricLines), track_id: trackId });
      recordVideoGeneration(user.id, lyricLines.length);

      // Fire background process: generate images → build slideshow → update DB
      processVideoGeneration(videoId, lyricLines, FAL_KEY, genre, songContext, audioFilePath).catch(err => {
        console.error(`❌ Unhandled video error ${videoId}:`, err);
        db.updateVideoGeneration(videoId, { status: 'error', error_message: err.message || 'Unknown error' }).catch(() => {});
      });

      return json(res, { id: videoId, status: 'processing' });
    }

    // ── BEAT VISUALIZER endpoint (producers only — no fal.ai needed) ──
    if (p === '/api/videos/beat-visualizer' && method === 'POST') {
      console.log('🎬 Beat visualizer endpoint hit by user:', user.id.slice(0,8));
      if (!FFMPEG_BIN) { console.log('❌ No FFMPEG_BIN'); return json(res, { error: 'Video generation not available (no FFmpeg)' }, 500); }

      const rateCheck = checkVideoGeneration(user.id);
      if (!rateCheck.allowed) return json(res, { error: rateCheck.reason, retry_after: rateCheck.retry_after }, 429);

      const body = await parseBody(req);
      const trackId = body.track_id || '';
      if (!trackId) return json(res, { error: 'track_id is required' }, 400);

      // Find audio file for this track
      const srcTrack = await db.getTrack(trackId);
      if (!srcTrack || !srcTrack.filename) return json(res, { error: 'No audio file found for this track. Upload audio first.' }, 400);
      const audioPath = path.join(UPLOADS_DIR, srcTrack.filename);
      if (!fs.existsSync(audioPath)) return json(res, { error: 'Audio file missing. Re-upload your beat.' }, 400);

      const videoId = uuid();
      const audioStartSec = parseInt(body.audio_start_sec) || 0;
      const songContext = {
        title: body.title || srcTrack.title || 'Untitled',
        artist: body.artist || srcTrack.artist || 'Producer',
        bpm: body.bpm || 120,
        key: body.key || '',
        genre: body.genre || '',
        audioStartSec
      };

      const style = body.style || 'waveform';
      await db.createVideoGeneration({ id: videoId, user_id: user.id, prompt: 'beat-' + style, status: 'processing', request_id: 'beat-vis', lyric_lines: '[]', track_id: trackId });
      recordVideoGeneration(user.id, 1);

      // Fire background process — choose style
      const generator = style === 'daw' ? createDAWVideo : createBeatVisualizer;
      generator(videoId, audioPath, songContext).catch(err => {
        console.error(`❌ Beat video error ${videoId}:`, err);
        db.updateVideoGeneration(videoId, { status: 'error', error_message: err.message || 'Unknown error' }).catch(() => {});
      });

      return json(res, { id: videoId, status: 'processing' });
    }

    // (Video file serving moved above auth check)

    const videoStatusMatch = p.match(/^\/api\/videos\/([^/]+)\/status$/);
    if (videoStatusMatch && method === 'GET') {
      const video = await db.getVideoGeneration(videoStatusMatch[1]);
      if (!video || video.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      // Auto-timeout: if stuck in processing or building_video for too long
      if ((video.status === 'processing' || video.status === 'building_video') && video.created_at) {
        const age = Date.now() - new Date(video.created_at).getTime();
        if (age > 10 * 60 * 1000) {
          // If images exist, mark completed (show images). Otherwise mark error.
          const hasImages = video.image_urls && video.image_urls !== '[]' && video.image_urls !== '';
          if (hasImages) {
            await db.updateVideoGeneration(video.id, { status: 'completed' });
            return json(res, { ...video, status: 'completed' });
          } else {
            await db.updateVideoGeneration(video.id, { status: 'error', error_message: 'Generation timed out — try again' });
            return json(res, { ...video, status: 'error', error_message: 'Generation timed out — try again' });
          }
        }
      }
      // For frontend: building_video looks like processing (still show spinner)
      if (video.status === 'building_video') {
        return json(res, { ...video, status: 'processing' });
      }
      return json(res, video);
    }

    // ── TIKTOK INTEGRATION (protected) ──

    // Start OAuth flow — redirect user to TikTok authorization
    if (p === '/api/tiktok/auth' && method === 'GET') {
      const TT_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
      if (!TT_CLIENT_KEY) return json(res, { error: 'TikTok integration not configured. Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET env vars.' }, 500);

      const TT_REDIRECT_URI = (process.env.RENDER_EXTERNAL_URL || process.env.APP_URL || 'http://localhost:3000') + '/api/tiktok/callback';
      const csrfState = authToken; // Use auth token as state — we verify it in callback
      const scopes = 'user.info.basic,video.publish,video.upload';

      const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${TT_CLIENT_KEY}&response_type=code&scope=${scopes}&redirect_uri=${encodeURIComponent(TT_REDIRECT_URI)}&state=${csrfState}`;

      return json(res, { auth_url: authUrl });
    }

    // Check if TikTok is connected
    if (p === '/api/tiktok/status' && method === 'GET') {
      const tt = await db.getTikTokToken(user.id);
      if (!tt) return json(res, { connected: false });

      // Check if token is expired
      const expired = tt.expires_at && new Date(tt.expires_at) < new Date();
      if (expired && tt.refresh_token) {
        // Try to refresh
        try {
          const refreshed = await refreshTikTokToken(tt.refresh_token);
          if (refreshed) {
            const newExpiry = refreshed.expires_in
              ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
              : null;
            await db.updateTikTokToken(user.id, refreshed.access_token, refreshed.refresh_token, newExpiry);
            return json(res, { connected: true, open_id: tt.open_id, refreshed: true });
          }
        } catch(e) {
          console.error('TikTok refresh failed:', e.message);
        }
        // Refresh failed — token is dead
        return json(res, { connected: false, expired: true, reason: 'Token expired. Please reconnect.' });
      }

      return json(res, { connected: !expired, open_id: tt.open_id, expires_at: tt.expires_at });
    }

    // Disconnect TikTok
    if (p === '/api/tiktok/disconnect' && method === 'POST') {
      await db.deleteTikTokToken(user.id);
      return json(res, { success: true });
    }

    // Publish video to TikTok
    if (p === '/api/tiktok/publish' && method === 'POST') {
      const tt = await db.getTikTokToken(user.id);
      if (!tt) return json(res, { error: 'TikTok not connected. Connect your account in Settings first.' }, 400);

      const body = await parseBody(req);
      const videoId = body.video_id;
      const caption = body.caption || '';

      if (!videoId) return json(res, { error: 'No video specified' }, 400);

      // Find the video file on disk (lyrics video or beat visualizer)
      const lyrFile = path.join(VIDS_DIR, videoId + '-lyrics.mp4');
      const btFile = path.join(VIDS_DIR, videoId + '-beat.mp4');
      const videoFile = fs.existsSync(lyrFile) ? lyrFile : btFile;
      if (!fs.existsSync(videoFile)) return json(res, { error: 'Video file not found. Generate a video first.' }, 404);

      const fileSize = fs.statSync(videoFile).size;
      const maxSize = 64 * 1024 * 1024; // TikTok allows up to 64MB for direct upload
      if (fileSize > maxSize) return json(res, { error: 'Video too large for TikTok upload (max 64MB)' }, 400);

      try {
        // Check token expiry, refresh if needed
        let accessToken = tt.access_token;
        if (tt.expires_at && new Date(tt.expires_at) < new Date() && tt.refresh_token) {
          const refreshed = await refreshTikTokToken(tt.refresh_token);
          if (refreshed && refreshed.access_token) {
            accessToken = refreshed.access_token;
            const newExpiry = refreshed.expires_in
              ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
              : null;
            await db.updateTikTokToken(user.id, accessToken, refreshed.refresh_token, newExpiry);
          } else {
            return json(res, { error: 'TikTok session expired. Please reconnect in Settings.' }, 401);
          }
        }

        // Step 1: Initialize video upload (Direct Post)
        const initBody = JSON.stringify({
          post_info: {
            title: caption.substring(0, 150), // TikTok max caption 150 chars
            privacy_level: 'SELF_ONLY', // Start as private — user can change on TikTok
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: fileSize,
            chunk_size: fileSize, // Single chunk for small videos
            total_chunk_count: 1
          }
        });

        const initRes = await new Promise((resolve, reject) => {
          const r = https.request({
            hostname: 'open.tiktokapis.com',
            path: '/v2/post/publish/video/init/',
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + accessToken,
              'Content-Type': 'application/json; charset=UTF-8',
              'Content-Length': Buffer.byteLength(initBody)
            }
          }, resp => {
            const chunks = []; resp.on('data', c => chunks.push(c));
            resp.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
          });
          r.on('error', reject); r.write(initBody); r.end();
        });

        console.log('🎵 TikTok init response:', JSON.stringify(initRes).substring(0, 500));

        if (initRes.error?.code !== 'ok' && initRes.error?.code) {
          return json(res, { error: `TikTok error: ${initRes.error.message || initRes.error.code}` }, 400);
        }

        const uploadUrl = initRes.data?.upload_url;
        const publishId = initRes.data?.publish_id;

        if (!uploadUrl) {
          return json(res, { error: 'TikTok did not return an upload URL. ' + JSON.stringify(initRes).substring(0, 200) }, 500);
        }

        // Step 2: Upload the video file to the upload URL
        const videoData = fs.readFileSync(videoFile);
        const uploadUrlObj = new URL(uploadUrl);

        await new Promise((resolve, reject) => {
          const r = https.request({
            hostname: uploadUrlObj.hostname,
            path: uploadUrlObj.pathname + uploadUrlObj.search,
            method: 'PUT',
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Length': fileSize,
              'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`
            }
          }, resp => {
            const chunks = []; resp.on('data', c => chunks.push(c));
            resp.on('end', () => {
              if (resp.statusCode >= 200 && resp.statusCode < 300) resolve();
              else reject(new Error(`Upload failed: HTTP ${resp.statusCode}`));
            });
          });
          r.on('error', reject); r.write(videoData); r.end();
        });

        console.log(`✅ Video uploaded to TikTok (publish_id: ${publishId})`);
        return json(res, {
          success: true,
          publish_id: publishId,
          message: 'Video uploaded to TikTok! It will appear as a private draft — open TikTok to review and publish it.'
        });

      } catch (err) {
        console.error('❌ TikTok publish error:', err.message);
        return json(res, { error: 'Failed to publish to TikTok: ' + err.message }, 500);
      }
    }

    // Check TikTok publish status
    const ttStatusMatch = p.match(/^\/api\/tiktok\/publish\/([^/]+)\/status$/);
    if (ttStatusMatch && method === 'GET') {
      const tt = await db.getTikTokToken(user.id);
      if (!tt) return json(res, { error: 'TikTok not connected' }, 400);

      try {
        const statusBody = JSON.stringify({ publish_id: ttStatusMatch[1] });
        const statusRes = await new Promise((resolve, reject) => {
          const r = https.request({
            hostname: 'open.tiktokapis.com',
            path: '/v2/post/publish/status/fetch/',
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + tt.access_token,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(statusBody)
            }
          }, resp => {
            const chunks = []; resp.on('data', c => chunks.push(c));
            resp.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
          });
          r.on('error', reject); r.write(statusBody); r.end();
        });
        return json(res, statusRes);
      } catch(err) {
        return json(res, { error: err.message }, 500);
      }
    }

    // ── ADMIN (only your account) ──
    if (p === '/api/admin/trends' && method === 'GET') {
      if (user.email !== 'andre.s.gustad@gmail.com') return json(res, { error: 'Not authorized' }, 403);
      const trends = await db.getTrends();
      return json(res, trends || { trends: [], trending_hashtags: [] });
    }

    if (p === '/api/admin/trends/autofill' && method === 'POST') {
      if (user.email !== 'andre.s.gustad@gmail.com') return json(res, { error: 'Not authorized' }, 403);
      try {
        const fresh = await refreshTrends();
        if (fresh) return json(res, fresh);
        return json(res, { error: 'Failed to fetch trends' }, 500);
      } catch(e) { return json(res, { error: e.message }, 500); }
    }

    if (p === '/api/admin/trends' && method === 'POST') {
      if (user.email !== 'andre.s.gustad@gmail.com') return json(res, { error: 'Not authorized' }, 403);
      const body = await parseBody(req);
      await db.saveTrends(body);
      return json(res, { success: true });
    }

    if (p === '/api/admin/users' && method === 'GET') {
      if (user.email !== 'andre.s.gustad@gmail.com') return json(res, { error: 'Not authorized' }, 403);
      const users = await db.getAllUsers();
      return json(res, users);
    }

    // ── Admin: API usage stats ──
    if (p === '/api/admin/usage' && method === 'GET') {
      if (user.email !== 'andre.s.gustad@gmail.com') return json(res, { error: 'Not authorized' }, 403);
      return json(res, getUsageStats());
    }

    if (p === '/api/settings' && method === 'GET') return json(res, { user_name: user.name, user_email: user.email, plan: user.plan, email_notifications: user.email_notifications, marketing_emails: user.marketing_emails });
    if (p === '/api/settings' && method === 'PUT') { const body = await parseBody(req); const updated = await db.updateUser(user.id, { name: body.user_name, email: body.user_email, email_notifications: body.email_notifications, marketing_emails: body.marketing_emails }); return json(res, updated); }

    // ── Static files ──
    let filePath = path.join(STATIC_DIR, p === '/' ? 'index.html' : p);
    if (!fs.existsSync(filePath)) filePath = path.join(STATIC_DIR, 'index.html');
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(fs.readFileSync(filePath));

  } catch (err) {
    console.error('Server error:', err);
    json(res, { error: err.message }, 500);
  }
});

// ── Recover interrupted video builds after server restart ──
async function recoverStuckVideos() {
  try {
    const stuck = await db.getStuckVideos();
    if (!stuck || stuck.length === 0) return;
    console.log(`🔄 Found ${stuck.length} video(s) to recover after restart`);
    const FAL_KEY = process.env.FAL_API_KEY;

    for (const video of stuck) {
      try {
        const imageUrls = JSON.parse(video.image_urls || '[]');
        const lyricLines = JSON.parse(video.lyric_lines || '[]');
        if (imageUrls.length === 0) {
          // No images — can't recover, mark completed (images-only fallback)
          await db.updateVideoGeneration(video.id, { status: 'completed' });
          console.log(`⚠️ Video ${video.id}: no images, marked completed`);
          continue;
        }
        if (!FFMPEG_BIN) {
          await db.updateVideoGeneration(video.id, { status: 'completed' });
          console.log(`⚠️ Video ${video.id}: no FFmpeg, marked completed with images`);
          continue;
        }
        // Try to find audio file for this track
        let recoveryAudioPath = null;
        if (video.track_id) {
          try {
            const srcTrack = await db.getTrack(video.track_id);
            if (srcTrack && srcTrack.filename) {
              const aPath = path.join(UPLOADS_DIR, srcTrack.filename);
              if (fs.existsSync(aPath)) recoveryAudioPath = aPath;
            }
          } catch(e) {}
        }
        console.log(`🔄 Recovering video ${video.id} — ${imageUrls.length} images, ${lyricLines.length} lyrics${recoveryAudioPath ? ', with audio' : ''}`);
        // Fire recovery in background
        buildVideoFromImages(video.id, imageUrls, lyricLines, { bpm: 120 }, recoveryAudioPath).catch(err => {
          console.error(`❌ Recovery failed for ${video.id}:`, err.message);
        });
      } catch (e) {
        console.error(`❌ Recovery error for ${video.id}:`, e.message);
        await db.updateVideoGeneration(video.id, { status: 'completed' }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('Recovery check failed:', e.message);
  }
}

// Init database then start server
const PORT = process.env.PORT || 3000;
db.init().then(() => {
  server.listen(PORT, () => {
    console.log(`\n  🎵 ViralTrack running at http://localhost:${PORT}\n`);

    // Recover any video builds interrupted by restart
    setTimeout(() => recoverStuckVideos(), 3000);

    // ── Cleanup: delete audio files older than 24 hours ──
    setInterval(() => {
      try {
        const now = Date.now();
        const files = fs.readdirSync(UPLOADS_DIR);
        let cleaned = 0;
        for (const f of files) {
          const fp = path.join(UPLOADS_DIR, f);
          const stat = fs.statSync(fp);
          if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
            fs.unlinkSync(fp);
            cleaned++;
          }
        }
        if (cleaned) console.log(`🧹 Cleaned up ${cleaned} old audio file(s)`);
      } catch(e) {}
    }, 60 * 60 * 1000); // check every hour

    // ── Keep-alive: prevent hosting platforms from sleeping the server ──
    // Pings itself every 14 minutes (Render free tier sleeps after 15 min idle)
    const APP_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
    if (APP_URL) {
      const pingUrl = APP_URL + '/api/health';
      setInterval(() => {
        const mod = pingUrl.startsWith('https') ? https : http;
        mod.get(pingUrl, (r) => r.resume()).on('error', () => {});
        console.log('💓 Keep-alive ping sent');
      }, 14 * 60 * 1000); // every 14 minutes
      console.log(`💓 Keep-alive enabled → ${pingUrl} every 14 min`);
    }
  });
}).catch(err => {
  console.error('❌ Database init failed:', err);
  process.exit(1);
});
