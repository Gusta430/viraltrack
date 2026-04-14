import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execFile } from 'child_process';
import db from './db.js';
import { analyzeTrack, generatePromoPlan } from './ai-service.js';
import { analyzeAudio } from './audio-analysis.js';
import { getTrends } from './trend-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, '..', 'frontend', 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const VIDS_DIR = path.join(__dirname, 'data', 'videos');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(VIDS_DIR, { recursive: true });

// ── LYRICS VIDEO OVERLAY (FFmpeg) ──
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        file.close(); fs.unlinkSync(dest);
        return downloadFile(resp.headers.location, dest).then(resolve).catch(reject);
      }
      resp.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function overlayLyricsOnVideo(inputPath, outputPath, lyricLines, videoDuration = 6) {
  return new Promise((resolve, reject) => {
    if (!lyricLines || lyricLines.length === 0) {
      fs.copyFileSync(inputPath, outputPath);
      return resolve(outputPath);
    }

    // One bar at a time — each line gets equal screen time with clean transitions
    const lineCount = lyricLines.length;
    const gap = 0.15; // small gap between bars
    const displayTime = Math.max(1.2, (videoDuration - gap * lineCount) / lineCount);
    const filters = [];

    lyricLines.forEach((line, i) => {
      const startTime = i * (displayTime + gap);
      const endTime = Math.min(startTime + displayTime, videoDuration);
      const fadeInEnd = startTime + 0.2;
      const fadeOutStart = Math.max(startTime, endTime - 0.2);

      // Escape special chars for FFmpeg drawtext
      const escapedLine = line
        .replace(/\\/g, '\\\\\\\\')
        .replace(/'/g, "'\\\\\\''")
        .replace(/:/g, '\\\\:')
        .replace(/%/g, '%%')
        .replace(/\[/g, '\\\\[').replace(/\]/g, '\\\\]');

      // Dark semi-transparent background box behind text for readability
      filters.push(
        `drawbox=x=0:y=h*0.62:w=iw:h=h*0.16:color=black@0.55:t=fill:` +
        `enable='between(t,${startTime.toFixed(2)},${endTime.toFixed(2)})'`
      );

      // Large bold white text, centered, with strong outline
      filters.push(
        `drawtext=text='${escapedLine}':` +
        `fontsize=64:fontcolor=white:borderw=4:bordercolor=black:` +
        `x=(w-text_w)/2:y=h*0.67:` +
        `enable='between(t,${startTime.toFixed(2)},${endTime.toFixed(2)})':` +
        `alpha='if(lt(t,${fadeInEnd.toFixed(2)}),(t-${startTime.toFixed(2)})/0.2,if(gt(t,${fadeOutStart.toFixed(2)}),(${endTime.toFixed(2)}-t)/0.2,1))'`
      );
    });

    const filterChain = filters.join(',');

    const args = [
      '-y', '-i', inputPath,
      '-vf', filterChain,
      '-codec:a', 'copy',
      '-codec:v', 'libx264', '-preset', 'fast', '-crf', '20',
      outputPath
    ];

    console.log('🎬 Overlaying lyrics with FFmpeg...');
    execFile('ffmpeg', args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('FFmpeg error:', stderr);
        // If overlay fails, return original video
        fs.copyFileSync(inputPath, outputPath);
        resolve(outputPath);
      } else {
        console.log('✅ Lyrics overlay complete');
        resolve(outputPath);
      }
    });
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

      const todayCount = await db.getUserVideoCountToday(user.id);
      // No daily limit

      const body = await parseBody(req);
      if (!body.prompt || body.prompt.trim().length < 5) return json(res, { error: 'Prompt must be at least 5 characters' }, 400);

      // Store lyrics lines for overlay after generation
      const lyricLines = body.lyric_lines || [];

      const videoId = uuid();
      const truncatedPrompt = body.prompt.trim().substring(0, 1500);
      await db.createVideoGeneration({ id: videoId, user_id: user.id, prompt: truncatedPrompt, status: 'queued', request_id: null, lyric_lines: JSON.stringify(lyricLines) });

      // Submit to fal.ai queue
      try {
        const falBody = JSON.stringify({ prompt: body.prompt.trim(), duration: "6", aspect_ratio: "9:16" });
        const falRes = await new Promise((resolve, reject) => {
          const opts = {
            hostname: 'queue.fal.run', path: '/fal-ai/minimax/video-01/live', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Key ' + FAL_KEY, 'Content-Length': Buffer.byteLength(falBody) }
          };
          const r = https.request(opts, (resp) => {
            const chunks = [];
            resp.on('data', c => chunks.push(c));
            resp.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
          });
          r.on('error', reject);
          r.write(falBody);
          r.end();
        });

        if (falRes.request_id) {
          await db.updateVideoGeneration(videoId, { request_id: falRes.request_id, status: 'processing', status_url: falRes.status_url, response_url: falRes.response_url });
          return json(res, { id: videoId, request_id: falRes.request_id, status: 'processing', remaining: 0 });
        } else {
          await db.updateVideoGeneration(videoId, { status: 'error', error_message: falRes.detail || 'Failed to queue' });
          return json(res, { error: falRes.detail || 'Failed to queue video' }, 500);
        }
      } catch (err) {
        await db.updateVideoGeneration(videoId, { status: 'error', error_message: err.message });
        return json(res, { error: 'Video generation failed: ' + err.message }, 500);
      }
    }

    // Serve processed lyrics video file
    const videoFileMatch = p.match(/^\/api\/videos\/([^/]+)\/file$/);
    if (videoFileMatch && method === 'GET') {
      const videoFile = path.join(VIDS_DIR, videoFileMatch[1] + '-lyrics.mp4');
      if (fs.existsSync(videoFile)) {
        const stat = fs.statSync(videoFile);
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size, 'Content-Disposition': 'inline' });
        fs.createReadStream(videoFile).pipe(res);
        return;
      }
      return json(res, { error: 'Video file not found' }, 404);
    }

    const videoStatusMatch = p.match(/^\/api\/videos\/([^/]+)\/status$/);
    if (videoStatusMatch && method === 'GET') {
      const video = await db.getVideoGeneration(videoStatusMatch[1]);
      if (!video || video.user_id !== user.id) return json(res, { error: 'Not found' }, 404);

      if (video.status === 'processing' && video.request_id) {
        const FAL_KEY = process.env.FAL_API_KEY;
        try {
          const statusRes = await new Promise((resolve, reject) => {
            const statusUrl = video.status_url || `https://queue.fal.run/fal-ai/minimax/video-01/live/requests/${video.request_id}/status`;
            const u = new URL(statusUrl);
            const opts = {
              hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
              headers: { 'Authorization': 'Key ' + FAL_KEY }
            };
            const r = https.request(opts, (resp) => {
              const chunks = [];
              resp.on('data', c => chunks.push(c));
              resp.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
            });
            r.on('error', reject);
            r.end();
          });

          if (statusRes.status === 'COMPLETED') {
            // Fetch the result
            const resultRes = await new Promise((resolve, reject) => {
              const responseUrl = video.response_url || `https://queue.fal.run/fal-ai/minimax/video-01/live/requests/${video.request_id}`;
              const u2 = new URL(responseUrl);
              const opts = {
                hostname: u2.hostname, path: u2.pathname + u2.search, method: 'GET',
                headers: { 'Authorization': 'Key ' + FAL_KEY }
              };
              const r = https.request(opts, (resp) => {
                const chunks = [];
                resp.on('data', c => chunks.push(c));
                resp.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
              });
              r.on('error', reject);
              r.end();
            });
            // fal.ai can return video URL in different response shapes
            console.log('📥 fal.ai result keys:', Object.keys(resultRes));
            const videoUrl = resultRes.video?.url || resultRes.data?.video?.url || resultRes.output?.video?.url || resultRes.url || null;
            console.log('📥 Extracted video URL:', videoUrl ? videoUrl.substring(0, 80) + '...' : 'NONE');
            if (videoUrl) {
              // Check if lyrics overlay is needed
              let finalUrl = videoUrl;
              try {
                const lyricLines = JSON.parse(video.lyric_lines || '[]');
                if (lyricLines.length > 0) {
                  const inputPath = path.join(VIDS_DIR, video.id + '-raw.mp4');
                  const outputPath = path.join(VIDS_DIR, video.id + '-lyrics.mp4');
                  console.log('📥 Downloading video from fal.ai...');
                  await downloadFile(videoUrl, inputPath);
                  const fileSize = fs.statSync(inputPath).size;
                  console.log(`📥 Downloaded ${(fileSize / 1024 / 1024).toFixed(1)}MB, overlaying lyrics...`);
                  await overlayLyricsOnVideo(inputPath, outputPath, lyricLines);
                  // Serve the processed file from our server
                  finalUrl = '/api/videos/' + video.id + '/file';
                  // Clean up raw file
                  fs.unlink(inputPath, () => {});
                } else {
                  // No lyrics — still download and serve locally for reliability
                  const inputPath = path.join(VIDS_DIR, video.id + '-lyrics.mp4');
                  console.log('📥 Downloading video (no lyrics overlay)...');
                  await downloadFile(videoUrl, inputPath);
                  finalUrl = '/api/videos/' + video.id + '/file';
                }
              } catch (overlayErr) {
                console.error('Video processing error (using fal.ai URL):', overlayErr.message);
                // Fall back to the direct fal.ai URL
                finalUrl = videoUrl;
              }
              await db.updateVideoGeneration(video.id, { status: 'completed', video_url: finalUrl });
              return json(res, { ...video, status: 'completed', video_url: finalUrl });
            } else {
              console.error('❌ Could not extract video URL from fal.ai response:', JSON.stringify(resultRes).substring(0, 500));
              await db.updateVideoGeneration(video.id, { status: 'error', error_message: 'No video URL in response' });
              return json(res, { ...video, status: 'error', error_message: 'Video generated but URL not found' });
            }
          } else if (statusRes.status === 'FAILED') {
            await db.updateVideoGeneration(video.id, { status: 'error', error_message: 'Generation failed' });
            return json(res, { ...video, status: 'error', error_message: 'Generation failed' });
          } else if (statusRes.detail || statusRes.status === undefined) {
            // fal.ai returned an error (e.g. 404 - request not found)
            await db.updateVideoGeneration(video.id, { status: 'error', error_message: 'Request expired or invalid' });
            return json(res, { ...video, status: 'error', error_message: 'Request expired or invalid' });
          }
          // Still processing
          return json(res, { ...video, status: 'processing', queue_position: statusRes.queue_position });
        } catch (err) {
          return json(res, { ...video, status: 'processing' });
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
