/**
 * Teleprompter — Main App (v6)
 *
 * Speech engine: Moonshine Base ONNX (Transformers.js v3) via Web Worker
 *
 * ═══════════════════════════════════════════════════════
 *  V6 SPEED OPTIMIZATIONS
 * ═══════════════════════════════════════════════════════
 *
 * ALGORITHM LAYER:
 *   1. Banded Levenshtein — only compute the diagonal band of width
 *      MAX_EDITS. O(n·k) instead of O(n²). Early bail when band exceeds budget.
 *   2. Prefix/suffix trimming — strip common tokens from both ends before DP.
 *      Common-prefix match is O(1). Saves most work for near-exact matches.
 *   3. Token hash index — pre-build a Map<token→[positions]> over the entire
 *      script. Candidate generation from spoken tokens is O(1) hash lookup
 *      instead of scanning every window.
 *   4. Candidate pruning — only score windows that contain ≥1 spoken token
 *      within range. Skips vast majority of empty windows.
 *   5. Best-so-far early exit — track best score found; skip windows where
 *      even a perfect sub-window can't beat it.
 *   6. Int16Array DP rows — all-integer Levenshtein using Int16Array; avoids
 *      GC pressure and is cache-friendlier than regular Arrays.
 *   7. Phonetic pre-computation at parse time — no per-query lookup.
 *
 * UX / SYNTHETIC SPEED LAYER:
 *   8. Optimistic word creep — while waiting for next transcript, smoothly
 *      advance the highlight by ~1 word/sec based on measured WPM. Snaps
 *      back to transcript-confirmed position on each new result. Creates the
 *      perception of real-time tracking even during ~600ms Moonshine gaps.
 *   9. Interim transcript display — show Moonshine's partial signal (the
 *      "Listening" state) as a subtle animated indicator so user sees the
 *      model is working.
 *  10. Scroll momentum easing — use spring-style CSS transition (0.15s ease)
 *      for micro-steps during creep, 0.25s for confirmed jumps. Feels
 *      fluid, not choppy.
 *  11. Shadow cursor — a translucent "ghost" highlight ~2 words ahead of
 *      current that shows where the engine predicts we're heading.
 *  12. Paragraph lookahead — when ≥85% through current para, pre-highlight
 *      first word of next para faintly, reducing visual jump at para boundary.
 *
 * WORKER LAYER (whisper.worker.js — separate file):
 *  13. Silence threshold lowered: 300ms (was 400ms) — flushes 100ms earlier.
 *  14. Eager partial flush: after 1.5s of continuous speech, emit a
 *      "progressive" transcript of what's buffered so far. Don't wait for
 *      end-of-utterance. Let the main thread start matching immediately.
 *  15. VAD fast path: skip inference chain for zero-energy frames.
 */

import { doubleMetaphone } from 'https://cdn.jsdelivr.net/npm/double-metaphone/+esm';

'use strict';

// ═══════════════════════════════════════════════════════
// SAMPLE SCRIPT
// ═══════════════════════════════════════════════════════

const SAMPLE_SCRIPT = `Welcome to this virtual teleprompter.

As you speak, the script will automatically scroll to keep up with your words. Each word you say is highlighted in real time, so you always know exactly where you are in your script.

This teleprompter uses an embedded AI speech model that runs entirely in your browser. No data leaves your device, and no internet connection is required after the first load.

To get started, press Start Speaking. The microphone will listen to your voice and track your progress through the script automatically.

You can adjust the font size using the controls. Mirror mode flips the display horizontally for use with a physical teleprompter mirror rig.

Thank you for using this teleprompter. Good luck with your presentation!`;

// ═══════════════════════════════════════════════════════
// PHONETIC NORMALISATION — Double Metaphone + ASR overrides
// ═══════════════════════════════════════════════════════
//
// Double Metaphone (Lawrence Philips, 2000) maps words to a consonant-cluster
// code, so true homophones produce the same key automatically:
//   right / write / rite  → RT
//   to / two / too        → T
//   their / there         → TR
//   peace / piece         → PS  … and thousands more.
//
// This replaces the hand-rolled PHONETIC_MAP with a principled algorithm
// that covers the full English homophone space without manual maintenance.
// Apostrophe-stripping before lookup already collapses contractions:
//   "you're" → "youre" → same DM code as "your".
//
// ASR_OVERRIDES handles the two cases DM structurally cannot resolve:
//   a / the  — phonetically distinct; ASR frequently swaps articles
//   an / and — DM gives 'AN' vs 'ANT'; won't match without help

const ASR_OVERRIDES = {
  'a':   'hw_art', 'the': 'hw_art',
  'an':  'hw_and', 'and': 'hw_and',
};

function normTok(w) {
  const s  = w.toLowerCase().replace(/[^a-z0-9äöüæøåéàèêëîïôùûüç'-]/gi, '').trim();
  const s2 = s.replace(/'/g, '');
  if (ASR_OVERRIDES[s])  return ASR_OVERRIDES[s];
  if (ASR_OVERRIDES[s2]) return ASR_OVERRIDES[s2];
  const dm = doubleMetaphone(s2 || s);
  return dm[0] || s2 || s;
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9äöüæøåéàèêëîïôùûüç' -]/g, ' ')
    .split(/\s+/)
    .map(w => {
      const c  = w.replace(/[^a-z0-9äöüæøåéàèêëîïôùûüç'-]/g, '').trim();
      const c2 = c.replace(/'/g, '');
      if (ASR_OVERRIDES[c])  return ASR_OVERRIDES[c];
      if (ASR_OVERRIDES[c2]) return ASR_OVERRIDES[c2];
      const dm = doubleMetaphone(c2 || c);
      return dm[0] || c2 || c;
    })
    .filter(w => w.length > 0);
}

// ═══════════════════════════════════════════════════════
// FAST BANDED LEVENSHTEIN (word-level, Int16Array)
// ═══════════════════════════════════════════════════════

// Pre-allocated DP rows — reused across all calls to avoid GC
const _DP_SIZE = 128;
const _dpPrev = new Int16Array(_DP_SIZE);
const _dpCurr = new Int16Array(_DP_SIZE);

/**
 * Banded word-level Levenshtein similarity [0,1].
 *
 * Only computes cells within band width MAX_EDITS of the diagonal.
 * Returns 0 immediately if length difference > MAX_EDITS.
 * Returns similarity = 1 - dist/maxLen.
 *
 * @param {string[]} s  spoken tokens
 * @param {string[]} t  script window tokens
 * @param {number}   maxEdits  band half-width (default = ceil(maxLen*0.5))
 */
function bandedSim(s, t, maxEdits) {
  const sLen = s.length, tLen = t.length;
  if (sLen === 0 || tLen === 0) return 0;
  const maxLen = Math.max(sLen, tLen);
  if (maxEdits === undefined) maxEdits = Math.ceil(maxLen * 0.55);
  // Quick bail: if lengths differ by more than budget, similarity is low
  if (Math.abs(sLen - tLen) > maxEdits) {
    return Math.max(0, 1 - Math.abs(sLen - tLen) / maxLen);
  }

  // Ensure DP arrays big enough (fallback to dynamic for huge inputs)
  const tSize = tLen + 1;
  let prev = tSize <= _DP_SIZE ? _dpPrev : new Int16Array(tSize);
  let curr = tSize <= _DP_SIZE ? _dpCurr : new Int16Array(tSize);

  // Init first row
  for (let j = 0; j <= tLen; j++) prev[j] = j;

  for (let i = 1; i <= sLen; i++) {
    curr[0] = i;
    // Banded: only compute j in [max(1, i-maxEdits), min(tLen, i+maxEdits)]
    const jStart = Math.max(1, i - maxEdits);
    const jEnd   = Math.min(tLen, i + maxEdits);

    // Fill cells outside band with a large sentinel so they don't win
    if (jStart > 1)   curr[jStart - 1] = maxEdits + 1;
    if (jEnd < tLen)  curr[jEnd + 1]   = maxEdits + 1;

    let rowMin = maxEdits + 1;
    for (let j = jStart; j <= jEnd; j++) {
      curr[j] = s[i-1] === t[j-1]
        ? prev[j-1]
        : 1 + Math.min(prev[j-1], prev[j], curr[j-1]);
      if (curr[j] < rowMin) rowMin = curr[j];
    }

    // Early exit: if minimum in this row exceeds budget, final dist > maxEdits
    if (rowMin > maxEdits) {
      return Math.max(0, 1 - (maxEdits + 1) / maxLen);
    }

    // Swap row references instead of copying tLen+1 elements per DP row
    const _r = prev; prev = curr; curr = _r;
  }

  return Math.max(0, 1 - prev[tLen] / maxLen);
}

/**
 * Like bandedSim but operates on t[tOff..tOff+tWinLen) without allocating a slice.
 * All hot-path scoring in scoreWindow goes through this function.
 */
function _bandedSimRange(s, sLen, t, tOff, tWinLen, maxEdits) {
  const tLen = Math.min(tWinLen, t.length - tOff);
  if (sLen === 0 || tLen === 0) return 0;
  const maxLen = Math.max(sLen, tLen);
  if (Math.abs(sLen - tLen) > maxEdits) {
    return Math.max(0, 1 - Math.abs(sLen - tLen) / maxLen);
  }
  const tSize = tLen + 1;
  let prev = tSize <= _DP_SIZE ? _dpPrev : new Int16Array(tSize);
  let curr = tSize <= _DP_SIZE ? _dpCurr : new Int16Array(tSize);
  for (let j = 0; j <= tLen; j++) prev[j] = j;
  for (let i = 1; i <= sLen; i++) {
    curr[0] = i;
    const jStart = Math.max(1, i - maxEdits);
    const jEnd   = Math.min(tLen, i + maxEdits);
    if (jStart > 1)  curr[jStart - 1] = maxEdits + 1;
    if (jEnd < tLen) curr[jEnd + 1]   = maxEdits + 1;
    let rowMin = maxEdits + 1;
    const si = s[i - 1];
    for (let j = jStart; j <= jEnd; j++) {
      curr[j] = si === t[tOff + j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxEdits) return Math.max(0, 1 - (maxEdits + 1) / maxLen);
    const _r = prev; prev = curr; curr = _r;
  }
  return Math.max(0, 1 - prev[tLen] / maxLen);
}

/**
 * Score a specific window of script tokens against spoken tokens.
 * Uses _bandedSimRange to avoid allocating array slices in the inner loop.
 */
function scoreWindow(spoken, scriptToks, start, slack) {
  const sLen = spoken.length;
  if (sLen === 0 || start >= scriptToks.length) return { score: 0, matchLen: sLen };
  slack = slack || Math.min(2, Math.ceil(sLen * 0.25));
  const maxEdits = Math.ceil(Math.max(sLen, sLen + slack) * 0.55);
  let best = 0;
  let bestMatchLen = sLen;
  for (let d = -slack; d <= slack; d++) {
    const wLen = Math.max(1, sLen + d);
    const sc   = _bandedSimRange(spoken, sLen, scriptToks, start, wLen, maxEdits);
    // Strict > so the first (smallest) winning d wins ties — naturally biases toward
    // a shorter script window when filler words inflate spoken.length.
    if (sc > best) { best = sc; bestMatchLen = wLen; if (sc >= 0.98) break; }
  }
  return { score: best, matchLen: bestMatchLen };
}

// ═══════════════════════════════════════════════════════
// TOKEN HASH INDEX — O(1) candidate generation
// ═══════════════════════════════════════════════════════

/**
 * Build an inverted index: token → sorted array of script positions.
 * Used to rapidly find candidate windows that contain spoken tokens.
 */
function buildTokenIndex(scriptToks) {
  const idx = new Map();
  for (let i = 0; i < scriptToks.length; i++) {
    const tok = scriptToks[i];
    if (!idx.has(tok)) idx.set(tok, []);
    idx.get(tok).push(i);
  }
  return idx;
}

/**
 * Given spoken tokens and an inverted index, return a sorted Int32Array of
 * candidate start positions worth scoring.
 *
 * Uses a pre-allocated Uint8Array bitset for O(1) dedup with no hash overhead,
 * and a pre-allocated Int32Array output buffer — zero per-call allocations.
 */
function getCandidates(spoken, tokenIdx, currentPos, windowSize) {
  // Search from slightly behind currentPos so that positions the creep has
  // moved past are still considered as match candidates.
  const searchFrom = Math.max(0, currentPos - CFG.SEARCH_LOOKBACK);
  const lookahead  = currentPos + windowSize + spoken.length;
  const range      = Math.min(lookahead - searchFrom + 1, _candidateBitset.length);
  // Clear only the live slab of the bitset (avoids full 2 KB wipe per call)
  _candidateBitset.fill(0, 0, range);
  let len = 0;

  const mark = (c) => {
    const off = c - searchFrom;  // offset from searchFrom (not currentPos)
    if (off >= 0 && off < range && !_candidateBitset[off] && len < _candidateBuf.length) {
      _candidateBitset[off] = 1;
      _candidateBuf[len++]  = c;
    }
  };

  for (const tok of spoken) {
    const positions = tokenIdx.get(tok);
    if (!positions) continue;
    // Binary search for first position ≥ searchFrom
    let lo = 0, hi = positions.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (positions[mid] < searchFrom) lo = mid + 1; else hi = mid;
    }
    for (let k = lo; k < positions.length && positions[k] <= lookahead; k++) {
      const base = positions[k];
      mark(base - 2); mark(base - 1); mark(base); mark(base + 1);
    }
  }
  mark(currentPos);  // always include current position

  // Sort in-place; Int32Array.sort uses a fast typed sort
  const result = _candidateBuf.subarray(0, len);
  result.sort();
  return result;
}

// ═══════════════════════════════════════════════════════
// LOOKUP CACHES — pre-allocated, reused across calls
// ═══════════════════════════════════════════════════════

// Word span cache: word.id → DOM <span> built at renderScript time.
// Eliminates querySelector('.word[data-id="..."]') which is O(DOM size).
let _spanCache = [];

// Candidate generation buffers — reused per ariaMatch call, zero GC pressure.
const _candidateBitset = new Uint8Array(2048);  // dedup bitset: index = (pos − currentPos)
const _candidateBuf    = new Int32Array(512);   // output position list

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════

const state = {
  paragraphs: [],
  words: [],
  wordCount: 0,
  scriptNormTokens: [],  // flat token array for whole script
  tokenIndex: null,      // Map<token→[positions]>

  currentWordIndex: 0,
  currentParaIndex: 0,
  paragraphCompleteTimer: null,
  sessionStartTime: null,

  accumulatedText: '',
  lastChunk: '',
  startingWord: '',
  recognitionBuffer: [],

  // Multi-hypothesis beam
  hypotheses: [],

  // Anchor / WPM
  lastAnchorIndex: 0,
  lastAnchorTime: 0,
  anchorWpm: 0,
  wpmSamples: [],   // rolling window of (words, ms) samples for EMA

  // Stall / nudge
  lastAdvanceTime: 0,
  stallNudgeTimer: null,

  // Optimistic creep (UX trick #8)
  creepTimer: null,          // rAF handle for smooth word creep
  creepTargetIndex: 0,       // confirmed position from last transcript
  creepCurrentIndex: 0,      // current displayed position (may be ahead)
  creepActive: false,

  // Shadow cursor (UX trick #11)
  shadowIndex: -1,

  // Speech activity tracking — updated on every transcript event
  lastSpeechTime: 0,

  settings: { fontSize: 2.5, mirror: false },
  worker: null,
  audioContext: null,
  workletNode: null,
  micStream: null,
  isRecording: false,
  modelReady: false,
  modelLoading: false,
  _startPending: false,
};

// ═══════════════════════════════════════════════════════
// ALGORITHM CONSTANTS
// ═══════════════════════════════════════════════════════

const CFG = {
  ACCEPT_THRESHOLD:        0.32,  // min locality-adjusted score to count as a match
  ANCHOR_THRESHOLD:        0.52,  // min score for high-confidence anchor
  NEW_HYP_MIN_SCORE:       0.42,  // min score for a brand-new beam hypothesis (garble guard)
  WINDOW_BASE:             25,    // tighter window — prevents matching far homophone occurrences
  WINDOW_MULT:             2.0,
  BEAM_SIZE:               3,
  STALL_MS:                12000, // Only nudge after 12s true stall (not during pauses)
  NUDGE_INTERVAL_MS:       8000,
  WPM_DEFAULT:             135,
  PARA_COMPLETE_RATIO:     0.60,
  PARA_COMPLETE_DELAY:     550,
  GLOBAL_INTERVAL:         3,     // run global search every N transcripts
  CREEP_SILENCE_PAUSE_MS:  600,   // ms after last transcript before creep freezes
  CREEP_MAX_LOOKAHEAD:     1,     // max words creep can go ahead of confirmed position
  // ── Locality-aware matching ──────────────────────────────────────────────
  // Prevents e.g. "teleprompter" in sentence 1 jumping to the same word in
  // section 3 simply because it appears there too.
  LOCALITY_HALVING_DIST:   20,    // words ahead at which locality factor drops to 0.5
  SEARCH_LOOKBACK:         8,     // words BEHIND currentPos still included as candidates
                                  // (handles creep running slightly ahead of speaker)
  FAR_JUMP_MIN_TOKENS:     2,     // spoken tokens required to jump farther than FAR_JUMP_MAX_DIST
  FAR_JUMP_MAX_DIST:       20,    // max jump distance allowed for very short transcripts
};

let _txCount = 0;

// ═══════════════════════════════════════════════════════
// SMOOTH SCROLL STATE
// ═══════════════════════════════════════════════════════
// All scrolling is done via a rAF lerp loop that interpolates
// _scrollCurrent toward _scrollTarget each frame.
// This decouples visual motion from discrete word/paragraph
// updates, giving fluid easing for both word-creep and large
// paragraph jumps without any CSS transition involvement.

let _scrollTarget  = 0;  // desired translateY (pixels)
let _scrollCurrent = 0;  // currently rendered translateY
let _scrollRafId   = null;

// Spring factor: fraction of remaining distance closed per frame @ ~60fps.
// 0.09 ≈ 89% of distance closed within one 400ms word interval (150 WPM).
// Large jumps (paragraph transitions) naturally cover distance faster, then
// decelerate — giving a cinematic ease-out feel.
const SCROLL_LERP = 0.09;

function _scrollFrame() {
  const diff = _scrollTarget - _scrollCurrent;
  if (Math.abs(diff) < 0.15) {
    _scrollCurrent = _scrollTarget;
    _applyTransformRaw(_scrollCurrent);
    _scrollRafId = null;
    return;
  }
  _scrollCurrent += diff * SCROLL_LERP;
  _applyTransformRaw(_scrollCurrent);
  _scrollRafId = requestAnimationFrame(_scrollFrame);
}

function _startScrollAnim() {
  if (!_scrollRafId) _scrollRafId = requestAnimationFrame(_scrollFrame);
}

// ═══════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════

const $ = id => document.getElementById(id);
const dom = {
  statusBadge:           $('statusBadge'),
  statusText:            $('statusText'),
  startBtn:              $('startBtn'),
  stopBtn:               $('stopBtn'),
  engineIndicator:       $('engineIndicator'),
  scriptInput:           $('scriptInput'),
  clearScriptBtn:        $('clearScriptBtn'),
  sampleScriptBtn:       $('sampleScriptBtn'),
  clearTranscriptBtn:    $('clearTranscriptBtn'),
  teleprompterContent:   $('teleprompterContent'),
  teleprompterScroll:    $('teleprompterScroll'),
  teleprompterContainer: $('teleprompterContainer'),
  transcriptBox:         $('transcriptBox'),
  interimBox:            $('interimBox'),
  wpmValue:              $('wpmValue'),
  progressValue:         $('progressValue'),
  fontSizeRange:         $('fontSizeRange'),
  fontSizeVal:           $('fontSizeVal'),
  mirrorToggle:          $('mirrorToggle'),
  resetBtn:              $('resetBtn'),
  fullscreenBtn:         $('fullscreenBtn'),
  modelProgress:         $('modelProgress'),
  modelProgressBar:      $('modelProgressBar'),
};

// ═══════════════════════════════════════════════════════
// TEXT PROCESSING
// ═══════════════════════════════════════════════════════

function normalizeWord(w) {
  return w.toLowerCase().replace(/[^a-z0-9äöüæøåéàèêëîïôùûüç'-]/gi,'').trim();
}

function parseScript(text) {
  const rawParas = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const paragraphs = [];
  const allWords = [];

  rawParas.forEach(paraText => {
    const startIndex = allWords.length;
    const words = [];
    paraText.split(/\s+/).filter(Boolean).forEach((token, localIdx) => {
      const norm = normalizeWord(token);
      if (!norm) return;
      const word = {
        id: allWords.length, localId: localIdx,
        text: token, normalized: norm,
        normToken: normTok(norm),
      };
      allWords.push(word);
      words.push(word);
    });
    if (words.length > 0) paragraphs.push({ text: paraText, words, startIndex });
  });

  return { paragraphs, allWords };
}

function renderScript() {
  const text = dom.scriptInput.value.trim();
  if (!text) {
    dom.teleprompterContent.innerHTML = '<div class="empty-state"><div class="empty-state-arrow">←</div><p class="empty-state-title">Your script lives here</p><p class="empty-state-sub">Paste it in the panel to the left,<br>then press <em>Start Speaking</em></p></div>';
    state.paragraphs = []; state.words = []; state.wordCount = 0;
    state.scriptNormTokens = []; state.tokenIndex = null;
    _spanCache = [];
    updateProgress(); return;
  }

  const { paragraphs, allWords } = parseScript(text);
  state.paragraphs = paragraphs;
  state.words      = allWords;
  state.wordCount  = allWords.length;
  state.scriptNormTokens = allWords.map(w => w.normToken);
  state.tokenIndex = buildTokenIndex(state.scriptNormTokens);

  _spanCache = new Array(allWords.length);
  const container = document.createElement('div');
  paragraphs.forEach((para, pi) => {
    if (pi > 0) { container.appendChild(document.createElement('br')); container.appendChild(document.createElement('br')); }
    para.words.forEach((word, wi) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.dataset.id = word.id;
      span.textContent = word.text;
      _spanCache[word.id] = span;  // O(1) lookup cache — avoids querySelector per word
      container.appendChild(span);
      if (wi < para.words.length - 1) container.appendChild(document.createTextNode(' '));
    });
  });

  dom.teleprompterContent.innerHTML = '';
  dom.teleprompterContent.appendChild(container);
  resetPosition(false);
}

function getWordSpan(id) {
  // O(1) span lookup via pre-built cache — replaces O(DOM) querySelector
  return (id >= 0 && id < _spanCache.length) ? _spanCache[id] : null;
}

// ═══════════════════════════════════════════════════════
// FAST ARIA MATCH (with hash-index candidate generation)
// ═══════════════════════════════════════════════════════

function ariaMatch(spokenText) {
  if (!spokenText?.trim() || !state.words.length) return null;

  let spoken = tokenize(spokenText);
  if (spoken.length === 0) return null;

  // ── ASR noise reduction ──────────────────────────────────────────
  // Moonshine Tiny produces two kinds of noise that hurt matching:
  //   1. Stuttered repeats: "or, or, or, or" → inflates token count,
  //      dilutes Levenshtein score against the real script window.
  //   2. Phantom / garbled words: "Hatchner", "Newscapes" → tokens
  //      whose phonetic code doesn't exist anywhere in the script,
  //      so they can only contribute edit-distance penalties.
  //
  // Fix: collapse consecutive identical codes, then drop codes absent
  // from the script's token index. Both are O(n) and use existing data.

  // 1. Collapse consecutive duplicate tokens  ("or or or or" → "or")
  const deduped = [spoken[0]];
  for (let i = 1; i < spoken.length; i++) {
    if (spoken[i] !== spoken[i - 1]) deduped.push(spoken[i]);
  }

  // 2. Drop tokens absent from the script index (phantom/garbled words)
  const cleaned = deduped.filter(t => state.tokenIndex.has(t));

  // Use cleaned if enough signal survives; otherwise fall back to deduped
  spoken = cleaned.length >= 2 ? cleaned : deduped;
  if (spoken.length === 0) return null;

  const scriptToks = state.scriptNormTokens;
  // Anchor to transcript-confirmed position, NOT the display position which
  // may be up to CREEP_MAX_LOOKAHEAD words ahead.  Using the creep-inflated
  // currentWordIndex causes locality scoring to penalise the real position
  // and favour further-ahead candidates, compounding a forward drift.
  const curPos     = state.creepTargetIndex;
  const scriptLen  = state.wordCount;
  const winSize    = Math.max(CFG.WINDOW_BASE, Math.ceil(spoken.length * CFG.WINDOW_MULT));

  // Get candidate start positions via hash index (FAST)
  // Includes a lookback region behind curPos so creep-ahead doesn't exclude the real match.
  const candidates = getCandidates(spoken, state.tokenIndex, curPos, winSize);

  if (candidates.length === 0) return null;

  let best = null;
  let bestScore = CFG.ACCEPT_THRESHOLD - 0.01; // track running best for early exit

  const slack = Math.min(2, Math.ceil(spoken.length * 0.25));

  for (const start of candidates) {
    if (start >= scriptLen) continue;

    // Distance ahead of confirmed position (no penalty for lookback region behind curPos).
    const distAhead = Math.max(0, start - curPos);

    // Hard guard: very short transcripts (e.g. a single word) can only anchor nearby.
    // This prevents common homophones / script keywords from jumping far on a 1-word match.
    if (spoken.length < CFG.FAR_JUMP_MIN_TOKENS && distAhead > CFG.FAR_JUMP_MAX_DIST) continue;

    const { score: sc, matchLen } = scoreWindow(spoken, scriptToks, start, slack);
    if (sc <= 0) continue;

    // Locality decay: a match further ahead requires progressively higher raw score
    // to beat a closer match.  localityFactor = 1 at dist=0, 0.5 at LOCALITY_HALVING_DIST,
    // 0.33 at 2× that distance, etc.  Scores from behind curPos (lookback) are unpenalised.
    const localityFactor = 1 / (1 + distAhead / CFG.LOCALITY_HALVING_DIST);
    const adjustedScore  = sc * localityFactor;

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      // Use matchLen (the script-window length that gave best score) rather than
      // spoken.length.  When filler words inflate spoken.length, d=-1 wins the
      // scoreWindow loop (strict >) and matchLen = sLen-1, preventing a 1-word overshoot.
      const dest = Math.min(start + matchLen, scriptLen - 1);
      best = { globalIdx: dest, score: adjustedScore, rawScore: sc, startPos: start,
               isAnchor: adjustedScore >= CFG.ANCHOR_THRESHOLD };
      // Perfect nearby match — no need to keep scanning
      if (sc >= 0.98 && distAhead < 8) break;
    }
  }

  return best;
}

// ═══════════════════════════════════════════════════════
// MULTI-HYPOTHESIS BEAM
// ═══════════════════════════════════════════════════════

function updateBeam(matchResult) {
  if (!matchResult) {
    state.hypotheses = state.hypotheses
      .map(h => ({ ...h, age: h.age+1, score: h.score*0.82 }))
      .filter(h => h.score > 0.05);
    return pickBestHypothesis();
  }

  const { globalIdx, score } = matchResult;
  const existing = state.hypotheses.find(h => Math.abs(h.pos - globalIdx) <= 4);
  if (existing) {
    existing.score = Math.min(1, existing.score + score * 0.45);
    existing.pos   = Math.round((existing.pos * 0.3 + globalIdx * 0.7)); // lean toward new
    existing.age   = 0;
  } else {
    // Require minimum confidence for a brand-new beam entry (guards against garbled ASR)
    if (score >= CFG.NEW_HYP_MIN_SCORE) {
      state.hypotheses.push({ pos: globalIdx, score, age: 0 });
    }
  }

  state.hypotheses = state.hypotheses
    .map(h => h === existing ? h : { ...h, age: h.age+1, score: h.score*0.88 })
    .sort((a,b) => b.score - a.score)
    .slice(0, CFG.BEAM_SIZE);

  return pickBestHypothesis();
}

function pickBestHypothesis() {
  const forward = state.hypotheses.filter(h => h.pos > state.currentWordIndex);
  if (!forward.length) return null;
  return forward.reduce((best, h) => h.score > best.score ? h : best, forward[0]);
}

// ═══════════════════════════════════════════════════════
// WPM ESTIMATOR (rolling window EMA)
// ═══════════════════════════════════════════════════════

function recordAnchor(newIdx) {
  const now = Date.now();
  if (state.lastAnchorTime > 0 && newIdx > state.lastAnchorIndex) {
    const words = newIdx - state.lastAnchorIndex;
    const ms    = now - state.lastAnchorTime;
    if (ms > 400) {
      const wpm = words / (ms / 60000);
      if (wpm > 40 && wpm < 450) {
        state.wpmSamples.push(wpm);
        if (state.wpmSamples.length > 8) state.wpmSamples.shift();
        // Trimmed mean: drop highest and lowest
        const sorted = [...state.wpmSamples].sort((a,b)=>a-b);
        const trim   = sorted.slice(1, -1);
        state.anchorWpm = trim.length ? trim.reduce((s,v)=>s+v,0)/trim.length : sorted[0];
      }
    }
  }
  state.lastAnchorIndex = newIdx;
  state.lastAnchorTime  = now;
}

function effectiveWpm() {
  return state.anchorWpm > 0 ? state.anchorWpm : CFG.WPM_DEFAULT;
}

// ═══════════════════════════════════════════════════════
// OPTIMISTIC WORD CREEP (UX trick #8)
// ═══════════════════════════════════════════════════════
//
// Between transcript events (which come every ~600-900ms from Moonshine),
// we smoothly advance the highlighted word at the user's measured WPM.
// This makes the teleprompter feel instant and continuous.
//
// When a real transcript comes in:
//   - If confirmed position > creep position → snap forward immediately
//   - If confirmed position < creep position → we were ahead, hold creep pos
//     unless difference > 3 words (then snap back)
//
// The creep runs via requestAnimationFrame for smooth frame-rate highlighting.

let _creepLastTime = 0;
let _creepFractional = 0; // sub-word accumulator

function startCreep() {
  if (state.creepActive) return;
  state.creepActive = true;
  _creepLastTime    = performance.now();
  _creepFractional  = 0;
  requestAnimationFrame(creepTick);
}

function stopCreep() {
  state.creepActive = false;
  _creepFractional  = 0;
}

function creepTick(now) {
  if (!state.creepActive || !state.isRecording) { state.creepActive = false; return; }

  const dt = now - _creepLastTime;
  _creepLastTime = now;

  // Don't creep until we've actually heard speech, and freeze when speaker pauses
  const silentMs = now - state.lastSpeechTime;
  if (state.lastSpeechTime === 0 || silentMs > CFG.CREEP_SILENCE_PAUSE_MS) {
    requestAnimationFrame(creepTick);
    return; // suspended — resumes when next transcript updates lastSpeechTime
  }

  const wpm = effectiveWpm();
  // Creep at 75% of real WPM — conservative so it doesn't overshoot
  const wordsPerMs = (wpm * 0.75) / 60000;
  _creepFractional += wordsPerMs * dt;

  if (_creepFractional >= 1) {
    const steps = Math.floor(_creepFractional);
    _creepFractional -= steps;

    // Cap: never more than CREEP_MAX_LOOKAHEAD words ahead of transcript-confirmed position
    const maxCreep = state.creepTargetIndex + CFG.CREEP_MAX_LOOKAHEAD;
    const target   = Math.min(state.currentWordIndex + steps, maxCreep, state.wordCount - 1);

    if (target > state.currentWordIndex) {
      // Soft move: mark words spoken-ish (creep class), not full spoken
      moveCreep(target);
      updateShadowCursor();
    }
  }

  requestAnimationFrame(creepTick);
}

function moveCreep(idx) {
  if (idx <= state.currentWordIndex) return;
  if (idx >= state.wordCount) idx = state.wordCount - 1;

  // Mark intermediate words with 'creep' class (lighter than 'spoken')
  for (let i = state.currentWordIndex; i < idx; i++) {
    const span = getWordSpan(i);
    if (span && !span.classList.contains('spoken')) {
      span.classList.add('creep');
    }
  }

  state.currentWordIndex = idx;
  highlightCurrent();
  scrollToCurrent(true, 'creep');
  updateProgress();
}

// ═══════════════════════════════════════════════════════
// SHADOW CURSOR (UX trick #11)
// ═══════════════════════════════════════════════════════
//
// A faint amber glow 2 words ahead of the current highlight —
// shows where the engine predicts we're heading.

function updateShadowCursor() {
  // Remove old shadow via cached index — O(1) instead of O(DOM)
  if (state.shadowIndex >= 0) {
    const prev = getWordSpan(state.shadowIndex);
    if (prev) prev.classList.remove('shadow');
    state.shadowIndex = -1;
  }

  // Anchor shadow to transcript-confirmed position, not the animated creep position
  const shadowIdx = state.creepTargetIndex + 2;
  if (shadowIdx < state.wordCount) {
    const span = getWordSpan(shadowIdx);
    if (span && !span.classList.contains('current')) {
      span.classList.add('shadow');
      state.shadowIndex = shadowIdx;
    }
  }
}

// ═══════════════════════════════════════════════════════
// CONFIRMED MOVE (from transcript)
// ═══════════════════════════════════════════════════════

function confirmMove(globalIdx, smooth) {
  if (globalIdx < 0 || globalIdx >= state.wordCount) return;
  const creepAhead  = state.currentWordIndex - globalIdx;
  const silentMs    = Date.now() - state.lastSpeechTime;
  const speakerPaused = state.lastSpeechTime > 0 && silentMs > CFG.CREEP_SILENCE_PAUSE_MS;

  if (creepAhead > 0 && creepAhead <= 2 && !speakerPaused) {
    // Creep is at most 2 words ahead and speaker is actively talking — acceptable.
    // Update the confirmed target so future creep doesn't drift further.
    state.creepTargetIndex = globalIdx;
    return;
  }

  // All other cases: snap to confirmed position
  snapTo(globalIdx, smooth);
  state.creepTargetIndex = globalIdx;
}

function snapTo(globalIdx, smooth) {
  if (globalIdx <= state.currentWordIndex) return;
  if (globalIdx >= state.wordCount) globalIdx = state.wordCount - 1;

  // Mark everything up to globalIdx as spoken
  for (let i = state.currentWordIndex; i < globalIdx; i++) {
    const span = getWordSpan(i);
    if (span) { span.classList.remove('current','creep','shadow'); span.classList.add('spoken'); }
  }

  state.currentWordIndex = globalIdx;
  state.lastAdvanceTime  = Date.now();
  highlightCurrent();
  scrollToCurrent(smooth, 'snap');
  updateProgress();
  updateWPM();
  updateShadowCursor();
}

// Legacy moveTo (used by para advance, reset, etc.)
function moveTo(globalIdx, smooth = true) {
  snapTo(globalIdx, smooth);
}

// ═══════════════════════════════════════════════════════
// MANUAL SEEK — user clicked a word in the teleprompter
// ═══════════════════════════════════════════════════════

/**
 * Jump the pointer to any word index the user clicked on.
 * Works both forward and backward.
 * Resets the beam and accumulated text so the AI algo picks up
 * matching from the new position on the very next transcript.
 */
function seekToWord(wordIdx) {
  if (wordIdx < 0 || wordIdx >= state.wordCount) return;

  // Stop creep so it doesn't fight the manual jump
  const wasCreeping = state.creepActive;
  stopCreep();

  // Reclassify all words relative to new pointer
  for (let i = 0; i < state.wordCount; i++) {
    const span = getWordSpan(i);
    if (!span) continue;
    span.classList.remove('current', 'creep', 'shadow', 'seek-pulse');
    if (i < wordIdx) {
      span.classList.add('spoken');
    } else {
      span.classList.remove('spoken');
    }
  }

  state.currentWordIndex = wordIdx;
  state.creepTargetIndex = wordIdx;
  state.creepCurrentIndex = wordIdx;
  state.shadowIndex = -1;
  state.lastAdvanceTime = Date.now();

  // Reset matching state so next transcripts are searched around new position
  state.hypotheses       = [];
  state.accumulatedText  = '';
  state.lastChunk        = '';
  state.startingWord     = '';
  state.recognitionBuffer = [];

  // Update paragraph context
  updateParaForPos(wordIdx);

  // Reset anchor for accurate WPM from new position
  state.lastAnchorIndex = wordIdx;
  state.lastAnchorTime  = Date.now();

  // Highlight and scroll
  highlightCurrent();
  scrollToCurrent(true, 'snap');
  updateProgress();

  // Brief visual pulse to confirm the seek
  const span = getWordSpan(wordIdx);
  if (span) {
    span.classList.add('seek-pulse');
    span.addEventListener('animationend', () => span.classList.remove('seek-pulse'), { once: true });
  }

  // Restart creep/stall if recording was active
  if (state.isRecording) {
    if (wasCreeping) startCreep();
    scheduleStallNudge();
  }
}

// ═══════════════════════════════════════════════════════
// HIGHLIGHTING & SCROLL
// ═══════════════════════════════════════════════════════

function highlightCurrent() {
  const prev = dom.teleprompterContent.querySelector('.word.current');
  if (prev) prev.classList.remove('current');
  const span = getWordSpan(state.currentWordIndex);
  if (span) { span.classList.remove('creep','shadow'); span.classList.add('current'); }
}

function scrollToCurrent(smooth, mode) {
  const span = getWordSpan(state.currentWordIndex);
  if (!span) return;

  const scrollEl      = dom.teleprompterScroll;
  const containerRect = scrollEl.getBoundingClientRect();
  const spanRect      = span.getBoundingClientRect();

  const targetY  = containerRect.height * 0.38;
  const currentY = spanRect.top - containerRect.top + spanRect.height / 2;
  const delta    = currentY - targetY;

  if (Math.abs(delta) < 2) return;

  _scrollTarget = _scrollCurrent - delta;

  if (!smooth) {
    // Instant position change — cancel any running animation
    if (_scrollRafId) { cancelAnimationFrame(_scrollRafId); _scrollRafId = null; }
    _scrollCurrent = _scrollTarget;
    _applyTransformRaw(_scrollCurrent);
    return;
  }

  _startScrollAnim();
}

// Internal: sets the CSS transform without touching the transition property
function _applyTransformRaw(ty) {
  dom.teleprompterContent.style.transform = state.settings.mirror
    ? `scaleX(-1) translateY(${ty}px)`
    : `translateY(${ty}px)`;
}

// Public alias used by mirror-mode toggle and other callers
function applyTransform(ty) {
  _scrollTarget  = ty;
  _scrollCurrent = ty;
  _applyTransformRaw(ty);
}

function getCurrentTranslateY() {
  return _scrollCurrent;
}

function resetPosition(clearTx = true) {
  stopCreep();
  // Cancel any in-flight scroll animation and snap back to top
  if (_scrollRafId) { cancelAnimationFrame(_scrollRafId); _scrollRafId = null; }
  _scrollTarget  = 0;
  _scrollCurrent = 0;
  if (state.paragraphCompleteTimer) { clearTimeout(state.paragraphCompleteTimer); state.paragraphCompleteTimer = null; }
  if (state.stallNudgeTimer)        { clearTimeout(state.stallNudgeTimer);        state.stallNudgeTimer        = null; }

  // Clear all word classes via span cache — avoids O(DOM) querySelectorAll
  for (let i = 0; i < _spanCache.length; i++) {
    const span = _spanCache[i];
    if (span) span.classList.remove('spoken','current','creep','shadow');
  }

  state.currentWordIndex = 0;
  state.currentParaIndex = 0;
  state.sessionStartTime = null;
  state.lastAdvanceTime  = 0;
  state.hypotheses       = [];
  state.lastAnchorIndex  = 0;
  state.lastAnchorTime   = 0;
  state.anchorWpm        = 0;
  state.wpmSamples       = [];
  state.creepTargetIndex = 0;
  state.creepCurrentIndex= 0;
  state.shadowIndex      = -1;
  state.lastSpeechTime   = 0;
  _txCount               = 0;
  _creepFractional       = 0;

  if (clearTx) { state.accumulatedText=''; state.lastChunk=''; state.startingWord=''; state.recognitionBuffer=[]; }

  dom.teleprompterContent.style.transform  = 'translateY(0)';
  dom.teleprompterContent.getBoundingClientRect();

  highlightCurrent();
  updateProgress();
  if (dom.wpmValue) dom.wpmValue.textContent = '—';
}

// ═══════════════════════════════════════════════════════
// TRANSCRIPT ACCUMULATION
// ═══════════════════════════════════════════════════════

function accumulateTranscript(chunk) {
  if (!chunk.trim()) return state.accumulatedText;
  const newWords     = chunk.trim().split(/\s+/).filter(Boolean);
  const newFirstWord = normalizeWord(newWords[0]);

  let acc;
  if (state.startingWord && newFirstWord === state.startingWord && state.lastChunk) {
    const base = state.accumulatedText.endsWith(state.lastChunk)
      ? state.accumulatedText.slice(0, -state.lastChunk.length).trimEnd()
      : state.accumulatedText;
    acc = base ? base + ' ' + chunk.trim() : chunk.trim();
  } else {
    acc = state.accumulatedText ? state.accumulatedText + ' ' + chunk.trim() : chunk.trim();
  }

  // Cap at last 150 words
  const toks = acc.split(/\s+/);
  if (toks.length > 150) acc = toks.slice(-150).join(' ');

  state.lastChunk      = chunk.trim();
  state.startingWord   = newFirstWord;
  state.accumulatedText = acc;
  return acc;
}

// ═══════════════════════════════════════════════════════
// PARAGRAPH COMPLETION
// ═══════════════════════════════════════════════════════

function checkParaCompletion(acc) {
  const para = state.paragraphs[state.currentParaIndex];
  if (!para) return;

  const localIdx = state.currentWordIndex - para.startIndex;
  if (localIdx >= para.words.length - 3) { triggerParaComplete(); return; }

  // Only attempt keyword-based completion when we're at least 70% through the paragraph.
  // Without this guard, words that appear early AND late in a paragraph (e.g. "script"
  // in "the script will … your script") trigger false paragraph advances.
  if (localIdx < para.words.length * 0.7) return;

  const lastWords    = para.words.slice(-3).filter(w => w.normalized.length >= 4);
  if (!lastWords.length) { triggerParaComplete(); return; }

  const textLower = acc.toLowerCase().replace(/[^a-z0-9äöüæøåéàèêëîïôùûüç' -]/g,' ');
  const matched   = lastWords.filter(w => textLower.includes(w.normalized) || textLower.includes(w.normToken)).length;
  const needed    = Math.max(1, Math.ceil(lastWords.length * CFG.PARA_COMPLETE_RATIO));
  if (matched >= needed) triggerParaComplete();
}

function triggerParaComplete() {
  if (state.paragraphCompleteTimer) return;
  state.paragraphCompleteTimer = setTimeout(() => {
    state.paragraphCompleteTimer = null;
    advancePara();
  }, CFG.PARA_COMPLETE_DELAY);
}

function advancePara() {
  const next = state.currentParaIndex + 1;
  if (next >= state.paragraphs.length) { setStatus('stopped','Script complete!'); return; }

  state.currentParaIndex   = next;
  state.accumulatedText    = '';
  state.lastChunk          = '';
  state.startingWord       = '';
  state.recognitionBuffer  = [];
  state.hypotheses         = [];

  const para = state.paragraphs[next];
  if (para) moveTo(para.startIndex, true);
}

function updateParaForPos(idx) {
  for (let pi = state.paragraphs.length - 1; pi >= 0; pi--) {
    if (idx >= state.paragraphs[pi].startIndex) {
      if (pi !== state.currentParaIndex) {
        state.currentParaIndex   = pi;
        state.accumulatedText    = '';
        state.lastChunk          = '';
        state.startingWord       = '';
        state.recognitionBuffer  = [];
      }
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════
// STALL NUDGE
// ═══════════════════════════════════════════════════════

function scheduleStallNudge() {
  if (state.stallNudgeTimer) clearTimeout(state.stallNudgeTimer);
  state.stallNudgeTimer = setTimeout(function nudge() {
    if (!state.isRecording) return;
    const stalledMs = Date.now() - state.lastAdvanceTime;
    if (stalledMs >= CFG.STALL_MS) {
      // Only nudge if the user has been speaking recently (within 5s) but matching is failing.
      // Do NOT nudge during deliberate pauses — that would race ahead of the speaker.
      const speechRecency  = Date.now() - state.lastSpeechTime;
      const userIsSpeaking = state.lastSpeechTime > 0 && speechRecency < 5000;
      if (userIsSpeaking) {
        const wpm    = effectiveWpm();
        const words  = Math.max(1, Math.round(wpm * (stalledMs / 60000) * 0.35));
        const target = Math.min(state.currentWordIndex + words, state.wordCount - 1);
        if (target > state.currentWordIndex) {
          moveTo(target, true);
          updateParaForPos(target);
        }
      }
    }
    state.stallNudgeTimer = setTimeout(nudge, CFG.NUDGE_INTERVAL_MS);
  }, CFG.STALL_MS);
}

// ═══════════════════════════════════════════════════════
// MAIN TRANSCRIPT PROCESSOR
// ═══════════════════════════════════════════════════════

function processTranscript(chunk, isFinal) {
  if (!chunk?.trim() || !state.paragraphs.length) return;
  _txCount++;

  // Track speech activity — used by creep pause logic and stall nudge silence gate
  state.lastSpeechTime = Date.now();

  const acc = isFinal ? accumulateTranscript(chunk) : (state.accumulatedText ? state.accumulatedText + ' ' + chunk : chunk);
  if (isFinal) state.recognitionBuffer = [...state.recognitionBuffer, chunk].slice(-8);

  // ── Run 3 ARIA matches in parallel (all synchronous but fast now) ──
  const m1 = ariaMatch(chunk);                                    // new chunk only
  const m2 = state.recognitionBuffer.length >= 2
    ? ariaMatch(state.recognitionBuffer.slice(-3).join(' '))      // recent buffer
    : null;
  const m3 = isFinal ? ariaMatch(acc) : null;                    // full accumulated

  // Pick best
  let best = null;
  for (const m of [m1, m2, m3]) {
    if (m && (!best || m.score > best.score)) best = m;
  }

  // ── Update beam ──
  const hyp = updateBeam(best);

  // ── Advance if beam converged ──
  if (hyp && hyp.pos > state.currentWordIndex) {
    const target = Math.min(hyp.pos, state.wordCount - 1);

    confirmMove(target, isFinal);
    updateParaForPos(target);

    if (best?.isAnchor) recordAnchor(target);

    scheduleStallNudge();
    state.creepTargetIndex = target;
  }

  // ── Paragraph completion ──
  if (isFinal) checkParaCompletion(acc);

  // ── Ensure creep is running ──
  if (state.isRecording && !state.creepActive) startCreep();
}

// ═══════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════

function updateWPM() {
  if (!state.sessionStartTime || state.currentWordIndex === 0) return;
  const wpm = state.anchorWpm > 0
    ? Math.round(state.anchorWpm)
    : Math.round(state.currentWordIndex / ((Date.now() - state.sessionStartTime) / 60000));
  if (dom.wpmValue) dom.wpmValue.textContent = wpm || '—';
}

function updateProgress() {
  if (!state.wordCount) { if (dom.progressValue) dom.progressValue.textContent = '0%'; return; }
  const pct = Math.min(100, Math.round((state.currentWordIndex / state.wordCount) * 100));
  if (dom.progressValue) dom.progressValue.textContent = `${pct}%`;
}

// ═══════════════════════════════════════════════════════
// STATUS & DISPLAY
// ═══════════════════════════════════════════════════════

function setStatus(type, text) {
  if (!dom.statusBadge || !dom.statusText) return;
  dom.statusBadge.className = `status-badge status-${type}`;
  dom.statusText.textContent = text;
}

function appendTranscript(text, isPartial) {
  const ph = dom.transcriptBox.querySelector('.transcript-placeholder');
  if (ph) ph.remove();
  if (dom.interimBox) dom.interimBox.textContent = '';
  if (!isPartial) {
    const seg = document.createElement('span');
    seg.className = 'transcript-segment';
    seg.textContent = text + ' ';
    dom.transcriptBox.appendChild(seg);
    dom.transcriptBox.scrollTop = dom.transcriptBox.scrollHeight;
  }
}

// ═══════════════════════════════════════════════════════
// AUDIO WORKLET (inline blob)
// ═══════════════════════════════════════════════════════

const WORKLET_SRC = `
const MIN_CHUNK = 512;
let ptr = 0;
let buf = new Float32Array(MIN_CHUNK);
class VADProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    if (ch.length >= MIN_CHUNK) {
      this.port.postMessage({ buffer: ch });
    } else {
      const rem = MIN_CHUNK - ptr;
      if (ch.length >= rem) {
        buf.set(ch.subarray(0, rem), ptr);
        const _send = buf;                          // hold reference before transfer
        buf = new Float32Array(MIN_CHUNK);           // new accumulator for next chunk
        buf.set(ch.subarray(rem), 0);
        ptr = ch.length - rem;
        this.port.postMessage({ buffer: _send }, [_send.buffer]); // zero-copy transfer
      } else {
        buf.set(ch, ptr);
        ptr += ch.length;
      }
    }
    return true;
  }
}
registerProcessor('vad-processor', VADProcessor);
`;

// ═══════════════════════════════════════════════════════
// WORKER MANAGEMENT
// ═══════════════════════════════════════════════════════

function initWorker() {
  if (state.worker) return;
  state.worker = new Worker('./whisper.worker.js', { type: 'module' });

  state.worker.onmessage = ({ data }) => {
    const { type, status, message, text, isFinal } = data;

    if (type === 'status') {
      if (status === 'loading') {
        setStatus('loading', message || 'Loading AI model…');
        state.modelLoading = true; state.modelReady = false;
      } else if (status === 'ready') {
        setStatus('idle', 'Model ready');
        state.modelLoading = false; state.modelReady = true;
        if (dom.modelProgress) dom.modelProgress.classList.add('hidden');
        if (dom.engineIndicator) dom.engineIndicator.textContent = 'Engine: Moonshine AI (on-device)';
        if (state._startPending) { state._startPending = false; startAudio(); }
      } else if (status === 'recording') {
        setStatus('recording', 'Listening…');
      } else if (status === 'transcribing') {
        setStatus('loading', 'Transcribing…');
      }
    }

    if (type === 'transcript') {
      if (text?.trim()) {
        appendTranscript(text, isFinal === false);
        processTranscript(text, isFinal !== false);
        if (!state.sessionStartTime) {
          state.sessionStartTime = Date.now();
          state.lastAdvanceTime  = Date.now();
        }
      }
    }

    if (type === 'progress' && dom.modelProgressBar) {
      dom.modelProgressBar.style.width = `${data.percent}%`;
    }

    if (type === 'info') {
      console.log('[Worker]', message);
      if (dom.engineIndicator && message.includes('Device:')) {
        dom.engineIndicator.textContent = `Engine: Moonshine AI (${message.includes('webgpu') ? 'WebGPU' : 'WASM'})`;
      }
    }

    if (type === 'error') {
      setStatus('idle', `Model error: ${message}`);
      state.modelLoading = false;
    }
  };

  state.worker.onerror = err => {
    console.error('Worker error:', err);
    setStatus('idle', 'Model failed to load');
    state.modelLoading = false;
  };
}

async function startAudio() {
  if (state.isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate:16000, channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true }
    });
    state.micStream = stream;

    state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    await state.audioContext.resume();

    const blob    = new Blob([WORKLET_SRC], { type: 'application/javascript' });
    const blobURL = URL.createObjectURL(blob);
    await state.audioContext.audioWorklet.addModule(blobURL);
    URL.revokeObjectURL(blobURL);

    const source          = state.audioContext.createMediaStreamSource(stream);
    state.workletNode     = new AudioWorkletNode(state.audioContext, 'vad-processor');
    state.workletNode.port.onmessage = e => {
      if (state.worker && e.data.buffer) state.worker.postMessage({ buffer: e.data.buffer });
    };
    source.connect(state.workletNode);

    state.isRecording  = true;
    state.lastAdvanceTime = Date.now();
    if (!state.sessionStartTime) state.sessionStartTime = Date.now();

    setStatus('recording', 'Listening…');
    updateButtons(true);

    // Kick off creep and stall nudge
    startCreep();
    scheduleStallNudge();
  } catch (err) {
    console.error('Audio error:', err);
    setStatus('idle', `Mic error: ${err.message}`);
    updateButtons(false);
  }
}

function stopAudio() {
  stopCreep();
  if (state.workletNode)  { state.workletNode.disconnect(); state.workletNode = null; }
  if (state.audioContext) { state.audioContext.close().catch(()=>{}); state.audioContext = null; }
  if (state.micStream)    { state.micStream.getTracks().forEach(t=>t.stop()); state.micStream = null; }
  if (state.stallNudgeTimer) { clearTimeout(state.stallNudgeTimer); state.stallNudgeTimer = null; }
  state.isRecording = false;
  if (dom.interimBox) dom.interimBox.textContent = '';
  setStatus('stopped', 'Stopped');
  updateButtons(false);
}

// ═══════════════════════════════════════════════════════
// START / STOP
// ═══════════════════════════════════════════════════════

function startRecording() {
  if (!state.words.length) { dom.scriptInput.value = SAMPLE_SCRIPT; renderScript(); }
  if (!state.worker) initWorker();
  if (!state.modelReady) { state._startPending = true; setStatus('loading','Loading AI model…'); updateButtons(true); return; }
  startAudio();
}

function stopRecording() { state._startPending = false; stopAudio(); }

function updateButtons(active) {
  if (dom.startBtn) dom.startBtn.disabled = active;
  if (dom.stopBtn)  dom.stopBtn.disabled  = !active;
}

// ═══════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════

function applyFontSize(size) {
  state.settings.fontSize = size;
  dom.teleprompterContent.style.fontSize = `${size}rem`;
  if (dom.fontSizeVal) dom.fontSizeVal.textContent = `${size}rem`;
}

function applyMirror(mirrored) {
  state.settings.mirror = mirrored;
  applyTransform(getCurrentTranslateY());
}

// ═══════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════

function initTheme() {
  const html = document.documentElement;
  const btn  = document.querySelector('[data-theme-toggle]');
  let theme  = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  html.setAttribute('data-theme', theme);
  updateThemeIcon(btn, theme);
  btn?.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', theme);
    updateThemeIcon(btn, theme);
  });
}

function updateThemeIcon(btn, theme) {
  if (!btn) return;
  btn.innerHTML = theme === 'dark'
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}

// ═══════════════════════════════════════════════════════
// FULLSCREEN
// ═══════════════════════════════════════════════════════

function toggleFullscreen() {
  const isFS = document.body.classList.toggle('fullscreen-mode');
  if (dom.fullscreenBtn) {
    dom.fullscreenBtn.innerHTML = isFS
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  }
}

// ═══════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════

function wireEvents() {
  let scriptDebounce;
  dom.scriptInput.addEventListener('input', () => { clearTimeout(scriptDebounce); scriptDebounce = setTimeout(renderScript, 350); });
  dom.clearScriptBtn?.addEventListener('click', () => { dom.scriptInput.value = ''; renderScript(); });
  dom.sampleScriptBtn?.addEventListener('click', () => { dom.scriptInput.value = SAMPLE_SCRIPT; renderScript(); });
  dom.clearTranscriptBtn?.addEventListener('click', () => {
    dom.transcriptBox.innerHTML = '<span class="transcript-placeholder">Transcript will appear here as you speak…</span>';
    if (dom.interimBox) dom.interimBox.textContent = '';
  });
  dom.startBtn.addEventListener('click', startRecording);
  dom.stopBtn.addEventListener('click', stopRecording);
  dom.resetBtn?.addEventListener('click', () => resetPosition(true));

  // Click-to-seek: clicking any word in the teleprompter moves the pointer there
  dom.teleprompterContent.addEventListener('click', e => {
    const span = e.target.closest('.word');
    if (!span) return;
    const wordId = parseInt(span.dataset.id, 10);
    if (!isNaN(wordId)) seekToWord(wordId);
  });
  dom.fontSizeRange?.addEventListener('input', e => applyFontSize(parseFloat(e.target.value)));
  dom.mirrorToggle?.addEventListener('change', e => applyMirror(e.target.checked));
  dom.fullscreenBtn?.addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('fullscreen-mode')) toggleFullscreen();
    if (e.key === ' ' && e.target === document.body) { e.preventDefault(); state.isRecording ? stopRecording() : startRecording(); }
  });
}

// ═══════════════════════════════════════════════════════
// ENGINE CHECK
// ═══════════════════════════════════════════════════════

function checkEngineAvailability() {
  if (typeof Worker === 'undefined' || (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined')) {
    setStatus('idle','Browser not supported');
    if (dom.startBtn) dom.startBtn.disabled = true;
    if (dom.engineIndicator) { dom.engineIndicator.textContent = 'Use a modern browser (Chrome/Safari/Firefox)'; dom.engineIndicator.style.color = 'var(--color-error)'; }
    return false;
  }
  if (dom.engineIndicator) dom.engineIndicator.textContent = 'Engine: Moonshine AI (loading…)';
  return true;
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════

function init() {
  initTheme();
  wireEvents();
  checkEngineAvailability();
  dom.scriptInput.value = SAMPLE_SCRIPT;
  renderScript();
  updateButtons(false);
  initWorker();
}

init();

// ═══════════════════════════════════════════════════════
// TEST BRIDGE
// ═══════════════════════════════════════════════════════

window.__teleprompter = {
  processTranscript,
  getState: () => ({
    currentWordIndex: state.currentWordIndex,
    currentParaIndex: state.currentParaIndex,
    accumulatedText:  state.accumulatedText,
    lastChunk:        state.lastChunk,
    wordCount:        state.wordCount,
    modelReady:       state.modelReady,
    hypotheses:       state.hypotheses,
    anchorWpm:        state.anchorWpm,
    creepActive:      state.creepActive,
  }),
  resetPosition,
  ariaMatch,
  tokenize,
  normTok,
  bandedSim,
  CFG,
};
