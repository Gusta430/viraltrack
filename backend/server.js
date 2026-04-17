import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import db from './db.js';
import { analyzeTrack, generatePromoPlan } from './ai-service.js';
import { analyzeAudio } from './audio-analysis.js';
import { getTrends } from './trend-service.js';

console.log('🎬 FFmpeg binary:', ffmpegPath);

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

// Build lyrics video in 2 passes:
// Pass 1: Ken Burns zoompan on each image + concat + 2016 color grade (warm, grain, vignette)
// Pass 2: Kashie-style lyrics overlay — one bar at a time, Poppins Bold, fade in/out
function createLyricsVideo(imagePaths, outputPath, lyricLines, totalDuration) {
  return new Promise(async (resolve, reject) => {
    const numImages = imagePaths.length;
    const durationPerImage = totalDuration / numImages;
    const framesPerImage = Math.round(durationPerImage * 25); // 25fps
    const tempSlideshow = outputPath.replace('.mp4', '-raw.mp4');

    // Ken Burns zoom variants — alternate between zoom-in and zoom-out for variety
    const zoomVariants = [
      { z: `min(zoom+0.0008,1.08)`, x: `iw/2-(iw/zoom/2)`, y: `ih/2-(ih/zoom/2)` },               // center zoom in
      { z: `if(eq(on,0),1.08,max(zoom-0.0008,1.0))`, x: `iw/2-(iw/zoom/2)`, y: `ih/2-(ih/zoom/2)` }, // center zoom out
      { z: `min(zoom+0.0008,1.08)`, x: `iw/2-(iw/zoom/2)`, y: `ih/3-(ih/zoom/3)` },               // zoom in top-center
      { z: `if(eq(on,0),1.08,max(zoom-0.0008,1.0))`, x: `iw/3-(iw/zoom/3)`, y: `ih/2-(ih/zoom/2)` }, // zoom out left-center
    ];

    // Font path — Poppins Bold preferred, with fallbacks
    const fontPaths = [
      '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf',
      '/usr/share/fonts/truetype/poppins/Poppins-Bold.ttf',
      POPPINS_BOLD, // our downloaded copy
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/lato/Lato-Bold.ttf'
    ];
    let fontFile = '';
    for (const fp of fontPaths) { if (fs.existsSync(fp)) { fontFile = fp; break; } }
    console.log('🔤 Using font:', fontFile || 'default');

    try {
      // ── Pass 1: Ken Burns zoompan + concat + 2016 color grade ──
      await new Promise((res, rej) => {
        const inputs = [];
        const filters = [];
        const concatInputs = [];

        imagePaths.forEach((imgPath, i) => {
          inputs.push('-loop', '1', '-t', durationPerImage.toFixed(2), '-i', imgPath);
          const zv = zoomVariants[i % zoomVariants.length];
          filters.push(
            `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,` +
            `zoompan=z='${zv.z}':x='${zv.x}':y='${zv.y}':d=${framesPerImage}:s=1080x1920:fps=25[v${i}]`
          );
          concatInputs.push(`[v${i}]`);
        });

        // Concat + 2016 color grade: warm tones, film grain, vignette
        filters.push(
          `${concatInputs.join('')}concat=n=${numImages}:v=1:a=0,fps=25,` +
          `curves=r='0/0 0.25/0.28 0.5/0.55 0.75/0.78 1/0.95':g='0/0 0.25/0.23 0.5/0.5 0.75/0.73 1/0.9':b='0/0.05 0.25/0.2 0.5/0.45 0.75/0.68 1/0.85',` +
          `noise=c0s=10:c0f=t,` +
          `vignette=PI/4[outv]`
        );

        const args = [
          '-y', ...inputs,
          '-filter_complex', filters.join(';'),
          '-map', '[outv]',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
          '-t', totalDuration.toFixed(2),
          tempSlideshow
        ];

        console.log('🎬 Pass 1: Ken Burns + 2016 color grade...');
        execFile(ffmpegPath || 'ffmpeg', args, { timeout: 180000 }, (err, stdout, stderr) => {
          if (err) { console.error('FFmpeg pass 1 error:', stderr?.substring(stderr.length - 500)); rej(err); }
          else { console.log('✅ Pass 1 done'); res(); }
        });
      });

      // ── Pass 2: Kashie-style lyrics — one bar at a time ──
      if (lyricLines && lyricLines.length > 0) {
        await new Promise((res, rej) => {
          const lineCount = lyricLines.length;
          const gap = 0.4; // small gap between lines
          const displayTime = Math.max(2.0, (totalDuration - gap * (lineCount + 1)) / lineCount);
          const vfParts = [];

          lyricLines.forEach((line, i) => {
            const startTime = gap + i * (displayTime + gap);
            const endTime = Math.min(startTime + displayTime, totalDuration - 0.2);
            const fadeIn = 0.25;
            const fadeOut = 0.25;

            // Escape text for FFmpeg drawtext
            const escaped = line
              .replace(/\\/g, '\\\\\\\\')
              .replace(/'/g, '\u2019')
              .replace(/:/g, '\\:')
              .replace(/%/g, '%%');

            // Semi-transparent dark bar behind text — positioned lower like Kashie style
            vfParts.push(
              `drawbox=x=0:y=ih*0.72:w=iw:h=ih*0.16:color=black@0.5:t=fill:` +
              `enable='between(t\\,${startTime.toFixed(2)}\\,${endTime.toFixed(2)})'`
            );

            // Lyric text — big, bold, centered, with border for legibility
            const fontOpt = fontFile ? `fontfile=${fontFile}:` : '';
            vfParts.push(
              `drawtext=text='${escaped}':` +
              `${fontOpt}fontsize=52:fontcolor=white:borderw=3:bordercolor=black@0.7:` +
              `x=(w-text_w)/2:y=h*0.77:` +
              `enable='between(t\\,${startTime.toFixed(2)}\\,${endTime.toFixed(2)})':` +
              `alpha='if(lt(t\\,${(startTime + fadeIn).toFixed(2)})\\,(t-${startTime.toFixed(2)})/${fadeIn.toFixed(2)}\\,if(gt(t\\,${(endTime - fadeOut).toFixed(2)})\\,(${endTime.toFixed(2)}-t)/${fadeOut.toFixed(2)}\\,1))'`
            );
          });

          const args = [
            '-y', '-i', tempSlideshow,
            '-vf', vfParts.join(','),
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            outputPath
          ];

          console.log('🎬 Pass 2: Kashie-style lyrics overlay...');
          execFile(ffmpegPath || 'ffmpeg', args, { timeout: 180000 }, (err, stdout, stderr) => {
            if (err) { console.error('FFmpeg pass 2 error:', stderr?.substring(stderr.length - 500)); rej(err); }
            else { console.log('✅ Pass 2 done — lyrics video ready'); res(); }
          });
        });
      } else {
        fs.renameSync(tempSlideshow, outputPath);
      }

      // Cleanup temp file
      fs.unlink(tempSlideshow, () => {});
      resolve(outputPath);

    } catch (err) {
      fs.unlink(tempSlideshow, () => {});
      reject(new Error('FFmpeg failed: ' + err.message));
    }
  });
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

  // Genre-based scene defaults
  const genreScenes = {
    'hip hop': ['luxury car interior with ambient lighting', 'city skyline at night with neon lights', 'concert crowd with stage lights and smoke', 'designer clothing and jewelry on dark velvet', 'rooftop overlooking city at golden hour'],
    'hip-hop': ['luxury car interior with ambient lighting', 'city skyline at night with neon lights', 'concert crowd with stage lights and smoke', 'designer clothing and jewelry on dark velvet', 'rooftop overlooking city at golden hour'],
    'rap': ['studio session with mic and dim lights', 'expensive car on empty street at night', 'stack of money and watches on marble', 'crowd going wild at a rap concert', 'penthouse view of city lights'],
    'trap': ['dark street with neon signs and fog', 'luxury sports car with glowing headlights', 'gold chains and designer on black background', 'concert moshpit with laser lights', 'trap house aesthetic with purple ambient light'],
    'r&b': ['candlelit bedroom with silk sheets', 'couple silhouette at sunset beach', 'rain on window with city lights behind', 'slow dance with fairy lights', 'rose petals on dark surface with soft glow'],
    'rnb': ['candlelit bedroom with silk sheets', 'couple silhouette at sunset beach', 'rain on window with city lights behind', 'slow dance with fairy lights', 'rose petals on dark surface with soft glow'],
    'pop': ['colorful festival crowd with confetti', 'neon-lit dance floor', 'road trip through scenic highway', 'rooftop party at sunset', 'bright city street with movement'],
    'reggaeton': ['beach club party with palm trees', 'neon nightclub dance floor', 'tropical sunset with ocean waves', 'convertible driving coastal road', 'pool party with colorful lights'],
    'country': ['pickup truck on dirt road at sunset', 'bonfire under starry sky', 'open field with golden wheat', 'small town main street at dusk', 'acoustic guitar on porch with sunset'],
    'rock': ['electric guitar with stage smoke', 'packed arena concert with spotlights', 'desert highway at sunset', 'abandoned warehouse with graffiti', 'band performing with dramatic lighting'],
    'edm': ['massive festival stage with laser show', 'neon geometric patterns in dark space', 'rave crowd with glow sticks', 'futuristic city with holographic lights', 'dj booth overlooking huge crowd'],
    'indie': ['vintage film aesthetic street photography', 'rain-soaked city street reflections', 'cozy coffee shop window view', 'wildflower field at golden hour', 'old record player in dim room'],
    'afrobeats': ['vibrant african street market', 'beach party with colorful outfits', 'dance circle with dramatic sunset', 'luxury resort pool at night', 'festival with traditional and modern vibes'],
    'latin': ['havana street with classic cars', 'salsa dance floor with warm lights', 'tropical beach with palm trees at sunset', 'colorful colonial buildings at night', 'outdoor festival with string lights'],
  };

  // Vibe-based scene pools
  const vibeScenes = {
    beach: ['crystal clear ocean waves crashing on white sand beach', 'palm trees silhouette against pink sunset sky', 'beach bonfire at night with sparks rising', 'surfer walking on beach at golden hour', 'aerial view of turquoise tropical coastline'],
    party: ['nightclub dance floor with laser lights and smoke', 'vip booth with champagne bottles and sparklers', 'packed concert crowd going wild', 'dj mixing at festival main stage', 'rooftop party with city skyline behind'],
    luxury: ['luxury sports car parked in front of mansion at night', 'designer watches and jewelry on marble surface', 'penthouse suite overlooking city lights', 'private jet interior with champagne', 'exotic car collection in underground garage with neon'],
    street: ['dark city alley with neon signs and fog', 'street corner at night with car headlights', 'gritty urban rooftop with city backdrop', 'basketball court at night with harsh streetlights', 'lowrider cruising through city streets'],
    love: ['couple hands intertwined at sunset', 'candlelit dinner table with roses', 'two silhouettes on empty beach at dusk', 'fairy lights wrapped around trees in garden', 'love lock bridge with soft bokeh lights'],
    heartbreak: ['empty park bench in rain', 'shattered glass on dark floor reflecting light', 'single streetlight on empty road at night', 'withered roses on dark surface', 'window with raindrops and blurred city behind'],
    night: ['city skyline reflected in water at night', 'empty neon-lit street at 3am', 'car driving through rain-soaked city at night', 'rooftop view of city with distant lightning', 'moonlit empty highway stretching to horizon'],
    nature: ['dramatic mountain peak above clouds at sunrise', 'waterfall in lush green forest', 'field of wildflowers under dramatic sky', 'aurora borealis over still lake', 'massive oak tree in golden light'],
    hype: ['explosion of fire and sparks on black background', 'fighter walking into arena with spotlight', 'crowd at concert with hands raised and pyrotechnics', 'lightning striking a dark landscape', 'champion celebration with confetti and gold'],
    chill: ['sunset over calm ocean with purple sky', 'smoke trails in colored ambient light', 'vinyl record spinning in warm lit room', 'hammock between palm trees at sunset', 'city view from balcony at blue hour'],
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
      const fallback = ['city skyline at night with dramatic lighting', 'concert crowd with colorful stage lights', 'moody street photography with neon reflections', 'dramatic sunset over landscape', 'smoke and light in dark cinematic setting', 'luxury aesthetic with dark background'];
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
      const imgPrompt = `Real authentic photograph, ${scenePrompts[i]}. Shot on iPhone, candid raw moment, nostalgic 2016 VSCO aesthetic, warm faded tones, slight film grain, golden hour feel, real life not posed, no text, no words, no letters, no watermarks. Vertical 9:16 phone format.`;
      console.log(`📸 Image ${i}: ${scenePrompts[i]}`);
      imagePromises.push(generateImage(falKey, imgPrompt));
    }

    console.log(`📸 Generating ${numImages} images via FLUX...`);
    const imageUrls = await Promise.all(imagePromises);
    console.log(`📸 All ${numImages} images generated:`, imageUrls.map(u => u.substring(0, 60)));

    // Save image URLs to DB immediately
    await db.updateVideoGeneration(videoId, {
      image_urls: JSON.stringify(imageUrls)
    });

    // ── Build MP4 video with FFmpeg (required, not optional) ──
    const ffmpegBin = ffmpegPath || 'ffmpeg'; // ffmpeg-static or system ffmpeg
    console.log(`🎬 Building video with: ${ffmpegBin}`);

    // Download all images to disk
    const imagePaths = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const imgPath = path.join(VIDS_DIR, `${videoId}-img${i}.png`);
      await downloadFile(imageUrls[i], imgPath);
      imagePaths.push(imgPath);
      console.log(`📥 Downloaded image ${i}`);
    }

    // Create video: ~3 sec per lyric line, minimum 12 sec
    const totalDuration = Math.max(12, lyricLines.length * 3.0);
    const outputPath = path.join(VIDS_DIR, `${videoId}-lyrics.mp4`);
    await createLyricsVideo(imagePaths, outputPath, lyricLines, totalDuration);

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      const fileSize = fs.statSync(outputPath).size;
      console.log(`✅ Video ready (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
      await db.updateVideoGeneration(videoId, {
        status: 'completed',
        video_url: `/api/videos/${videoId}/file`
      });
    } else {
      throw new Error('Video file was not created or is empty');
    }

    // Cleanup temp images
    imagePaths.forEach(p => fs.unlink(p, () => {}));

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
    if (p === '/api/videos' && method === 'GET') {
      const videos = await db.getUserVideos(user.id);
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
      const songContext = { title: body.title || '', artist: body.artist || '', mood_tags: body.mood_tags || [] };
      await db.createVideoGeneration({ id: videoId, user_id: user.id, prompt: genre + ' lyrics slideshow', status: 'processing', request_id: 'local', lyric_lines: JSON.stringify(lyricLines) });

      // Fire background process: generate images → build slideshow → update DB
      processVideoGeneration(videoId, lyricLines, FAL_KEY, genre, songContext).catch(err => {
        console.error(`❌ Unhandled video error ${videoId}:`, err);
        db.updateVideoGeneration(videoId, { status: 'error', error_message: err.message || 'Unknown error' }).catch(() => {});
      });

      return json(res, { id: videoId, status: 'processing' });
    }

    // Serve processed lyrics video file
    const videoFileMatch = p.match(/^\/api\/videos\/([^/]+)\/file$/);
    if (videoFileMatch && method === 'GET') {
      const videoFile = path.join(VIDS_DIR, videoFileMatch[1] + '-lyrics.mp4');
      if (fs.existsSync(videoFile)) {
        const stat = fs.statSync(videoFile);
        res.writeHead(200, {
          'Content-Type': 'video/mp4', 'Content-Length': stat.size,
          'Content-Disposition': 'inline; filename="viraltrack-lyrics.mp4"',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400'
        });
        fs.createReadStream(videoFile).pipe(res);
        return;
      }
      return json(res, { error: 'Video file not found' }, 404);
    }

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
  server.listen(PORT, () => console.log(`\n  🎵 ViralTrack running at http://localhost:${PORT}\n`));
}).catch(err => {
  console.error('❌ Database init failed:', err);
  process.exit(1);
});
