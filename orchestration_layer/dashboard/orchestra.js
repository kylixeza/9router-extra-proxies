// Symphony Orchestra Monitor - Real-time Web Audio Synthesizer & Stage Visualizer
// Conductor, Violins, Piano, Flute, Cello, French Horn & Timpani

(function () {
  'use strict';

  // Musical note frequencies (Hz)
  const NOTES = {
    // Octave 2
    C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, Fs2: 92.50, G2: 98.00, A2: 110.00, B2: 123.47,
    // Octave 3
    C3: 130.81, Cs3: 138.59, D3: 146.83, E3: 164.81, F3: 174.61, Fs3: 185.00, G3: 196.00, A3: 220.00, B3: 246.94,
    // Octave 4
    C4: 261.63, Cs4: 277.18, D4: 293.66, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392.00, Gs4: 415.30, A4: 440.00, As4: 466.16, B4: 493.88,
    // Octave 5
    C5: 523.25, Cs5: 554.37, D5: 587.33, E5: 659.25, F5: 698.46, Fs5: 739.99, G5: 783.99, A5: 880.00, B5: 987.77,
    // Octave 6
    C6: 1046.50, Cs6: 1108.73, D6: 1174.66, E6: 1318.51, Fs6: 1479.98, A6: 1760.00
  };

  // 3 Musical Moods
  const MOOD_DATA = {
    classical: {
      name: 'Classical / Baroque',
      bpm: 112,
      stepMs: 268,
      bars: [
        { name: 'D Major', root: 'D', cello: NOTES.D2, piano: [NOTES.D3, NOTES.Fs3, NOTES.A3, NOTES.D4], violin: [NOTES.D5, NOTES.Fs5, NOTES.A5], flute: [NOTES.Fs5, NOTES.A5, NOTES.D6], horn: NOTES.D3 },
        { name: 'A Major', root: 'A', cello: NOTES.A2, piano: [NOTES.Cs3, NOTES.E3, NOTES.A3, NOTES.E4], violin: [NOTES.Cs5, NOTES.E5, NOTES.A5], flute: [NOTES.E5, NOTES.A5, NOTES.Cs6], horn: NOTES.A2 },
        { name: 'B Minor', root: 'B', cello: NOTES.B2, piano: [NOTES.B2, NOTES.D3, NOTES.Fs3, NOTES.B3], violin: [NOTES.B4, NOTES.D5, NOTES.Fs5], flute: [NOTES.D5, NOTES.Fs5, NOTES.B5], horn: NOTES.B2 },
        { name: 'F# Minor', root: 'Fs', cello: NOTES.Fs2, piano: [NOTES.A2, NOTES.Cs3, NOTES.Fs3, NOTES.Cs4], violin: [NOTES.A4, NOTES.Cs5, NOTES.Fs5], flute: [NOTES.Cs5, NOTES.Fs5, NOTES.A5], horn: NOTES.Fs2 },
        { name: 'G Major', root: 'G', cello: NOTES.G2, piano: [NOTES.G2, NOTES.B2, NOTES.D3, NOTES.G3], violin: [NOTES.B4, NOTES.D5, NOTES.G5], flute: [NOTES.D5, NOTES.G5, NOTES.B5], horn: NOTES.G2 },
        { name: 'D Major', root: 'D', cello: NOTES.D2, piano: [NOTES.Fs2, NOTES.A2, NOTES.D3, NOTES.A3], violin: [NOTES.A4, NOTES.D5, NOTES.Fs5], flute: [NOTES.Fs5, NOTES.A5, NOTES.D6], horn: NOTES.D3 },
        { name: 'G Major', root: 'G', cello: NOTES.G2, piano: [NOTES.G2, NOTES.B2, NOTES.D3, NOTES.B3], violin: [NOTES.B4, NOTES.D5, NOTES.G5], flute: [NOTES.G5, NOTES.B5, NOTES.D6], horn: NOTES.G2 },
        { name: 'A Major', root: 'A', cello: NOTES.A2, piano: [NOTES.A2, NOTES.Cs3, NOTES.E3, NOTES.Cs4], violin: [NOTES.Cs5, NOTES.E5, NOTES.A5], flute: [NOTES.E5, NOTES.A5, NOTES.Cs6], horn: NOTES.A2 }
      ]
    },
    jazz: {
      name: 'Cool Jazz (ii-V-I)',
      bpm: 104,
      stepMs: 288,
      bars: [
        { name: 'Dm9', root: 'D', cello: NOTES.D2, piano: [NOTES.F3, NOTES.A3, NOTES.C4, NOTES.E4], violin: [NOTES.F4, NOTES.A4, NOTES.C5], flute: [NOTES.E5, NOTES.G5, NOTES.A5], horn: NOTES.D3 },
        { name: 'G13', root: 'G', cello: NOTES.G2, piano: [NOTES.F3, NOTES.B3, NOTES.E4, NOTES.A4], violin: [NOTES.F4, NOTES.B4, NOTES.E5], flute: [NOTES.D5, NOTES.F5, NOTES.B5], horn: NOTES.G2 },
        { name: 'Cmaj9', root: 'C', cello: NOTES.C3, piano: [NOTES.E3, NOTES.G3, NOTES.B3, NOTES.D4], violin: [NOTES.G4, NOTES.B4, NOTES.D5], flute: [NOTES.E5, NOTES.G5, NOTES.C6], horn: NOTES.C3 },
        { name: 'A7alt', root: 'A', cello: NOTES.A2, piano: [NOTES.G3, NOTES.Cs4, NOTES.F4, NOTES.As4], violin: [NOTES.G4, NOTES.Cs5, NOTES.F5], flute: [NOTES.Cs5, NOTES.F5, NOTES.A5], horn: NOTES.A2 }
      ]
    },
    lofi: {
      name: 'Chamber Lo-Fi',
      bpm: 86,
      stepMs: 348,
      bars: [
        { name: 'Fmaj7', root: 'F', cello: NOTES.F2, piano: [NOTES.A2, NOTES.C3, NOTES.E3, NOTES.G3], violin: [NOTES.A4, NOTES.C5, NOTES.E5], flute: [NOTES.C5, NOTES.E5, NOTES.G5], horn: NOTES.F2 },
        { name: 'Em7', root: 'E', cello: NOTES.E2, piano: [NOTES.G2, NOTES.B2, NOTES.D3, NOTES.G3], violin: [NOTES.G4, NOTES.B4, NOTES.D5], flute: [NOTES.B4, NOTES.D5, NOTES.G5], horn: NOTES.E2 },
        { name: 'Dm7', root: 'D', cello: NOTES.D2, piano: [NOTES.F2, NOTES.A2, NOTES.C3, NOTES.F3], violin: [NOTES.F4, NOTES.A4, NOTES.C5], flute: [NOTES.A4, NOTES.C5, NOTES.F5], horn: NOTES.D2 },
        { name: 'Cmaj7', root: 'C', cello: NOTES.C2, piano: [NOTES.E2, NOTES.G2, NOTES.B2, NOTES.E3], violin: [NOTES.E4, NOTES.G4, NOTES.B4], flute: [NOTES.G4, NOTES.B4, NOTES.E5], horn: NOTES.C2 }
      ]
    }
  };

  // Instrument Metadata & Inline SVG Graphics
  const INSTRUMENT_META = {
    conductor: {
      key: 'conductor',
      name: 'Maestro Baton & Celesta',
      section: 'Podium',
      color: '#f59e0b',
      bgGlow: 'rgba(245, 158, 11, 0.28)',
      svg: `<svg viewBox="0 0 48 48" class="orch-ins-icon" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 36 L34 14" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="10" cy="38" r="3" fill="#f59e0b"/>
        <path d="M34 14 L40 8" stroke="#fef08a" stroke-width="3" stroke-linecap="round" class="orch-svg-baton"/>
        <path d="M28 10 L30 6 M38 20 L42 22 M38 10 L44 6" stroke="#fbbf24" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`
    },
    violin: {
      key: 'violin',
      name: 'First Violin',
      section: 'Strings I',
      color: '#e11d48',
      bgGlow: 'rgba(225, 29, 72, 0.25)',
      svg: `<svg viewBox="0 0 48 48" class="orch-ins-icon" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M20 18 C17 14, 15 20, 18 25 C14 26, 14 33, 19 36 C24 39, 29 36, 29 30 C32 26, 30 20, 27 18 Z" fill="rgba(225,29,72,0.18)" stroke="#e11d48"/>
        <path d="M24 14 L24 8 M22 8 L26 8" stroke="#fb7185"/>
        <path d="M10 38 L38 10" stroke="#f43f5e" stroke-width="1.5" stroke-linecap="round" class="orch-svg-bow"/>
        <circle cx="24" cy="28" r="1.5" fill="#e11d48"/>
      </svg>`
    },
    piano: {
      key: 'piano',
      name: 'Concert Grand Piano',
      section: 'Keyboard',
      color: '#3b82f6',
      bgGlow: 'rgba(59, 130, 246, 0.25)',
      svg: `<svg viewBox="0 0 48 48" class="orch-ins-icon" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M10 16 L38 16 C38 16 38 32 34 34 L10 34 Z" fill="rgba(59,130,246,0.18)" stroke="#3b82f6"/>
        <rect x="12" y="24" width="24" height="8" rx="1" fill="#fff" stroke="#1d4ed8"/>
        <path d="M16 24 L16 29 M20 24 L20 29 M24 24 L24 29 M28 24 L28 29 M32 24 L32 29" stroke="#1e293b" stroke-width="2"/>
        <path d="M14 34 L12 40 M32 34 L34 40" stroke="#60a5fa" stroke-linecap="round"/>
      </svg>`
    },
    flute: {
      key: 'flute',
      name: 'Concert Flute',
      section: 'Woodwinds',
      color: '#10b981',
      bgGlow: 'rgba(16, 185, 129, 0.25)',
      svg: `<svg viewBox="0 0 48 48" class="orch-ins-icon" fill="none" stroke="currentColor" stroke-width="1.8">
        <rect x="8" y="22" width="32" height="4" rx="2" fill="rgba(16,185,129,0.2)" stroke="#10b981"/>
        <circle cx="14" cy="24" r="1" fill="#34d399"/>
        <circle cx="20" cy="24" r="1" fill="#34d399"/>
        <circle cx="25" cy="24" r="1" fill="#34d399"/>
        <circle cx="30" cy="24" r="1" fill="#34d399"/>
        <path d="M38 21 C41 18, 43 27, 40 29" stroke="#10b981" stroke-linecap="round"/>
      </svg>`
    },
    cello: {
      key: 'cello',
      name: 'Violoncello',
      section: 'Strings II',
      color: '#d97706',
      bgGlow: 'rgba(217, 119, 6, 0.25)',
      svg: `<svg viewBox="0 0 48 48" class="orch-ins-icon" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M19 16 C16 12, 14 18, 17 24 C13 26, 13 35, 19 38 C25 41, 31 38, 31 32 C34 26, 32 18, 29 16 Z" fill="rgba(217,119,6,0.2)" stroke="#d97706"/>
        <path d="M24 12 L24 6 M24 38 L24 43" stroke="#f59e0b" stroke-linecap="round"/>
        <path d="M8 30 L40 24" stroke="#fbbf24" stroke-width="1.5" stroke-linecap="round" class="orch-svg-bow"/>
        <circle cx="21" cy="26" r="1" fill="#d97706"/>
        <circle cx="27" cy="26" r="1" fill="#d97706"/>
      </svg>`
    },
    horn: {
      key: 'horn',
      name: 'French Horn & Timpani',
      section: 'Brass & Percussion',
      color: '#8b5cf6',
      bgGlow: 'rgba(139, 92, 246, 0.25)',
      svg: `<svg viewBox="0 0 48 48" class="orch-ins-icon" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="22" cy="24" r="10" stroke="#8b5cf6" fill="rgba(139,92,246,0.18)"/>
        <circle cx="22" cy="24" r="5" stroke="#a78bfa"/>
        <path d="M28 17 C34 14, 39 12, 42 8 L42 22 C38 20, 33 21, 28 21" fill="rgba(139,92,246,0.3)" stroke="#8b5cf6"/>
        <path d="M12 28 L8 36 M16 32 L16 38" stroke="#c4b5fd" stroke-linecap="round"/>
      </svg>`
    }
  };

  // State Management
  const STATE = {
    audioCtx: null,
    masterGain: null,
    delayNode: null,
    delayGain: null,
    filterNode: null,
    soundEnabled: true,
    volume: 0.45,
    mood: 'classical',
    rehearsalMode: false,
    barIndex: 0,
    beatIndex: 0,
    stepTimer: null,
    initialized: false,
    unlocked: false,
    models: [],
    inflight: [],
    recentCalls: [],
    planCalls: [],
    selectedPlanId: null,
    orchestratorModel: '',
    seenCallIds: new Set(),
    soloTimers: {},
    activeMusicians: new Map(), // key: modelId -> { instrumentKey, expiresAt, taskLabel, isSolo }
    defaultChairs: [
      { id: 'claude-violin', name: 'claude-3-5-sonnet', family: 'claude', role: 'worker', instrument: 'violin' },
      { id: 'gpt-piano', name: 'gpt-4o', family: 'gpt', role: 'worker', instrument: 'piano' },
      { id: 'gemini-flute', name: 'gemini-1.5-pro', family: 'gemini', role: 'worker', instrument: 'flute' },
      { id: 'deepseek-cello', name: 'deepseek-coder', family: 'deepseek', role: 'worker', instrument: 'cello' },
      { id: 'fixer-horn', name: 'fixer-specialist', family: 'other', role: 'fixer', instrument: 'horn' }
    ]
  };

  // 1. Audio Engine Initialization
  function initAudioEngine() {
    if (STATE.audioCtx) return;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;
      STATE.audioCtx = new AudioCtxClass();

      // Master Gain
      STATE.masterGain = STATE.audioCtx.createGain();
      STATE.masterGain.gain.setValueAtTime(STATE.soundEnabled ? STATE.volume : 0.0001, STATE.audioCtx.currentTime);

      // Simple Stereo Delay/Reverb Bus (0.18s + 2200Hz LPF + 0.22 Feedback)
      STATE.delayNode = STATE.audioCtx.createDelay(1.0);
      STATE.delayNode.delayTime.setValueAtTime(0.18, STATE.audioCtx.currentTime);

      STATE.filterNode = STATE.audioCtx.createBiquadFilter();
      STATE.filterNode.type = 'lowpass';
      STATE.filterNode.frequency.setValueAtTime(2200, STATE.audioCtx.currentTime);

      STATE.delayGain = STATE.audioCtx.createGain();
      STATE.delayGain.gain.setValueAtTime(0.22, STATE.audioCtx.currentTime);

      // Wire reverb/delay loop: master -> delay -> filter -> delayGain -> delay
      STATE.masterGain.connect(STATE.delayNode);
      STATE.delayNode.connect(STATE.filterNode);
      STATE.filterNode.connect(STATE.delayGain);
      STATE.delayGain.connect(STATE.delayNode);

      // Connect both dry and wet to destination
      STATE.masterGain.connect(STATE.audioCtx.destination);
      STATE.delayGain.connect(STATE.audioCtx.destination);

      if (STATE.audioCtx.state === 'running') {
        STATE.unlocked = true;
      }
    } catch (e) {
      // Ignore audio init errors gracefully
    }
  }

  function unlockAudio() {
    if (!STATE.audioCtx) initAudioEngine();
    if (STATE.audioCtx && STATE.audioCtx.state === 'suspended') {
      STATE.audioCtx.resume().then(() => {
        STATE.unlocked = true;
        updateControlsUI();
      }).catch(() => {});
    } else if (STATE.audioCtx) {
      STATE.unlocked = true;
      updateControlsUI();
    }
  }

  // 2. Instrument Assignment
  function assignInstrument(modelOrCall, index) {
    if (!modelOrCall) return INSTRUMENT_META.violin;
    const rolesArr = Array.isArray(modelOrCall.roles) ? modelOrCall.roles.map(r => String(r).toLowerCase()) : [];
    const role = (modelOrCall.role || rolesArr[0] || '').toLowerCase();
    const family = (modelOrCall.family || '').toLowerCase();
    const modelName = (modelOrCall.name || modelOrCall.id || modelOrCall.routed_model || modelOrCall.requested_model || modelOrCall.model || '').toLowerCase();

    if (role === 'orchestrator' || (rolesArr.includes('orchestrator') && !rolesArr.includes('worker'))) return INSTRUMENT_META.conductor;
    if (role === 'fixer' || (rolesArr.includes('fixer') && !rolesArr.includes('worker'))) return INSTRUMENT_META.horn;

    if (family === 'claude' || modelName.includes('claude') || modelName.includes('anthropic')) {
      return INSTRUMENT_META.violin;
    }
    if (family === 'gpt' || modelName.includes('gpt') || modelName.includes('openai')) {
      return INSTRUMENT_META.piano;
    }
    if (family === 'gemini' || modelName.includes('gemini') || modelName.includes('google')) {
      return INSTRUMENT_META.flute;
    }
    if (family === 'deepseek' || family === 'qwen' || modelName.includes('deepseek') || modelName.includes('qwen')) {
      return INSTRUMENT_META.cello;
    }

    // Default cyclic fallback for workers
    const mod = (typeof index === 'number' ? index : 0) % 5;
    if (mod === 0) return INSTRUMENT_META.violin;
    if (mod === 1) return INSTRUMENT_META.piano;
    if (mod === 2) return INSTRUMENT_META.flute;
    if (mod === 3) return INSTRUMENT_META.cello;
    return INSTRUMENT_META.horn;
  }

  // 3. Synthesizer Voices
  function playVoice(instrumentKey, freq, durationSec, velocity) {
    if (!STATE.soundEnabled || !STATE.audioCtx || !freq || freq <= 0) return;
    if (STATE.audioCtx.state === 'suspended') {
      STATE.audioCtx.resume().catch(() => {});
    }

    const t = STATE.audioCtx.currentTime;
    const dur = durationSec || 0.35;
    const vel = Math.max(0.05, Math.min(1.0, velocity || 0.7));

    try {
      switch (instrumentKey) {
        case 'violin': {
          // 2 detuned sawtooths (-4 / +4 cents) + 6Hz vibrato LFO + 1800Hz LPF + Bowed ADSR
          const osc1 = STATE.audioCtx.createOscillator();
          const osc2 = STATE.audioCtx.createOscillator();
          const lfo = STATE.audioCtx.createOscillator();
          const lfoGain = STATE.audioCtx.createGain();
          const filter = STATE.audioCtx.createBiquadFilter();
          const gain = STATE.audioCtx.createGain();

          osc1.type = 'sawtooth';
          osc2.type = 'sawtooth';
          osc1.frequency.setValueAtTime(freq, t);
          osc2.frequency.setValueAtTime(freq, t);
          osc1.detune.setValueAtTime(-4, t);
          osc2.detune.setValueAtTime(4, t);

          lfo.type = 'sine';
          lfo.frequency.setValueAtTime(6.0, t);
          lfoGain.gain.setValueAtTime(3.5, t);
          lfo.connect(lfoGain);
          lfoGain.connect(osc1.frequency);
          lfoGain.connect(osc2.frequency);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1800, t);

          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(0.32 * vel, t + 0.08);
          gain.gain.setValueAtTime(0.28 * vel, t + dur - 0.18);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

          osc1.connect(filter);
          osc2.connect(filter);
          filter.connect(gain);
          gain.connect(STATE.masterGain);

          lfo.start(t);
          osc1.start(t);
          osc2.start(t);
          lfo.stop(t + dur + 0.05);
          osc1.stop(t + dur + 0.05);
          osc2.stop(t + dur + 0.05);
          break;
        }

        case 'piano': {
          // Triangle fundamental + Sine 2nd harmonic (2x, 0.35 gain) + Bright Strike (4x, 0.06s decay)
          const oscFund = STATE.audioCtx.createOscillator();
          const oscHarm = STATE.audioCtx.createOscillator();
          const oscStrike = STATE.audioCtx.createOscillator();
          const strikeGain = STATE.audioCtx.createGain();
          const mainGain = STATE.audioCtx.createGain();

          oscFund.type = 'triangle';
          oscFund.frequency.setValueAtTime(freq, t);

          oscHarm.type = 'sine';
          oscHarm.frequency.setValueAtTime(freq * 2, t);

          oscStrike.type = 'sine';
          oscStrike.frequency.setValueAtTime(freq * 4, t);

          strikeGain.gain.setValueAtTime(0.28 * vel, t);
          strikeGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

          mainGain.gain.setValueAtTime(0.0001, t);
          mainGain.gain.linearRampToValueAtTime(0.42 * vel, t + 0.008);
          mainGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

          oscStrike.connect(strikeGain);
          strikeGain.connect(mainGain);

          oscFund.connect(mainGain);
          oscHarm.connect(mainGain);
          mainGain.connect(STATE.masterGain);

          oscFund.start(t);
          oscHarm.start(t);
          oscStrike.start(t);
          oscFund.stop(t + dur + 0.05);
          oscHarm.stop(t + dur + 0.05);
          oscStrike.stop(t + dur + 0.05);
          break;
        }

        case 'flute': {
          // Sine fundamental + soft triangle 2nd harmonic + 5Hz breath tremolo LFO + 2400Hz LPF
          const oscSine = STATE.audioCtx.createOscillator();
          const oscTri = STATE.audioCtx.createOscillator();
          const tremolo = STATE.audioCtx.createOscillator();
          const tremGain = STATE.audioCtx.createGain();
          const filter = STATE.audioCtx.createBiquadFilter();
          const gain = STATE.audioCtx.createGain();

          oscSine.type = 'sine';
          oscSine.frequency.setValueAtTime(freq, t);

          oscTri.type = 'triangle';
          oscTri.frequency.setValueAtTime(freq * 2, t);

          tremolo.type = 'sine';
          tremolo.frequency.setValueAtTime(5.0, t);
          tremGain.gain.setValueAtTime(0.04 * vel, t);
          tremolo.connect(tremGain);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(2400, t);

          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(0.30 * vel, t + 0.06);
          gain.gain.setValueAtTime(0.24 * vel, t + dur - 0.15);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

          tremGain.connect(gain.gain);

          oscSine.connect(filter);
          oscTri.connect(filter);
          filter.connect(gain);
          gain.connect(STATE.masterGain);

          tremolo.start(t);
          oscSine.start(t);
          oscTri.start(t);
          tremolo.stop(t + dur + 0.05);
          oscSine.stop(t + dur + 0.05);
          oscTri.stop(t + dur + 0.05);
          break;
        }

        case 'cello': {
          // Warm Sawtooth (0.5x lower) + Triangle fundamental + 950Hz LPF + Rich bowed envelope
          const oscSaw = STATE.audioCtx.createOscillator();
          const oscTri = STATE.audioCtx.createOscillator();
          const filter = STATE.audioCtx.createBiquadFilter();
          const gain = STATE.audioCtx.createGain();

          oscSaw.type = 'sawtooth';
          oscSaw.frequency.setValueAtTime(freq * 0.5, t);

          oscTri.type = 'triangle';
          oscTri.frequency.setValueAtTime(freq, t);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(950, t);

          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(0.38 * vel, t + 0.09);
          gain.gain.setValueAtTime(0.32 * vel, t + dur - 0.22);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

          oscSaw.connect(filter);
          oscTri.connect(filter);
          filter.connect(gain);
          gain.connect(STATE.masterGain);

          oscSaw.start(t);
          oscTri.start(t);
          oscSaw.stop(t + dur + 0.05);
          oscTri.stop(t + dur + 0.05);
          break;
        }

        case 'horn': {
          // Sawtooth + Square (detuned) -> Brass filter sweep 400Hz -> 1600Hz + Timpani thump
          const oscSaw = STATE.audioCtx.createOscillator();
          const oscSq = STATE.audioCtx.createOscillator();
          const filter = STATE.audioCtx.createBiquadFilter();
          const gain = STATE.audioCtx.createGain();

          oscSaw.type = 'sawtooth';
          oscSaw.frequency.setValueAtTime(freq, t);

          oscSq.type = 'square';
          oscSq.frequency.setValueAtTime(freq * 0.5, t);
          oscSq.detune.setValueAtTime(8, t);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(400, t);
          filter.frequency.exponentialRampToValueAtTime(1600, t + 0.12);

          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(0.34 * vel, t + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

          oscSaw.connect(filter);
          oscSq.connect(filter);
          filter.connect(gain);
          gain.connect(STATE.masterGain);

          oscSaw.start(t);
          oscSq.start(t);
          oscSaw.stop(t + dur + 0.05);
          oscSq.stop(t + dur + 0.05);

          // Downbeat Timpani Thump (pitch drop 110Hz -> 55Hz)
          if (STATE.beatIndex === 0) {
            const timpaniOsc = STATE.audioCtx.createOscillator();
            const timpaniGain = STATE.audioCtx.createGain();
            timpaniOsc.type = 'sine';
            timpaniOsc.frequency.setValueAtTime(110, t);
            timpaniOsc.frequency.exponentialRampToValueAtTime(55, t + 0.28);

            timpaniGain.gain.setValueAtTime(0.40 * vel, t);
            timpaniGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

            timpaniOsc.connect(timpaniGain);
            timpaniGain.connect(STATE.masterGain);
            timpaniOsc.start(t);
            timpaniOsc.stop(t + 0.38);
          }
          break;
        }

        case 'conductor':
        default: {
          // Celesta/Harp chime: Sine fundamental + Sine 3x harmonic with bell decay
          const osc1 = STATE.audioCtx.createOscillator();
          const osc2 = STATE.audioCtx.createOscillator();
          const gain = STATE.audioCtx.createGain();

          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(freq || NOTES.A5, t);

          osc2.type = 'sine';
          osc2.frequency.setValueAtTime((freq || NOTES.A5) * 3, t);

          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.linearRampToValueAtTime(0.28 * vel, t + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, 0.45));

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(STATE.masterGain);

          osc1.start(t);
          osc2.start(t);
          osc1.stop(t + Math.max(dur, 0.45) + 0.05);
          osc2.stop(t + Math.max(dur, 0.45) + 0.05);
          break;
        }
      }
    } catch (err) {
      // Audio node scheduling guard
    }
  }

  // Play Orchestral Flourish on status events (200 OK major triad chime / error diminished brass)
  function playFlourish(isSuccess) {
    if (!STATE.soundEnabled || !STATE.audioCtx) return;
    const now = STATE.audioCtx.currentTime;
    if (isSuccess) {
      // Major Triad Chime: D5 -> F#5 -> A5
      const notes = [NOTES.D5, NOTES.Fs5, NOTES.A5];
      notes.forEach((f, idx) => {
        setTimeout(() => {
          playVoice('conductor', f, 0.4, 0.65);
        }, idx * 75);
      });
    } else {
      // Dramatic diminished cue with timpani thump
      playVoice('horn', NOTES.D3, 0.5, 0.85);
      setTimeout(() => {
        playVoice('violin', NOTES.Gs4, 0.4, 0.7);
      }, 80);
    }
  }

  // Play 4-note Solo Audition
  function auditionSeat(modelId) {
    unlockAudio();
    const inst = getSeatInstrument(modelId);
    const mood = MOOD_DATA[STATE.mood] || MOOD_DATA.classical;
    const currentBar = mood.bars[STATE.barIndex % mood.bars.length];

    // Mark as soloing for 2.5 seconds
    STATE.activeMusicians.set(modelId, {
      instrumentKey: inst.key,
      expiresAt: Date.now() + 2500,
      taskLabel: 'Audition Solo ♪',
      isSolo: true
    });

    const baseFreq = (inst.key === 'cello') ? NOTES.D3 : (inst.key === 'piano') ? NOTES.D4 : (inst.key === 'horn') ? NOTES.D3 : NOTES.D5;
    const soloNotes = [baseFreq, baseFreq * 1.25, baseFreq * 1.5, baseFreq * 2.0];

    soloNotes.forEach((f, i) => {
      setTimeout(() => {
        playVoice(inst.key, f, 0.4, 0.85);
        spawnFloatingNote(modelId, ['♪', '♫', '♬', '♩'][i % 4], inst.color);
      }, i * 220);
    });

    renderStage();
  }

  function getSeatInstrument(modelId) {
    const chair = STATE.defaultChairs.find(c => c.id === modelId || c.name === modelId);
    if (chair) return INSTRUMENT_META[chair.instrument] || INSTRUMENT_META.violin;
    const m = STATE.models.find(x => (x.id || x.name) === modelId);
    return assignInstrument(m || { id: modelId });
  }

  // 4. Continuous Generative Harmony Scheduler
  function startStepScheduler() {
    if (STATE.stepTimer) clearInterval(STATE.stepTimer);
    const mood = MOOD_DATA[STATE.mood] || MOOD_DATA.classical;
    STATE.stepTimer = setInterval(() => {
      stepPerformance();
    }, mood.stepMs);
  }

  function stepPerformance() {
    const now = Date.now();
    const mood = MOOD_DATA[STATE.mood] || MOOD_DATA.classical;
    const bar = mood.bars[STATE.barIndex % mood.bars.length];
    const beat = STATE.beatIndex % 4; // 4/4 time

    // Rehearsal simulation
    if (STATE.rehearsalMode) {
      const activeWorkers = (STATE.models || []).filter(m => m.isActive && m.available !== false && (!Array.isArray(m.roles) || m.roles.includes('worker') || m.roles.includes('fixer')));
      const activeIds = activeWorkers.length >= 2
        ? activeWorkers.map(m => m.id || m.name)
        : ['claude-violin', 'gpt-piano', 'gemini-flute', 'deepseek-cello', 'fixer-horn'];
      // Rotate active musicians across beats
      const currentActive = activeIds[beat % activeIds.length];
      const partner = activeIds[(beat + 2) % activeIds.length];
      STATE.activeMusicians.set(currentActive, {
        instrumentKey: getSeatInstrument(currentActive).key,
        expiresAt: now + 900,
        taskLabel: `T${(beat % 3) + 1} Rehearsal`,
        isSolo: false
      });
      STATE.activeMusicians.set(partner, {
        instrumentKey: getSeatInstrument(partner).key,
        expiresAt: now + 900,
        taskLabel: `T${(beat % 3) + 1} Rehearsal`,
        isSolo: false
      });
    }

    // Clean up expired musicians
    for (const [mid, data] of STATE.activeMusicians.entries()) {
      if (data.expiresAt < now) {
        STATE.activeMusicians.delete(mid);
      }
    }

    const hasActiveMusicians = STATE.activeMusicians.size > 0;

    // Pulse Conductor Baton
    if (hasActiveMusicians || STATE.rehearsalMode) {
      flashConductorBaton(beat, bar.name);
    }

    // Play generative harmonic notes for active musicians
    if (hasActiveMusicians && STATE.soundEnabled && STATE.audioCtx) {
      for (const [mid, data] of STATE.activeMusicians.entries()) {
        const instKey = data.instrumentKey;
        let noteFreq = null;

        if (instKey === 'violin') {
          const arr = bar.violin;
          noteFreq = arr[beat % arr.length];
        } else if (instKey === 'piano') {
          // Comp chords on beats 0 and 2, arpeggios on 1 and 3
          const arr = bar.piano;
          noteFreq = arr[beat % arr.length];
        } else if (instKey === 'flute') {
          const arr = bar.flute;
          noteFreq = arr[(beat + 1) % arr.length];
        } else if (instKey === 'cello') {
          // Bass root note on downbeat, fifth on beat 2
          noteFreq = (beat === 2) ? (bar.cello * 1.5) : bar.cello;
        } else if (instKey === 'horn') {
          noteFreq = bar.horn;
        } else if (instKey === 'conductor') {
          noteFreq = NOTES.A5;
        }

        if (noteFreq) {
          const vel = data.isSolo ? 0.9 : 0.68;
          playVoice(instKey, noteFreq, mood.stepMs / 1000 * 0.95, vel);
          if (beat % 2 === 0) {
            spawnFloatingNote(mid, ['♪', '♫', '♬'][beat % 3], INSTRUMENT_META[instKey]?.color || '#f59e0b');
          }
        }
      }
    }

    // Advance beat/bar
    STATE.beatIndex = (STATE.beatIndex + 1) % 4;
    if (STATE.beatIndex === 0) {
      STATE.barIndex = (STATE.barIndex + 1) % mood.bars.length;
    }

    updateNowPlayingInfo();
    updateSeatCardStyles();
  }

  function flashConductorBaton(beat, chordName) {
    const baton = document.querySelector('.orch-baton');
    const beatBadge = document.getElementById('orchConductorBeat');
    if (baton) {
      baton.classList.remove('pulse-beat');
      void baton.offsetWidth; // trigger reflow
      baton.classList.add('pulse-beat');
    }
    if (beatBadge) {
      beatBadge.textContent = `Beat ${beat + 1}/4 · Bar ${(STATE.barIndex % 8) + 1} · ${chordName}`;
    }
  }

  function spawnFloatingNote(targetId, symbol, color) {
    const seatEl = document.querySelector(`[data-seat-id="${targetId}"]`) || document.querySelector('.orch-conductor-podium');
    if (!seatEl) return;
    const note = document.createElement('div');
    note.className = 'orch-floating-note';
    note.textContent = symbol || '♪';
    note.style.color = color || '#f59e0b';
    note.style.left = `${Math.floor(Math.random() * 40) + 30}%`;
    seatEl.appendChild(note);
    setTimeout(() => {
      if (note.parentNode) note.parentNode.removeChild(note);
    }, 1800);
  }

  // 5. DOM Stage Rendering
  function renderStage() {
    const mount = document.getElementById('orchStageMount');
    if (!mount) return;

    // Aggregate seats: models from STATE.models (worker/fixer) + models in inflight/planCalls
    const seatMap = new Map();

    // Merge active models from proxy (or default chairs if no active models yet)
    const activeModels = Array.isArray(STATE.models)
      ? STATE.models.filter(m => m.isActive && m.available !== false)
      : [];

    const activeOrch = activeModels.find(m => Array.isArray(m.roles) ? m.roles.includes('orchestrator') : m.role === 'orchestrator');
    const orchestratorModel = STATE.orchestratorModel || (activeOrch ? activeOrch.id : 'ag/gemini-4-argon-high (Maestro)');

    if (activeModels.length > 0) {
      let workerIdx = 0;
      activeModels.forEach(m => {
        const roles = Array.isArray(m.roles) ? m.roles : (m.role ? [m.role] : ['worker']);
        if (roles.length === 1 && roles[0] === 'orchestrator') return; // Pure orchestrator sits on podium
        const primaryRole = roles.includes('worker') ? 'worker' : (roles.includes('fixer') ? 'fixer' : roles[0]);
        const mid = m.id || m.name;
        const inst = assignInstrument({ ...m, role: primaryRole }, workerIdx++);
        seatMap.set(mid, {
          id: mid,
          name: m.name || mid,
          role: primaryRole || 'worker',
          family: m.family || '',
          instrument: inst,
          isDefault: false
        });
      });
    }

    // Also include any models currently in-flight or in recent/plan calls
    const callModels = [].concat(STATE.inflight || [], STATE.recentCalls || [], (STATE.planCalls || []).slice(-10));
    callModels.forEach((c, idx) => {
      if (!c || c.role === 'orchestrator' || c.kind === 'orchestrator') return;
      const mid = c.routed_model || c.applied_model || c.requested_model || c.model;
      if (mid && !seatMap.has(mid)) {
        const inst = assignInstrument({ id: mid, role: c.role || 'worker' }, seatMap.size + idx);
        seatMap.set(mid, {
          id: mid,
          name: mid,
          role: c.role || 'worker',
          family: '',
          instrument: inst,
          isDefault: false
        });
      }
    });

    if (seatMap.size === 0) {
      STATE.defaultChairs.forEach(c => {
        seatMap.set(c.id, {
          id: c.id,
          name: c.name,
          role: c.role,
          family: c.family,
          instrument: INSTRUMENT_META[c.instrument],
          isDefault: true
        });
      });
    }

    const seats = Array.from(seatMap.values()).slice(0, 10);

    // Build Stage HTML
    let html = `
      <div class="orch-concert-stage">
        <!-- Ambient Stage Lights & Acoustic Rings -->
        <div class="orch-stage-arch orch-arch-1"></div>
        <div class="orch-stage-arch orch-arch-2"></div>
        <div class="orch-stage-spotlight orch-spotlight-left"></div>
        <div class="orch-stage-spotlight orch-spotlight-right"></div>
        <div class="orch-stage-spotlight orch-spotlight-center"></div>

        <!-- Musician Semicircle Pit -->
        <div class="orch-semicircle-container">
          <div class="orch-semicircle" id="orchMusicianGrid">
    `;

    seats.forEach((seat, idx) => {
      const activeData = STATE.activeMusicians.get(seat.id);
      const isPlaying = !!activeData;
      const statusText = isPlaying
        ? (activeData.taskLabel || '🎵 Playing')
        : 'Click to solo ♪';

      html += `
        <div class="orch-seat-card ${isPlaying ? 'playing' : ''}"
             data-seat-id="${escapeHtml(seat.id)}"
             style="--seat-color:${seat.instrument.color}; --seat-glow:${seat.instrument.bgGlow}"
             onclick="window.OrchSymphony.auditionSeat('${escapeHtml(seat.id)}')">
          <div class="orch-seat-header">
            <span class="orch-seat-section">${escapeHtml(seat.instrument.section)}</span>
            <span class="orch-seat-role pill ${seat.role === 'fixer' ? 'pill-warning' : 'pill-neutral'}">${escapeHtml(seat.role)}</span>
          </div>
          <div class="orch-seat-body">
            <div class="orch-seat-icon-wrap">
              ${seat.instrument.svg}
            </div>
            <div class="orch-seat-meta">
              <div class="orch-seat-instrument">${escapeHtml(seat.instrument.name)}</div>
              <div class="orch-seat-model mono" title="${escapeHtml(seat.id)}">${escapeHtml(truncate(seat.id, 24))}</div>
            </div>
          </div>
          <div class="orch-seat-footer">
            <div class="orch-seat-status ${isPlaying ? 'active' : ''}">${escapeHtml(statusText)}</div>
            <div class="orch-eq-bars ${isPlaying ? 'playing' : ''}">
              <div class="orch-eq-bar bar-1"></div>
              <div class="orch-eq-bar bar-2"></div>
              <div class="orch-eq-bar bar-3"></div>
              <div class="orch-eq-bar bar-4"></div>
              <div class="orch-eq-bar bar-5"></div>
            </div>
          </div>
        </div>
      `;
    });

    html += `
          </div>
        </div>

        <!-- Conductor Podium -->
        <div class="orch-conductor-podium" data-seat-id="conductor" onclick="window.OrchSymphony.auditionSeat('conductor')">
          <div class="orch-podium-header">
            <span class="orch-podium-badge pill pill-warning">Podium</span>
            <span class="orch-baton-status mono" id="orchConductorBeat">Beat 1/4 · Bar 1 · D Major</span>
          </div>
          <div class="orch-podium-maestro">
            <div class="orch-baton-wrap">
              <div class="orch-baton">
                ${INSTRUMENT_META.conductor.svg}
              </div>
            </div>
            <div class="orch-podium-info">
              <div class="orch-maestro-title">Maestro Orchestrator</div>
              <div class="orch-maestro-model mono" title="${escapeHtml(orchestratorModel)}">${escapeHtml(truncate(orchestratorModel, 30))}</div>
              <div class="orch-podium-state" id="orchPodiumStateBadge">
                ${STATE.rehearsalMode ? '🎭 Rehearsal Symphony' : (STATE.activeMusicians.size > 0 ? '🎼 Conducting Live Wave' : '✨ Podium Ready')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    mount.innerHTML = html;
    updateControlsUI();
  }

  function updateSeatCardStyles() {
    const cards = document.querySelectorAll('.orch-seat-card');
    cards.forEach(card => {
      const seatId = card.getAttribute('data-seat-id');
      const activeData = STATE.activeMusicians.get(seatId);
      const isPlaying = !!activeData;
      const statusEl = card.querySelector('.orch-seat-status');
      const eqEl = card.querySelector('.orch-eq-bars');

      if (isPlaying) {
        if (!card.classList.contains('playing')) card.classList.add('playing');
        if (eqEl && !eqEl.classList.contains('playing')) eqEl.classList.add('playing');
        if (statusEl) {
          statusEl.classList.add('active');
          statusEl.textContent = activeData.taskLabel || '🎵 Playing';
        }
      } else {
        if (card.classList.contains('playing')) card.classList.remove('playing');
        if (eqEl && eqEl.classList.contains('playing')) eqEl.classList.remove('playing');
        if (statusEl) {
          statusEl.classList.remove('active');
          statusEl.textContent = 'Click to solo ♪';
        }
      }
    });
  }

  function updateNowPlayingInfo() {
    const mood = MOOD_DATA[STATE.mood] || MOOD_DATA.classical;
    const bar = mood.bars[STATE.barIndex % mood.bars.length];
    const chordBadge = document.getElementById('orchNowPlayingChord');
    if (chordBadge) {
      chordBadge.textContent = `${mood.name}: ${bar.name} (${mood.bpm} BPM)`;
    }

    const stageStatusBadge = document.getElementById('orchStageStatusBadge');
    if (stageStatusBadge) {
      if (STATE.rehearsalMode) {
        stageStatusBadge.className = 'pill pill-warning';
        stageStatusBadge.textContent = '🎭 Rehearsal Demo Active';
      } else if (STATE.activeMusicians.size > 0) {
        stageStatusBadge.className = 'pill pill-positive';
        stageStatusBadge.textContent = `🎼 ${STATE.activeMusicians.size} Musician(s) In Concert`;
      } else {
        stageStatusBadge.className = 'pill pill-neutral';
        stageStatusBadge.textContent = 'Standby · Stage Ready';
      }
    }

    const ticker = document.getElementById('orchTickerText');
    if (ticker) {
      if (STATE.activeMusicians.size > 0) {
        const names = Array.from(STATE.activeMusicians.keys()).map(k => truncate(k, 18)).join(', ');
        ticker.textContent = `Now Playing [${bar.name}]: ${names}`;
      } else {
        ticker.textContent = `Symphony Orchestration Ready · Mood: ${mood.name} · Click any instrument stand to solo`;
      }
    }
  }

  function updateControlsUI() {
    const soundBtn = document.getElementById('orchSoundBtn');
    if (soundBtn) {
      if (STATE.soundEnabled) {
        soundBtn.innerHTML = `<span>🔊</span><span>Sound ON</span>`;
        soundBtn.className = 'cap-filter-pill on';
      } else {
        soundBtn.innerHTML = `<span>🔇</span><span>Sound OFF</span>`;
        soundBtn.className = 'cap-filter-pill';
      }
    }

    const rehearseBtn = document.getElementById('orchRehearsalBtn');
    if (rehearseBtn) {
      if (STATE.rehearsalMode) {
        rehearseBtn.innerHTML = `<span>⏹</span><span>Stop Demo</span>`;
        rehearseBtn.className = 'cap-filter-pill on';
      } else {
        rehearseBtn.innerHTML = `<span>▶</span><span>Rehearsal Demo</span>`;
        rehearseBtn.className = 'cap-filter-pill';
      }
    }

    const moodSelect = document.getElementById('orchMoodSelect');
    if (moodSelect && moodSelect.value !== STATE.mood) {
      moodSelect.value = STATE.mood;
    }
  }

  // Helper Utilities
  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 6. Public Interface: OrchSymphony
  const OrchSymphony = {
    init: function () {
      if (STATE.initialized) return;
      STATE.initialized = true;

      // Global click listener to unlock Web Audio API on first interaction
      const unlockHandler = function () {
        unlockAudio();
      };
      if (typeof document !== 'undefined') {
        document.addEventListener('click', unlockHandler, { once: true, passive: true });
        document.addEventListener('keydown', unlockHandler, { once: true, passive: true });
      }

      initAudioEngine();
      startStepScheduler();
      renderStage();
    },

    updateData: function (data) {
      if (!data) return;
      if (Array.isArray(data.models)) STATE.models = data.models;
      if (data.settings && data.settings.orchestrator_model) {
        STATE.orchestratorModel = data.settings.orchestrator_model;
      }
      if (Array.isArray(data.inflight)) STATE.inflight = data.inflight;
      if (Array.isArray(data.recentCalls)) STATE.recentCalls = data.recentCalls;
      if (Array.isArray(data.planCalls)) STATE.planCalls = data.planCalls;
      if (data.selectedPlanId !== undefined) STATE.selectedPlanId = data.selectedPlanId;

      const now = Date.now();

      // Process Inflight calls as active musicians
      if (STATE.inflight && STATE.inflight.length > 0) {
        STATE.inflight.forEach(c => {
          const isOrch = c.role === 'orchestrator' || c.kind === 'orchestrator';
          const mid = isOrch ? 'conductor' : (c.routed_model || c.requested_model || c.model || c.target_model || c.agent);
          if (isOrch && (c.routed_model || c.requested_model)) {
            STATE.orchestratorModel = c.routed_model || c.requested_model;
          }
          if (mid) {
            const inst = isOrch ? INSTRUMENT_META.conductor : getSeatInstrument(mid);
            const elapsedMs = c.elapsed_ms != null ? c.elapsed_ms : (c.started_at ? (now - Date.parse(c.started_at)) : 500);
            const durationSec = Math.max(0.1, elapsedMs / 1000).toFixed(1);
            const taskStr = c.task_key || c.task_id || (isOrch ? 'Planning' : 'Task');
            const attStr = c.attempt != null ? ` #${c.attempt}` : '';
            STATE.activeMusicians.set(mid, {
              instrumentKey: inst.key,
              expiresAt: now + 3500,
              taskLabel: `🎵 ${taskStr}${attStr} (${durationSec}s)`,
              isSolo: false
            });
          }
        });
      }

      // Also keep very recent calls (last 4.5s) briefly active on stage so fast calls visibly play
      if (Array.isArray(STATE.recentCalls)) {
        STATE.recentCalls.forEach(c => {
          const tsMs = Date.parse(c.ts || c.timestamp || '');
          if (Number.isFinite(tsMs) && (now - tsMs) <= 4500) {
            const isOrch = c.role === 'orchestrator' || c.kind === 'orchestrator';
            const mid = isOrch ? 'conductor' : (c.routed_model || c.applied_model || c.requested_model);
            if (mid && !STATE.activeMusicians.has(mid)) {
              const inst = isOrch ? INSTRUMENT_META.conductor : getSeatInstrument(mid);
              const taskStr = c.task_key || (isOrch ? 'Conducting' : 'Played');
              STATE.activeMusicians.set(mid, {
                instrumentKey: inst.key,
                expiresAt: tsMs + 4500,
                taskLabel: `🎵 ${taskStr} · ${c.latency_ms != null ? c.latency_ms + 'ms' : 'done'}`,
                isSolo: false
              });
            }
          }
        });
      }

      // Check newly arrived completed calls to trigger flourish chime
      const allCalls = (STATE.planCalls || []).concat(STATE.recentCalls || []);
      const isInitialSeed = STATE.seenCallIds.size === 0;
      allCalls.forEach(c => {
        const cid = c.id || `${c.ts || c.timestamp}-${c.routed_model || c.model}-${c.task_key || ''}`;
        if (!STATE.seenCallIds.has(cid)) {
          STATE.seenCallIds.add(cid);
          if (!isInitialSeed) {
            const isSuccess = (c.status === 200 || c.status === 'success' || c.status === 'ok') && !c.fallback_reason && !c.mismatch && !c.error;
            playFlourish(isSuccess);
          }
        }
      });

      renderStage();
    },

    toggleSound: function () {
      unlockAudio();
      STATE.soundEnabled = !STATE.soundEnabled;
      if (STATE.masterGain && STATE.audioCtx) {
        STATE.masterGain.gain.setValueAtTime(
          STATE.soundEnabled ? STATE.volume : 0.0001,
          STATE.audioCtx.currentTime
        );
      }
      if (STATE.soundEnabled) {
        // Welcoming tuning chord: A440 swell
        playVoice('conductor', NOTES.A4, 0.6, 0.7);
      }
      updateControlsUI();
      return STATE.soundEnabled;
    },

    setVolume: function (val) {
      const v = Math.max(0, Math.min(1.0, parseFloat(val) || 0.45));
      STATE.volume = v;
      if (STATE.masterGain && STATE.audioCtx && STATE.soundEnabled) {
        STATE.masterGain.gain.setValueAtTime(v, STATE.audioCtx.currentTime);
      }
    },

    setMood: function (moodName) {
      if (MOOD_DATA[moodName]) {
        STATE.mood = moodName;
        STATE.barIndex = 0;
        STATE.beatIndex = 0;
        startStepScheduler();
        updateNowPlayingInfo();
        updateControlsUI();
      }
    },

    toggleRehearsal: function () {
      unlockAudio();
      STATE.rehearsalMode = !STATE.rehearsalMode;
      if (STATE.rehearsalMode) {
        // Initial flourish
        playFlourish(true);
      } else {
        STATE.activeMusicians.clear();
      }
      renderStage();
      updateControlsUI();
      return STATE.rehearsalMode;
    },

    auditionSeat: function (seatId) {
      auditionSeat(seatId);
    },

    assignInstrument: function (modelOrCall, index) {
      return assignInstrument(modelOrCall, index);
    },

    playVoice: function (instrumentKey, freq, durationSec, velocity) {
      playVoice(instrumentKey, freq, durationSec, velocity);
    },

    getMood: function () {
      return STATE.mood;
    },

    isSoundEnabled: function () {
      return STATE.soundEnabled;
    },

    isRehearsal: function () {
      return STATE.rehearsalMode;
    }
  };

  // Export to window
  if (typeof window !== 'undefined') {
    window.OrchSymphony = OrchSymphony;
  }

  // Export for node --check / module environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OrchSymphony;
  }
})();
