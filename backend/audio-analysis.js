/**
 * Audio Analysis Service using Essentia.js
 * Analyzes uploaded audio files for BPM, key, energy, danceability etc.
 */

import { Essentia, EssentiaWASM } from 'essentia.js';
import decode from 'audio-decode';
import fs from 'fs';

const essentia = new Essentia(EssentiaWASM);

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Analyze an audio file and return real musical features
 * @param {string} filepath - Path to MP3/WAV file
 * @returns {object} Audio features (bpm, key, energy, danceability, etc.)
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

export async function analyzeAudio(filepath) {
  try {
    console.log('🎵 Analyzing audio file with Essentia.js...');
    
    // Read and decode audio
    const buffer = fs.readFileSync(filepath);
    const audio = await decode(buffer);
    
    // Convert to mono float32 array
    const monoChannel = audio.channelData[0];
    const audioVector = essentia.arrayToVector(monoChannel);
    
    // BPM Detection - use multiple methods and pick best
    let bpm = 120;
    try {
      // Method 1: RhythmExtractor2013 (most accurate for full songs)
      const rhythm = essentia.RhythmExtractor2013(audioVector);
      bpm = Math.round(rhythm.bpm);
      console.log('RhythmExtractor2013 BPM:', bpm);
      
      // Sanity check - if way off, try PercivalBpmEstimator as backup
      if (bpm < 40 || bpm > 250) {
        const backup = essentia.PercivalBpmEstimator(audioVector);
        bpm = Math.round(backup.bpm);
        console.log('Percival backup BPM:', bpm);
      }
      
      if (bpm < 40 || bpm > 250) bpm = 120;
    } catch (e) {
      // Fallback to Percival if RhythmExtractor fails
      try {
        const bpmResult = essentia.PercivalBpmEstimator(audioVector);
        bpm = Math.round(bpmResult.bpm);
        console.log('Percival fallback BPM:', bpm);
        if (bpm < 40 || bpm > 250) bpm = 120;
      } catch (e2) {
        console.warn('All BPM detection failed, using default:', e2.message);
      }
    }
    
    // Key Detection
    let key = 'C';
    let scale = 'major';
    try {
      const keyResult = essentia.KeyExtractor(audioVector);
      key = keyResult.key || 'C';
      scale = keyResult.scale || 'major';
    } catch (e) {
      console.warn('Key detection failed:', e.message);
    }
    
    // Energy (RMS)
    let energy = 0.5;
    try {
      const rmsResult = essentia.RMS(audioVector);
      // Normalize RMS to 0-1 range (typical RMS is 0.01-0.3)
      energy = Math.min(1, Math.max(0, rmsResult.rms / 0.2));
    } catch (e) {
      console.warn('Energy detection failed:', e.message);
    }
    
    // Loudness
    let loudness = -14;
    try {
      const loudnessResult = essentia.Loudness(audioVector);
      loudness = loudnessResult.loudness || -14;
    } catch (e) {
      console.warn('Loudness detection failed:', e.message);
    }
    
    // Danceability
    let danceability = 0.5;
    try {
      const danceResult = essentia.Danceability(audioVector);
      danceability = danceResult.danceability || 0.5;
    } catch (e) {
      console.warn('Danceability detection failed:', e.message);
    }
    
    // Duration
    const duration = audio.duration || monoChannel.length / audio.sampleRate;
    
    // Find peak energy moments (best sections for TikTok clips)
    let peakMoments = [];
    try {
      const sampleRate = audio.sampleRate;
      const chunkSize = Math.floor(sampleRate * 5); // 5-second chunks
      const totalChunks = Math.floor(monoChannel.length / chunkSize);
      const chunks = [];
      
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = start + chunkSize;
        const chunk = monoChannel.slice(start, end);
        const chunkVector = essentia.arrayToVector(chunk);
        const rms = essentia.RMS(chunkVector);
        chunks.push({
          startTime: Math.round(start / sampleRate),
          endTime: Math.round(end / sampleRate),
          energy: rms.rms
        });
      }
      
      // Sort by energy and pick top 3 most intense moments
      chunks.sort((a, b) => b.energy - a.energy);
      peakMoments = chunks.slice(0, 3).map(c => ({
        start: c.startTime,
        end: c.endTime,
        label: formatTime(c.startTime) + ' - ' + formatTime(c.endTime)
      }));
      // Sort by time order
      peakMoments.sort((a, b) => a.start - b.start);
      console.log('Peak moments found:', peakMoments);
    } catch (e) {
      console.warn('Peak detection failed:', e.message);
    }
    
    const result = {
      bpm,
      key: `${key} ${scale}`,
      energy: Math.round(energy * 100),
      danceability: Math.round(danceability * 100),
      loudness: Math.round(loudness * 10) / 10,
      duration: Math.round(duration),
      peakMoments: peakMoments,
      analyzed: true
    };
    
    console.log('✅ Audio analysis complete:', result);
    return result;
    
  } catch (err) {
    console.error('❌ Audio analysis failed:', err.message);
    return {
      bpm: null,
      key: null,
      energy: null,
      danceability: null,
      loudness: null,
      duration: null,
      analyzed: false,
      error: err.message
    };
  }
}
