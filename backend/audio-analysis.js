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
export async function analyzeAudio(filepath) {
  try {
    console.log('🎵 Analyzing audio file with Essentia.js...');
    
    // Read and decode audio
    const buffer = fs.readFileSync(filepath);
    const audio = await decode(buffer);
    
    // Convert to mono float32 array
    const monoChannel = audio.channelData[0];
    const audioVector = essentia.arrayToVector(monoChannel);
    
    // BPM Detection
    let bpm = 120;
    try {
      const bpmResult = essentia.PercivalBpmEstimator(audioVector);
      bpm = Math.round(bpmResult.bpm);
      if (bpm < 40 || bpm > 250) bpm = 120; // sanity check
    } catch (e) {
      console.warn('BPM detection failed, using default:', e.message);
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
    
    const result = {
      bpm,
      key: `${key} ${scale}`,
      energy: Math.round(energy * 100),
      danceability: Math.round(danceability * 100),
      loudness: Math.round(loudness * 10) / 10,
      duration: Math.round(duration),
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
