# 🎵 ViralTrack — Music Analysis & Promo App

AI-powered music analysis and promotional strategy generator for independent artists.

## Quick Start

```bash
# No dependencies needed! Uses only Node.js built-in modules.
node backend/server.js

# Or with auto-reload during development:
node --watch backend/server.js
```

Then open **http://localhost:3000**

## Architecture

```
viraltrack/
├── backend/
│   ├── server.js          # HTTP server (pure Node.js, zero deps)
│   ├── db.js              # JSON file database
│   ├── ai-service.js      # AI integration point (mock data)
│   ├── data/              # Database files (auto-created)
│   └── uploads/           # Uploaded audio files
├── frontend/
│   └── public/
│       └── index.html     # Single-page app (vanilla JS)
├── package.json
└── README.md
```

## Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Overview stats: tracks analyzed, promo plans, views, engagement |
| **New Analysis** | Upload audio file + metadata, trigger AI analysis |
| **Track Analysis** | Full results: tempo, mood, energy, genre, video edits, DIY ideas, audience, reference artists |
| **Reports** | List of all completed analyses with download option |
| **Settings** | Profile, notifications, subscription |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dashboard` | Dashboard statistics |
| `GET` | `/api/tracks` | List all tracks |
| `POST` | `/api/tracks` | Create track (multipart/json) |
| `GET` | `/api/tracks/:id` | Get track with analysis |
| `DELETE` | `/api/tracks/:id` | Delete track |
| `POST` | `/api/tracks/:id/analyze` | Trigger AI analysis |
| `POST` | `/api/demo` | Create demo track with analysis |
| `GET` | `/api/reports` | List all reports |
| `GET` | `/api/settings` | Get user settings |
| `PUT` | `/api/settings` | Update user settings |

## 🤖 Adding Real AI

The app is designed for easy AI integration. Edit `backend/ai-service.js`:

### Option A: Anthropic Claude

```bash
npm install @anthropic-ai/sdk
```

```javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();  // Uses ANTHROPIC_API_KEY env var

export async function analyzeTrack(track) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: `You are a music marketing AI analyst. Given track metadata,
             generate a comprehensive promotional strategy. Return JSON with:
             tempo_bpm, mood_tags (array), energy_percent, genre_fit,
             audience data, reference artists, video edit suggestions,
             and DIY content ideas.`,
    messages: [{
      role: 'user',
      content: `Analyze this track:
        Title: ${track.title}
        Artist: ${track.artist}
        Genre: ${track.genre}
        Similar artists: ${track.similar_artists}
        Goal: ${track.main_goal}`
    }]
  });

  return JSON.parse(response.content[0].text);
}
```

### Option B: OpenAI

```bash
npm install openai
```

```javascript
import OpenAI from 'openai';
const openai = new OpenAI();

export async function analyzeTrack(track) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a music marketing analyst...' },
      { role: 'user', content: `Analyze: ${track.title} by ${track.artist}` }
    ]
  });
  return JSON.parse(response.choices[0].message.content);
}
```

### Audio Analysis Integration

For actual audio analysis (BPM detection, mood from waveform), consider:
- **Essentia.js** — Music feature extraction in JS
- **Spotify Web API** — If user provides Spotify URL
- **Whisper API** — For lyric transcription + analysis

## Database

Uses a simple JSON file (`backend/data/db.json`). For production, replace `db.js` with:
- **SQLite** via `better-sqlite3`
- **PostgreSQL** via `pg`
- **MongoDB** via `mongodb`

The database interface is designed to be swappable — same method signatures.

## Tech Stack

- **Backend**: Pure Node.js (zero external dependencies)
- **Frontend**: Vanilla HTML/CSS/JS (single file SPA)
- **Database**: JSON file (easily swappable)
- **AI**: Mock data (plug-and-play integration point)

## License

MIT
