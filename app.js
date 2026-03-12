/**
 * Manifold qCSF — Display Controller
 * ====================================
 * The desktop display is stimulus-only. All interaction
 * happens on the connected tablet/phone controller.
 *
 * Modes: gabor | tumblingE | sloan
 * App modes: clinic (default) | patient (?mode=patient)
 */

import { isCalibrated, getCalibrationData, isCalibrationStale } from './utils.js';
import { QCSFEngine }    from './qcsf-engine.js';
import { createMode }    from './stimulus-modes.js';
import { drawGabor }     from './gabor.js';
import { drawCSFPlot }   from './csf-plot.js';
import { initSync }      from './peer-sync.js';
import { initKeyboard }  from './keyboard.js';
import { computeResult } from './results.js';
import { isPatientMode, isClinicMode, buildExplorerURL, withMode } from './config.js';


// ═════════════════════════════════════════════════════════════════════════════
// Configuration
// ═════════════════════════════════════════════════════════════════════════════

const MAX_TRIALS  = 50;
const DEBOUNCE_MS = 250;

// Default mode: gabor for patient mode, sloan for clinic
let currentModeId = isPatientMode()
    ? 'gabor'
    : (localStorage.getItem('qcsf_mode') || 'sloan');


// ═════════════════════════════════════════════════════════════════════════════
// Patient-mode UI setup
// ═════════════════════════════════════════════════════════════════════════════

if (isPatientMode()) {
    // Show disclaimer footer
    const disc = document.getElementById('patient-disclaimer');
    if (disc) disc.style.display = 'block';

    // Update calibration link to preserve mode
    const calGuardBtn = document.querySelector('#cal-guard button');
    if (calGuardBtn) calGuardBtn.onclick = () => window.location.href = withMode('calibration.html');

    const gearBtn = document.getElementById('gear-btn');
    if (gearBtn) gearBtn.onclick = () => window.location.href = withMode('calibration.html');
}


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

// Tutorial (patient mode)
const TUT = [
    { angle: 0,   key: 'up',      arrow: '↑', name: 'Vertical stripes' },
    { angle: 90,  key: 'right',   arrow: '→', name: 'Horizontal stripes' },
    { angle: 45,  key: 'upright', arrow: '↗', name: 'Diagonal right' },
    { angle: 135, key: 'upleft',  arrow: '↖', name: 'Diagonal left' },
    { angle: -1,  key: 'none',    arrow: '✕', name: 'No target visible' }
];
let inTutorial = false;
let tutStep = 0;


// ═════════════════════════════════════════════════════════════════════════════
// Mode Initialization
// ═════════════════════════════════════════════════════════════════════════════

function initMode(modeId) {
    // Patient mode: only gabor and tumblingE allowed
    if (isPatientMode() && modeId === 'sloan') modeId = 'gabor';

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
// Patient Mode: Welcome & Tutorial
// ═════════════════════════════════════════════════════════════════════════════

function showWelcome() {
    const el = document.getElementById('welcome-overlay');
    if (el) el.style.display = 'flex';
}

window.beginTutorial = function() {
    document.getElementById('welcome-overlay').style.display = 'none';
    inTutorial = true;
    tutStep = 0;
    const tutEl = document.getElementById('tutorial-overlay');
    if (tutEl) tutEl.style.display = 'flex';
    renderTutStep(0);
};

function renderTutStep(idx) {
    tutStep = idx;
    const s = TUT[idx];
    const tc = document.getElementById('tut-canvas');

    document.getElementById('tut-step-label').textContent = `Demo ${idx + 1} of ${TUT.length}`;

    const orientEl = document.getElementById('tut-orient-name');
    orientEl.style.animation = 'none'; orientEl.offsetHeight;
    orientEl.textContent = s.name;
    orientEl.style.animation = 'tutSettle 0.3s ease-out';

    if (s.angle >= 0) {
        drawGabor(tc, { cpd: 4, contrast: 0.95, angle: s.angle }, cal);
    } else {
        const ctx = tc.getContext('2d');
        const mp = cal.midPoint;
        ctx.fillStyle = `rgb(${mp},${mp},${mp})`;
        ctx.fillRect(0, 0, tc.width, tc.height);
    }

    document.getElementById('tut-arrow').textContent = s.arrow;
    document.getElementById('tut-key-name').textContent =
        s.angle >= 0 ? `Press ${s.arrow} for this orientation` : 'Press ✕ when you cannot see stripes';

    document.getElementById('tut-dots').innerHTML = TUT.map((_, i) =>
        `<div class="tut-dot${i === idx ? ' active' : ''}"></div>`
    ).join('');

    document.getElementById('tut-hint').textContent =
        idx < TUT.length - 1
            ? 'Press the highlighted button on your controller'
            : 'Last step — press to begin testing';

    if (sync && sync.connected) {
        sync.sendTutStep({
            stepIdx: idx, key: s.key, arrow: s.arrow,
            name: s.name, total: TUT.length
        });
    }
}

function advanceTut(key) {
    if (key !== TUT[tutStep].key) return;
    if (tutStep < TUT.length - 1) {
        renderTutStep(tutStep + 1);
    } else {
        // Tutorial complete — start test
        const tutEl = document.getElementById('tutorial-overlay');
        if (tutEl) tutEl.style.display = 'none';
        inTutorial = false;
        testStarted = true;
        nextTrial();

        if (sync && sync.connected) {
            sync.sendTestStart(MAX_TRIALS);
            sync.sendState({
                mode: mode.id, labels: mode.labels,
                keys: mode.keys, responseType: mode.responseType,
                trial: 0, maxTrials: MAX_TRIALS
            });
        }
    }
}


// ═════════════════════════════════════════════════════════════════════════════
// Input Handling
// ═════════════════════════════════════════════════════════════════════════════

function handleInput(value) {
    if (testComplete) return;

    // Tutorial mode — check if input matches current step
    if (inTutorial) {
        advanceTut(value);
        return;
    }

    // Patient mode: don't start until tutorial is complete
    if (isPatientMode() && !testStarted) return;

    // First input starts the test (clinic mode)
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
                <button class="sync-dismiss-btn" id="sync-fallback-btn">Use Keyboard</button>`;
            document.getElementById('sync-fallback-btn').onclick = () => {
                so.style.display = 'none';
                if (isPatientMode()) showWelcome();
            };
        }
        return;
    }

    try {
        sync = initSync(laneID, {
            onReady(tabletURL) {
                // Append mode to tablet URL
                const finalURL = isPatientMode()
                    ? tabletURL + '&mode=patient'
                    : tabletURL;

                if (typeof QRCode !== 'undefined') {
                    new QRCode(document.getElementById('qrcode'), {
                        text: finalURL, width: 180, height: 180,
                        colorDark: '#000', colorLight: '#fff'
                    });
                } else {
                    const qrEl = document.getElementById('qrcode');
                    if (qrEl) qrEl.innerHTML = `<p style="font-size:0.65rem; opacity:0.5; word-break:break-all;">${finalURL}</p>`;
                }
            },

            onConnect() {
                const so = document.getElementById('sync-overlay');
                if (so) so.style.display = 'none';

                // Patient mode: show welcome/tutorial flow
                if (isPatientMode()) showWelcome();

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
                if (action === 'calibrate') window.location.href = withMode('calibration.html');
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
        result = { aulcsf: 0, rank: 'ERROR', detail: 'Failed', params: engine.getExpectedEstimate(), notchProb: 0 };
    }

    if (result.aulcsf <= 0) {
        result.rank = 'INCONCLUSIVE';
    }

    const explorerURL = buildExplorerURL(result.params);

    if (isPatientMode()) {
        finishPatient(result, explorerURL);
    } else {
        finishClinic(result, explorerURL);
    }

    if (teardownKeyboard) teardownKeyboard();
}

/** Patient mode: educational framing, no scores, Explorer CTA */
function finishPatient(result, explorerURL) {
    // Show patient results overlay
    const overlay = document.getElementById('results-overlay');
    overlay.style.display = 'flex';

    // Hide clinic elements, show patient elements
    const clinicEls = overlay.querySelectorAll('.clinic-only');
    const patientEls = overlay.querySelectorAll('.patient-only');
    clinicEls.forEach(el => el.style.display = 'none');
    patientEls.forEach(el => el.style.display = 'block');

    // Draw the CSF plot (BMA curve — can show dips and non-standard shapes)
    try {
        const plotCanvas = document.getElementById('csf-plot');
        if (plotCanvas) drawCSFPlot(plotCanvas, engine, result.params);
    } catch (e) { /* ignore */ }

    // Set Explorer link
    const explorerLink = document.getElementById('explorer-link');
    if (explorerLink) explorerLink.href = explorerURL;

    // Send to tablet (patient mode — no scores, with Explorer URL)
    if (sync && sync.connected) {
        sync.sendResults(null, null, null, explorerURL);

        // Send downscaled plot image to tablet
        try {
            const srcCanvas = document.getElementById('csf-plot');
            if (srcCanvas) {
                const phoneCanvas = document.createElement('canvas');
                phoneCanvas.width = 760; phoneCanvas.height = 528;
                phoneCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, 760, 528);
                sync.sendPlotImage(phoneCanvas.toDataURL('image/jpeg', 0.80));
            }
        } catch (e) { console.warn('[App] Plot send failed:', e); }
    }
}

/** Clinic mode: full scoring, normative ranking, clinical detail */
function finishClinic(result, explorerURL) {
    // Show clinic results overlay
    const overlay = document.getElementById('results-overlay');
    overlay.style.display = 'flex';

    // Show clinic elements, hide patient elements
    const clinicEls = overlay.querySelectorAll('.clinic-only');
    const patientEls = overlay.querySelectorAll('.patient-only');
    clinicEls.forEach(el => el.style.display = 'block');
    patientEls.forEach(el => el.style.display = 'none');

    // Update scoring display
    const setEl = (id, t) => { const e = document.getElementById(id); if (e) e.innerText = t; };
    setEl('final-auc', result.aulcsf.toFixed(2));
    setEl('final-rank', result.rank);
    setEl('final-detail', result.detail);

    // Show notch probability if clinically significant
    if (result.notchProb > 0.5) {
        const notchEl = document.getElementById('notch-flag');
        if (notchEl) {
            const notch = engine.getNotchEstimate();
            const label = notch
                ? `Frequency-band deficit detected near ${notch.freq} cpd (p=${(result.notchProb * 100).toFixed(0)}%)`
                : `Possible frequency-band deficit (p=${(result.notchProb * 100).toFixed(0)}%)`;
            notchEl.textContent = label;
            notchEl.style.display = 'block';
        }
    }

    // Draw the CSF plot
    try {
        const plotCanvas = document.getElementById('csf-plot');
        if (plotCanvas) drawCSFPlot(plotCanvas, engine, result.params);
    } catch (e) { /* ignore */ }

    // Send to tablet (full scores)
    if (sync && sync.connected) {
        sync.sendResults(result.aulcsf.toFixed(2), result.rank, result.detail);
    }
}


// ═════════════════════════════════════════════════════════════════════════════
// Start
// ═════════════════════════════════════════════════════════════════════════════

initMode(currentModeId);

// Override sync overlay dismiss button for patient mode welcome flow
if (isPatientMode()) {
    const syncDismissBtn = document.querySelector('#sync-overlay .sync-dismiss-btn');
    if (syncDismissBtn) {
        syncDismissBtn.onclick = () => {
            document.getElementById('sync-overlay').style.display = 'none';
            showWelcome();
        };
    }
}
