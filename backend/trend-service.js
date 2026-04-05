import https from 'https';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
let cachedTrends = null;
let lastFetched = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000;

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY,
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

export async function getTrends() {
  const now = Date.now();
  if (cachedTrends && (now - lastFetched) < CACHE_DURATION) {
    console.log('Using cached trends');
    return cachedTrends;
  }

  try {
    console.log('Fetching fresh trends...');
    const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const response = await callClaude('List the TOP 10 current viral trends on TikTok and Instagram Reels for musicians in ' + month + '. For each: name, 1-sentence description, what music fits. Include 5 trending hashtags and 5 trending formats. Respond ONLY with JSON: {"trends":[{"name":"","description":"","music_fit":""}],"trending_hashtags":["","","","",""],"trending_formats":["","","","",""]}');
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      cachedTrends = JSON.parse(match[0]);
      lastFetched = now;
      console.log('Trends cached:', cachedTrends.trends?.length);
      return cachedTrends;
    }
  } catch (err) {
    console.error('Trend fetch failed:', err.message);
  }

  if (cachedTrends) return cachedTrends;
  return { trends: [], trending_hashtags: [], trending_formats: [] };
}
