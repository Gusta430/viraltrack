import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execFile, execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import db from './db.js';
import { analyzeTrack, generatePromoPlan } from './ai-service.js';
import { analyzeAudio } from './audio-analysis.js';
import { getTrends } from './trend-service.js';

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
function ffmpegRun(args) {
  return new Promise((resolve, reject) => {
    const bin = FFMPEG_BIN || 'ffmpeg';
    execFile(bin, args, { timeout: 60000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        const tail = stderr ? stderr.substring(Math.max(0, stderr.length - 500)) : err.message;
        reject(new Error(tail));
      } else resolve();
    });
  });
}

// Burn lyric text onto an image using ImageMagick (no FFmpeg drawtext needed)
function burnTextOnImage(inputPath, outputPath, text) {
  return new Promise((resolve, reject) => {
    if (!MAGICK_BIN || !LYRICS_FONT) return resolve(false);
    const args = [
      inputPath,
      '-resize', '720x1280!',
      '-gravity', 'center',
      '-font', LYRICS_FONT,
      '-pointsize', '42',
      '-fill', 'white',
      '-stroke', 'rgba(0,0,0,0.5)',
      '-strokewidth', '3',
      '-annotate', '+0+0', text,
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
  const durPerImage = (totalDuration / numImages).toFixed(2);
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
      '-y', '-loop', '1', '-t', durPerImage, '-i', imgToUse,
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

async function processVideoGeneration(videoId, lyricLines, falKey, genre, songContext) {
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

    // ── IMMEDIATELY mark completed with image URLs so user never sees "timed out" ──
    await db.updateVideoGeneration(videoId, {
      status: 'completed',
      image_urls: JSON.stringify(imageUrls),
      video_url: ''
    });
    console.log(`✅ Images saved to DB — user can see results now`);

    // ── Build MP4 video with FFmpeg (upgrades the images-only result) ──
    if (!FFMPEG_BIN) {
      console.log(`⚠️ No FFmpeg available — skipping video build`);
      return;
    }

    try {
      console.log(`🎬 Building MP4 with FFmpeg: ${FFMPEG_BIN}`);

      // Download images to disk
      const imagePaths = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const imgPath = path.join(VIDS_DIR, `${videoId}-img${i}.png`);
        await downloadFile(imageUrls[i], imgPath);
        if (!fs.existsSync(imgPath) || fs.statSync(imgPath).size < 100) {
          throw new Error(`Image ${i} download failed or empty`);
        }
        imagePaths.push(imgPath);
        console.log(`📥 Image ${i} downloaded (${(fs.statSync(imgPath).size/1024).toFixed(0)}KB)`);
      }

      const totalDuration = Math.max(8, imagePaths.length * 1.8);
      const outputPath = path.join(VIDS_DIR, `${videoId}-lyrics.mp4`);
      await createLyricsVideo(imagePaths, outputPath, lyricLines, totalDuration);

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        const mb = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
        console.log(`✅ MP4 ready (${mb}MB) — updating DB`);
        await db.updateVideoGeneration(videoId, { video_url: `/api/videos/${videoId}/file` });
      } else {
        console.log('⚠️ Output file missing or too small');
      }

      // Cleanup source images
      imagePaths.forEach(p => fs.unlink(p, () => {}));
    } catch (buildErr) {
      console.error(`⚠️ Video build failed (images still available):`, buildErr.message);
    }

  } catch (err) {
    console.error(`❌ Video ${videoId} failed:`, err.message);
    await db.updateVideoGeneration(videoId, { status: 'error', error_message: err.message });
  }
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

    // ── PUBLIC: Serve video files (no auth — loaded via <video src> which can't send headers) ──
    const videoFileMatch = p.match(/^\/api\/videos\/([^/]+)\/file$/);
    if (videoFileMatch && method === 'GET') {
      const videoFile = path.join(VIDS_DIR, videoFileMatch[1] + '-lyrics.mp4');
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
      await db.updateAnalysis(analysisId, result);
      await db.updateTrack(track.id, { status: 'analyzed' });
      await db.createReport({ id: uuid(), track_id: track.id, analysis_id: analysisId, type: 'analysis', title: `${track.title} - Analysis`, status: 'complete' });
      // Delete uploaded audio file after analysis — we never keep artist music
      if (track.filename) {
        try { fs.unlinkSync(path.join(UPLOADS_DIR, track.filename)); } catch(e) {}
      }
      return json(res, { track: await db.getTrack(track.id), analysis: await db.getAnalysis(analysisId) });
    }

    const promoMatch = p.match(/^\/api\/tracks\/([^/]+)\/promo-plan$/);
    if (promoMatch && method === 'POST') {
      const track = await db.getTrack(promoMatch[1]);
      if (!track || track.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      const analysis = await db.getAnalysisByTrack(track.id);
      if (!analysis) return json(res, { error: 'Analyze track first' }, 400);
      const plan = await generatePromoPlan(track, analysis);
      if (plan) {
        await db.savePromoPlan(track.id, plan);
        await db.createReport({ id: uuid(), track_id: track.id, analysis_id: analysis.id, type: 'promo_plan', title: `${track.title} - Promo Plan`, status: 'complete' });
        return json(res, { plan });
      }
      return json(res, { error: 'Could not generate promo plan' }, 500);
    }

    if (p === '/api/demo' && method === 'POST') {
      const trackId = uuid();
      await db.createTrack({ id: trackId, user_id: user.id, title: 'Midnight Thoughts', artist: 'Luna Rose', genre: 'Indie pop', similar_artists: 'Billie Eilish, Clairo', filename: null, original_name: null, file_size: null, spotify_url: null, want_tiktok_content: 1, main_goal: 'Grow fanbase', status: 'analyzing' });
      const analysisId = uuid();
      await db.createAnalysis({ id: analysisId, track_id: trackId, status: 'processing' });
      const result = await analyzeTrack({ title: 'Midnight Thoughts', artist: 'Luna Rose', genre: 'Indie pop', similar_artists: 'Billie Eilish, Clairo', main_goal: 'Grow fanbase', want_tiktok_content: 1 });
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

      const body = await parseBody(req);
      const lyricLines = body.lyric_lines || [];
      if (!lyricLines.length) return json(res, { error: 'No lyrics provided for video' }, 400);

      const videoId = uuid();
      const genre = body.genre || '';
      const trackId = body.track_id || '';
      const songContext = { title: body.title || '', artist: body.artist || '', mood_tags: body.mood_tags || [] };
      await db.createVideoGeneration({ id: videoId, user_id: user.id, prompt: genre + ' lyrics slideshow', status: 'processing', request_id: 'local', lyric_lines: JSON.stringify(lyricLines), track_id: trackId });

      // Fire background process: generate images → build slideshow → update DB
      processVideoGeneration(videoId, lyricLines, FAL_KEY, genre, songContext).catch(err => {
        console.error(`❌ Unhandled video error ${videoId}:`, err);
        db.updateVideoGeneration(videoId, { status: 'error', error_message: err.message || 'Unknown error' }).catch(() => {});
      });

      return json(res, { id: videoId, status: 'processing' });
    }

    // (Video file serving moved above auth check)

    const videoStatusMatch = p.match(/^\/api\/videos\/([^/]+)\/status$/);
    if (videoStatusMatch && method === 'GET') {
      const video = await db.getVideoGeneration(videoStatusMatch[1]);
      if (!video || video.user_id !== user.id) return json(res, { error: 'Not found' }, 404);
      // Auto-timeout: if stuck processing for >5 min, mark as error
      if (video.status === 'processing' && video.created_at) {
        const age = Date.now() - new Date(video.created_at).getTime();
        if (age > 8 * 60 * 1000) {
          await db.updateVideoGeneration(video.id, { status: 'error', error_message: 'Generation timed out — try again' });
          return json(res, { ...video, status: 'error', error_message: 'Generation timed out — try again' });
        }
      }
      return json(res, video);
    }

    // ── ADMIN (only your account) ──
    if (p === '/api/admin/trends' && method === 'GET') {
      if (user.email !== 'andre.s.gustad@gmail.com') return json(res, { error: 'Not authorized' }, 403);
      const trends = await db.getTrends();
      return json(res, trends || { trends: [], trending_hashtags: [] });
    }

    if (p === '/api/admin/trends/autofill' && method === 'POST') {
      if (user.email !== 'andre.s.gustad@gmail.com') return json(res, { error: 'Not authorized' }, 403);
      const { analyzeTrack } = await import('./ai-service.js');
      const trendPrompt = 'List 10 current viral TikTok and Instagram Reels trends that musicians can use to promote songs. For each: name and 1-sentence description. Also list 5 trending hashtags. Respond ONLY with JSON: {"trends":[{"name":"","description":"","music_fit":""}],"trending_hashtags":["","","","",""]}';
      try {
        const https = await import('https');
        const body = JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:1500, messages:[{role:'user',content:trendPrompt}] });
        const trendRes = await new Promise((resolve,reject) => {
          const r = https.default.request({ hostname:'api.anthropic.com', path:'/v1/messages', method:'POST', headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body)} }, resp => {
            const chunks=[]; resp.on('data',c=>chunks.push(c)); resp.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString()))}catch(e){reject(e)}});
          }); r.on('error',reject); r.write(body); r.end();
        });
        const text = trendRes.content?.[0]?.text || '';
        const match = text.match(/\{[\s\S]*\}/);
        if (match) return json(res, JSON.parse(match[0]));
        return json(res, { error: 'No trends found' }, 500);
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

// Init database then start server
const PORT = process.env.PORT || 3000;
db.init().then(() => {
  server.listen(PORT, () => {
    console.log(`\n  🎵 ViralTrack running at http://localhost:${PORT}\n`);

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
