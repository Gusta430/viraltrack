/**
 * Rate Limiter — protects API credits (Anthropic Claude + fal.ai)
 *
 * Three layers of protection:
 * 1. GLOBAL daily caps — hard ceiling on total API calls per day across all users
 * 2. PER-USER daily caps — prevents one user from burning all credits
 * 3. PER-USER cooldowns — minimum time between requests (prevents spam-clicking)
 *
 * All limits are configurable via environment variables.
 * Falls back to conservative defaults if not set.
 */

// ── CONFIGURABLE LIMITS (via env vars or defaults) ──

const LIMITS = {
  // Global daily caps (across ALL users)
  global: {
    claude_calls_per_day:   parseInt(process.env.RATE_CLAUDE_GLOBAL_DAY)  || 100,
    fal_images_per_day:     parseInt(process.env.RATE_FAL_GLOBAL_DAY)     || 200,
  },
  // Per-user daily caps
  user: {
    analyses_per_day:       parseInt(process.env.RATE_ANALYSES_PER_USER)  || 5,
    promo_plans_per_day:    parseInt(process.env.RATE_PROMOS_PER_USER)    || 5,
    regenerates_per_day:    parseInt(process.env.RATE_REGENS_PER_USER)    || 10,
    videos_per_day:         parseInt(process.env.RATE_VIDEOS_PER_USER)    || 3,
    // Cooldowns in seconds (minimum time between requests of same type)
    analysis_cooldown_sec:  parseInt(process.env.RATE_ANALYSIS_COOLDOWN)  || 30,
    promo_cooldown_sec:     parseInt(process.env.RATE_PROMO_COOLDOWN)     || 30,
    regen_cooldown_sec:     parseInt(process.env.RATE_REGEN_COOLDOWN)     || 10,
    video_cooldown_sec:     parseInt(process.env.RATE_VIDEO_COOLDOWN)     || 60,
  }
};

// ── IN-MEMORY TRACKING ──

// Global counters — reset daily
let globalCounters = {
  claude_calls: 0,
  fal_images: 0,
  reset_date: todayStr()
};

// Per-user counters: { [userId]: { analyses, promos, regens, videos, reset_date, last_analysis, last_promo, last_regen, last_video } }
const userCounters = new Map();

function todayStr() {
  return new Date().toISOString().slice(0, 10); // "2026-05-21"
}

function resetGlobalIfNewDay() {
  const today = todayStr();
  if (globalCounters.reset_date !== today) {
    const old = { ...globalCounters };
    globalCounters = { claude_calls: 0, fal_images: 0, reset_date: today };
    console.log(`📊 Rate limiter daily reset. Yesterday's usage: Claude=${old.claude_calls}, fal.ai=${old.fal_images}`);
  }
}

function getUserCounter(userId) {
  const today = todayStr();
  let c = userCounters.get(userId);
  if (!c || c.reset_date !== today) {
    c = {
      analyses: 0, promos: 0, regens: 0, videos: 0,
      last_analysis: 0, last_promo: 0, last_regen: 0, last_video: 0,
      reset_date: today
    };
    userCounters.set(userId, c);
  }
  return c;
}

// ── CHECK FUNCTIONS (return { allowed: bool, reason?: string, retry_after?: number }) ──

export function checkAnalysis(userId) {
  resetGlobalIfNewDay();
  const uc = getUserCounter(userId);

  // Global Claude cap
  if (globalCounters.claude_calls >= LIMITS.global.claude_calls_per_day) {
    return { allowed: false, reason: 'Daily AI capacity reached. Try again tomorrow.', retry_after: secondsUntilMidnight() };
  }
  // Per-user daily cap
  if (uc.analyses >= LIMITS.user.analyses_per_day) {
    return { allowed: false, reason: `You've used all ${LIMITS.user.analyses_per_day} analyses for today. Come back tomorrow!`, retry_after: secondsUntilMidnight() };
  }
  // Cooldown
  const elapsed = (Date.now() - uc.last_analysis) / 1000;
  if (elapsed < LIMITS.user.analysis_cooldown_sec) {
    const wait = Math.ceil(LIMITS.user.analysis_cooldown_sec - elapsed);
    return { allowed: false, reason: `Please wait ${wait}s before analyzing another track.`, retry_after: wait };
  }

  return { allowed: true };
}

export function checkPromoPlan(userId) {
  resetGlobalIfNewDay();
  const uc = getUserCounter(userId);

  if (globalCounters.claude_calls >= LIMITS.global.claude_calls_per_day) {
    return { allowed: false, reason: 'Daily AI capacity reached. Try again tomorrow.', retry_after: secondsUntilMidnight() };
  }
  if (uc.promos >= LIMITS.user.promo_plans_per_day) {
    return { allowed: false, reason: `You've used all ${LIMITS.user.promo_plans_per_day} promo plans for today. Come back tomorrow!`, retry_after: secondsUntilMidnight() };
  }
  const elapsed = (Date.now() - uc.last_promo) / 1000;
  if (elapsed < LIMITS.user.promo_cooldown_sec) {
    const wait = Math.ceil(LIMITS.user.promo_cooldown_sec - elapsed);
    return { allowed: false, reason: `Please wait ${wait}s before generating another promo plan.`, retry_after: wait };
  }

  return { allowed: true };
}

export function checkRegenerate(userId) {
  resetGlobalIfNewDay();
  const uc = getUserCounter(userId);

  if (globalCounters.claude_calls >= LIMITS.global.claude_calls_per_day) {
    return { allowed: false, reason: 'Daily AI capacity reached. Try again tomorrow.', retry_after: secondsUntilMidnight() };
  }
  if (uc.regens >= LIMITS.user.regenerates_per_day) {
    return { allowed: false, reason: `You've used all ${LIMITS.user.regenerates_per_day} regenerations for today.`, retry_after: secondsUntilMidnight() };
  }
  const elapsed = (Date.now() - uc.last_regen) / 1000;
  if (elapsed < LIMITS.user.regen_cooldown_sec) {
    const wait = Math.ceil(LIMITS.user.regen_cooldown_sec - elapsed);
    return { allowed: false, reason: `Please wait ${wait}s before regenerating.`, retry_after: wait };
  }

  return { allowed: true };
}

export function checkVideoGeneration(userId) {
  resetGlobalIfNewDay();
  const uc = getUserCounter(userId);

  if (globalCounters.fal_images >= LIMITS.global.fal_images_per_day) {
    return { allowed: false, reason: 'Daily image generation capacity reached. Try again tomorrow.', retry_after: secondsUntilMidnight() };
  }
  if (uc.videos >= LIMITS.user.videos_per_day) {
    return { allowed: false, reason: `You've used all ${LIMITS.user.videos_per_day} video generations for today.`, retry_after: secondsUntilMidnight() };
  }
  const elapsed = (Date.now() - uc.last_video) / 1000;
  if (elapsed < LIMITS.user.video_cooldown_sec) {
    const wait = Math.ceil(LIMITS.user.video_cooldown_sec - elapsed);
    return { allowed: false, reason: `Please wait ${wait}s before generating another video.`, retry_after: wait };
  }

  return { allowed: true };
}

// ── RECORD FUNCTIONS (call AFTER a successful API call) ──

export function recordAnalysis(userId) {
  resetGlobalIfNewDay();
  const uc = getUserCounter(userId);
  uc.analyses++;
  uc.last_analysis = Date.now();
  globalCounters.claude_calls++;
  console.log(`📊 Rate: user ${userId.slice(0,8)} analysis #${uc.analyses}/${LIMITS.user.analyses_per_day} | global Claude ${globalCounters.claude_calls}/${LIMITS.global.claude_calls_per_day}`);
}

export function recordPromoPlan(userId) {
  resetGlobalIfNewDay();
  const uc = getUserCounter(userId);
  uc.promos++;
  uc.last_promo = Date.now();
  globalCounters.claude_calls++;
  console.log(`📊 Rate: user ${userId.slice(0,8)} promo #${uc.promos}/${LIMITS.user.promo_plans_per_day} | global Claude ${globalCounters.claude_calls}/${LIMITS.global.claude_calls_per_day}`);
}

export function recordRegenerate(userId) {
  resetGlobalIfNewDay();
  const uc = getUserCounter(userId);
  uc.regens++;
  uc.last_regen = Date.now();
  globalCounters.claude_calls++;
}

export function recordVideoGeneration(userId, imageCount = 6) {
  resetGlobalIfNewDay();
  const uc = getUserCounter(userId);
  uc.videos++;
  uc.last_video = Date.now();
  globalCounters.fal_images += imageCount;
  console.log(`📊 Rate: user ${userId.slice(0,8)} video #${uc.videos}/${LIMITS.user.videos_per_day} | global fal.ai ${globalCounters.fal_images}/${LIMITS.global.fal_images_per_day}`);
}

// ── ADMIN: usage stats ──

export function getUsageStats() {
  resetGlobalIfNewDay();
  const perUser = [];
  for (const [userId, c] of userCounters.entries()) {
    if (c.reset_date === todayStr()) {
      perUser.push({
        user_id: userId,
        analyses: c.analyses,
        promo_plans: c.promos,
        regenerations: c.regens,
        videos: c.videos
      });
    }
  }
  return {
    date: todayStr(),
    global: {
      claude_calls: globalCounters.claude_calls,
      claude_limit: LIMITS.global.claude_calls_per_day,
      claude_pct: Math.round(globalCounters.claude_calls / LIMITS.global.claude_calls_per_day * 100),
      fal_images: globalCounters.fal_images,
      fal_limit: LIMITS.global.fal_images_per_day,
      fal_pct: Math.round(globalCounters.fal_images / LIMITS.global.fal_images_per_day * 100),
    },
    limits: LIMITS,
    per_user: perUser
  };
}

// Helper
function secondsUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.ceil((midnight - now) / 1000);
}
