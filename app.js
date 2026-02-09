/**
 * Manifold qCSF — Display Controller
 * ====================================
 * The desktop display is stimulus-only. All interaction
 * happens on the connected tablet/phone controller.
 *
 * Modes: gabor | tumblingE | sloan
 */

import { isCalibrated, getCalibrationData, isCalibrationStale } from './utils.js';
import { QCSFEngine }    from './qcsf-engine.js';
import { createMode }    from './stimulus-modes.js';
import { drawCSFPlot }   from './csf-plot.js';
import { initSync }      from './peer-sync.js';
import { initKeyboard }  from './keyboard.js';
import { computeResult } from './results.js';


// ═════════════════════════════════════════════════════════════════════════════
// Configuration
// ═════════════════════════════════════════════════════════════════════════════

const MAX_TRIALS  = 50;
const DEBOUNCE_MS = 250;

// Default mode (can be changed from tablet before test starts)
let currentModeId = localStorage.getItem('qcsf_mode') || 'sloan';


// ═════════════════════════════════════════════════════════════════════════════
// Calibration
// ═════════════════════════════════════════════════════════════════════════════

if (!isCalibrated()) {
    document.getElementById('cal-guard').style.display = 'flex';
    throw new Error('[App] Calibration required.');
}

const cal = getCalibrationData();

if (isCalibrationStale()) {
    const w = document.getElementById('stale-cal-warning');
    if (w) w.style.display = 'block';
}

if (cal.isMirror) {
    const mt = document.getElementById('mirror-target');
    const rc = document.getElementById('result-content');
    if (mt) mt.classList.add('mirror-flip');
    if (rc) rc.classList.add('mirror-flip');
}


// ═════════════════════════════════════════════════════════════════════════════
// State
// ═════════════════════════════════════════════════════════════════════════════

let mode         = null;   // active stimulus mode controller
let engine       = null;   // Bayesian engine
let currentStim  = null;   // current stimulus selection
let testComplete = false;
let testStarted  = false;
let lastInputTime = 0;
let sync         = null;


// ═════════════════════════════════════════════════════════════════════════════
// Mode Initialization
// ═════════════════════════════════════════════════════════════════════════════

function initMode(modeId) {
    currentModeId = modeId;
    localStorage.setItem('qcsf_mode', modeId);

    mode = createMode(modeId);

    // Show loading state
    const label = document.getElementById('mode-label');
    if (label) label.textContent = mode.name;

    // Generate templates (may take a moment for filtered modes)
    try {
        mode.generate();
    } catch (e) {
        console.error('[App] Template generation failed:', e);
    }

    // Create engine with mode-specific parameters
    engine = new QCSFEngine({
        numAFC: mode.numAFC,
        psychometricSlope: mode.psychometricSlope
    });

    testComplete = false;
    testStarted  = false;
    currentStim  = null;

    // Update progress
    updateProgress(0);

    // Send state to tablet
    if (sync && sync.connected) {
        sync.sendState({
            mode:         mode.id,
            labels:       mode.labels,
            keys:         mode.keys,
            responseType: mode.responseType,
            trial:        0,
            maxTrials:    MAX_TRIALS
        });
    }

    // Show waiting state on canvas
    showWaiting();
}

function showWaiting() {
    const canvas = document.getElementById('stimCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const mp = cal.midPoint;
    ctx.fillStyle = `rgb(${mp},${mp},${mp})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle center indicator
    const cx = canvas.width / 2, cy = canvas.height / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${mp + 30},${mp + 30},${mp + 30},0.5)`;
    ctx.fill();
}


// ═════════════════════════════════════════════════════════════════════════════
// Input Handling
// ═════════════════════════════════════════════════════════════════════════════

function handleInput(value) {
    if (testComplete) return;

    // First input starts the test
    if (!testStarted) {
        testStarted = true;
        nextTrial();
        return;
    }

    if (!currentStim || !mode) return;

    // Debounce
    const now = performance.now();
    if (now - lastInputTime < DEBOUNCE_MS) return;
    lastInputTime = now;

    const correct = mode.checkAnswer(value);

    try {
        engine.update(currentStim.stimIndex, correct);
    } catch (e) {
        console.error('[App] Engine update failed:', e);
        finish();
        return;
    }

    // Update progress
    updateProgress(engine.trialCount);

    if (sync && sync.connected) {
        sync.sendProgress(engine.trialCount, MAX_TRIALS);
    }

    if (engine.trialCount >= MAX_TRIALS) {
        finish();
        return;
    }

    nextTrial();
}

window.handleInput = handleInput;


// ═════════════════════════════════════════════════════════════════════════════
// Keyboard fallback (for testing without tablet)
// ═════════════════════════════════════════════════════════════════════════════

const teardownKeyboard = initKeyboard(letter => {
    if (!testComplete) handleInput(letter.toLowerCase());
});


// ═════════════════════════════════════════════════════════════════════════════
// PeerJS
// ═════════════════════════════════════════════════════════════════════════════

const laneID = 'CSF-' + Math.floor(1000 + Math.random() * 9000);

function initPeerSync() {
    if (typeof Peer === 'undefined') {
        console.warn('[App] PeerJS unavailable.');
        const so = document.getElementById('sync-overlay');
        if (so) {
            so.innerHTML = `
                <p class="sync-fallback">Tablet sync unavailable</p>
                <button onclick="document.getElementById('sync-overlay').style.display='none'"
                        class="sync-dismiss-btn">Use Keyboard</button>`;
        }
        return;
    }

    try {
        sync = initSync(laneID, {
            onReady(tabletURL) {
                if (typeof QRCode !== 'undefined') {
                    new QRCode(document.getElementById('qrcode'), {
                        text: tabletURL, width: 180, height: 180,
                        colorDark: '#000', colorLight: '#fff'
                    });
                } else {
                    const qrEl = document.getElementById('qrcode');
                    if (qrEl) qrEl.innerHTML = `<p style="font-size:0.65rem; opacity:0.5; word-break:break-all;">${tabletURL}</p>`;
                }
            },

            onConnect() {
                const so = document.getElementById('sync-overlay');
                if (so) so.style.display = 'none';

                // Send current state to newly connected tablet
                if (mode) {
                    sync.sendState({
                        mode: mode.id, labels: mode.labels,
                        keys: mode.keys, responseType: mode.responseType,
                        trial: engine ? engine.trialCount : 0,
                        maxTrials: MAX_TRIALS
                    });
                }
            },

            onInput(value) {
                handleInput(value);
            },

            onModeChange(newMode) {
                initMode(newMode);
            },

            onCommand(action) {
                if (action === 'restart') location.reload();
                if (action === 'calibrate') window.location.href = 'calibration.html';
            },

            onDisconnect() {
                console.info('[App] Tablet disconnected.');
            }
        });
    } catch (e) {
        console.warn('[App] PeerJS init failed:', e);
    }
}

initPeerSync();


// ═════════════════════════════════════════════════════════════════════════════
// Trial Loop
// ═════════════════════════════════════════════════════════════════════════════

function nextTrial() {
    try {
        currentStim = engine.selectStimulus();
    } catch (e) {
        console.error('[App] Stimulus selection failed:', e);
        finish();
        return;
    }

    // Clamp
    if (currentStim.contrast <= 0 || currentStim.contrast > 1 || isNaN(currentStim.contrast)) {
        currentStim.contrast = Math.max(0.001, Math.min(1.0, currentStim.contrast || 0.5));
    }
    if (currentStim.frequency <= 0 || isNaN(currentStim.frequency)) {
        currentStim.frequency = 4;
    }

    const canvas = document.getElementById('stimCanvas');
    if (!canvas) return;

    try {
        mode.render(canvas, currentStim, cal);
    } catch (e) {
        console.error('[App] Render failed:', e);
    }
}


// ═════════════════════════════════════════════════════════════════════════════
// Progress
// ═════════════════════════════════════════════════════════════════════════════

function updateProgress(trial) {
    const el = document.getElementById('live-progress');
    if (el) el.textContent = `${trial} / ${MAX_TRIALS}`;

    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = `${(trial / MAX_TRIALS) * 100}%`;
}


// ═════════════════════════════════════════════════════════════════════════════
// Finish
// ═════════════════════════════════════════════════════════════════════════════

function finish() {
    testComplete = true;

    let result;
    try {
        result = computeResult(engine);
    } catch (e) {
        result = { aulcsf: 0, rank: 'ERROR', detail: 'Failed', params: engine.getExpectedEstimate() };
    }

    if (result.aulcsf <= 0) {
        result.rank = 'INCONCLUSIVE';
    }

    // Update display
    document.getElementById('results-overlay').style.display = 'flex';
    const setEl = (id, t) => { const e = document.getElementById(id); if (e) e.innerText = t; };
    setEl('final-auc', result.aulcsf.toFixed(2));
    setEl('final-rank', result.rank);
    setEl('final-detail', result.detail);

    try {
        const plotCanvas = document.getElementById('csf-plot');
        if (plotCanvas) drawCSFPlot(plotCanvas, engine, result.params);
    } catch (e) { /* ignore */ }

    // Send to tablet
    if (sync && sync.connected) {
        sync.sendResults(result.aulcsf.toFixed(2), result.rank, result.detail);
    }

    if (teardownKeyboard) teardownKeyboard();
}


// ═════════════════════════════════════════════════════════════════════════════
// Start
// ═════════════════════════════════════════════════════════════════════════════

initMode(currentModeId);
