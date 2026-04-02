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
import { computeResult, buildSessionRecord } from './results.js';
import { saveSession, getLatestSession, getSessionsByPatient } from './db.js';
import { exportSessionJSON, exportSessionCSV } from './export.js';
import { isPatientMode, isClinicMode, buildExplorerURL, withMode, CAL_STALE_MS } from './config.js';


// ═════════════════════════════════════════════════════════════════════════════
// Configuration
// ═════════════════════════════════════════════════════════════════════════════

const MIN_TRIALS  = 30;
const MAX_TRIALS  = 80;
const DEBOUNCE_MS = 250;

// Always default to gabor — ignore stale localStorage values
let currentModeId = 'gabor';


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

if (isCalibrationStale(CAL_STALE_MS)) {
    const w = document.getElementById('stale-cal-warning');
    if (w) { w.style.display = 'block'; w.onclick = () => window.location.href = withMode('calibration.html'); }
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
let patientId    = null;   // clinic mode: patient ID for database

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

    // Load informative prior from previous visit (clinic mode)
    if (isClinicMode() && patientId) {
        getLatestSession(patientId).then(prev => {
            if (prev && prev.posterior && prev.mode === modeId && engine.trialCount === 0) {
                engine.loadPrior(prev.posterior);
                const priorEl = document.getElementById('prior-status');
                if (priorEl) {
                    const d = new Date(prev.timestamp).toLocaleDateString();
                    priorEl.textContent = 'Prior: ' + d;
                    priorEl.style.display = 'inline';
                }
                console.log('[App] Loaded prior from', prev.timestamp);
            }
        }).catch(() => {});
    }

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

    if (isPatientMode()) {
        // Highlight on-screen tutorial button
        document.querySelectorAll('.tut-resp-btn').forEach(b => {
            b.classList.toggle('tut-active', b.dataset.key === s.key);
        });
        document.getElementById('tut-hint').textContent =
            idx < TUT.length - 1
                ? 'Click the highlighted button below'
                : 'Click to begin testing';
    } else {
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

    // Adaptive stopping: converge between MIN_TRIALS and MAX_TRIALS
    if (engine.trialCount >= MAX_TRIALS) {
        finish();
        return;
    }
    if (engine.trialCount >= MIN_TRIALS && engine.isConverged()) {
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

// Fixed lane ID from URL (?lane=CLINIC) or random
const urlLane = new URLSearchParams(window.location.search).get('lane');
const laneID = urlLane ? 'CSF-' + urlLane : 'CSF-' + Math.floor(1000 + Math.random() * 9000);

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

if (!isPatientMode()) {
    // Fixed lane: skip QR overlay, go straight to patient ID prompt
    if (urlLane) {
        const so = document.getElementById('sync-overlay');
        if (so) so.style.display = 'none';
    }
    initPeerSync();
}


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
    if (el) {
        if (trial < MIN_TRIALS) {
            el.textContent = `${trial} / ${MIN_TRIALS}+`;
        } else {
            const converged = engine && engine.isConverged();
            el.textContent = converged ? `${trial} (converged)` : `${trial} / ${MAX_TRIALS}`;
        }
    }

    const fill = document.getElementById('progress-fill');
    if (fill) {
        // Fill to MIN_TRIALS first, then continue to MAX
        const pct = trial < MIN_TRIALS
            ? (trial / MIN_TRIALS) * 100
            : 100;
        fill.style.width = `${pct}%`;
    }
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

    // Save to database (clinic mode with patient ID)
    let lastSavedRecord = null;
    if (isClinicMode() && patientId) {
        try {
            lastSavedRecord = buildSessionRecord(engine, result, patientId, currentModeId);
            saveSession(lastSavedRecord).then(id => {
                console.log('[DB] Session saved, id:', id);
                // Wire up export buttons
                const jsonBtn = document.getElementById('export-json-btn');
                const csvBtn = document.getElementById('export-csv-btn');
                if (jsonBtn) jsonBtn.onclick = () => exportSessionJSON(lastSavedRecord);
                if (csvBtn) csvBtn.onclick = () => exportSessionCSV(lastSavedRecord);
                const exportRow = document.getElementById('export-row');
                if (exportRow) exportRow.style.display = 'flex';
            }).catch(err => {
                console.warn('[DB] Save failed:', err);
            });
        } catch (e) {
            console.warn('[DB] Record build failed:', e);
        }
    }

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

    // Show convergence info
    if (result.convergence) {
        const conv = result.convergence;
        const convEl = document.getElementById('convergence-info');
        if (convEl) {
            convEl.textContent = `${conv.trialCount} trials · ${conv.isConverged ? 'Converged' : 'Max reached'} · Entropy: ${conv.entropy.toFixed(1)} bits`;
            convEl.style.display = 'block';
        }
    }

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

if (isPatientMode()) {
    // Patient mode: on-screen only, no tablet needed
    const so = document.getElementById('sync-overlay');
    if (so) so.style.display = 'none';
    const rb = document.getElementById('response-bar');
    if (rb) rb.style.display = 'flex';
    const trb = document.getElementById('tut-response-bar');
    if (trb) trb.style.display = 'flex';
    showWelcome();
}

// ═════════════════════════════════════════════════════════════════════════════
// Patient ID prompt (clinic mode)
// ═════════════════════════════════════════════════════════════════════════════

function showPatientIdPrompt() {
    if (isPatientMode()) return;
    const overlay = document.getElementById('patient-id-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';

    const input = document.getElementById('patient-id-input');
    const startBtn = document.getElementById('patient-id-start');
    const anonBtn = document.getElementById('patient-id-anon');
    const priorEl = document.getElementById('patient-id-prior');

    if (input) input.focus();

    // Check for prior data as user types
    let debounceTimer = null;
    if (input) input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const id = input.value.trim();
            if (id.length >= 2) {
                const prev = await getLatestSession(id);
                if (prev && priorEl) {
                    const d = new Date(prev.timestamp).toLocaleDateString();
                    priorEl.textContent = 'Previous session found: ' + d + ' (' + prev.mode + ', AULCSF ' + prev.aulcsf.toFixed(2) + ')';
                } else if (priorEl) {
                    priorEl.textContent = 'New patient';
                }
            } else if (priorEl) {
                priorEl.textContent = '';
            }
        }, 300);
    });

    function proceed(id) {
        patientId = id;
        overlay.style.display = 'none';
        // Send patient ID to tablet
        if (sync && sync.connected) sync.sendPatientId(id);
        // Reinit engine with prior if returning patient
        initMode(currentModeId);
    }

    if (startBtn) startBtn.onclick = () => {
        const id = input ? input.value.trim() : '';
        if (!id) { if (input) input.style.borderColor = '#ff453a'; return; }
        proceed(id);
    };

    if (anonBtn) anonBtn.onclick = () => {
        proceed('ANON-' + Math.floor(1000 + Math.random() * 9000));
    };

    // Enter key to submit
    if (input) input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { if (startBtn) startBtn.click(); }
    });
}

// Hook into sync overlay dismissal: show patient ID after tablet connects
if (isClinicMode()) {
    if (urlLane) {
        // Fixed lane: no QR overlay, show patient ID prompt immediately
        showPatientIdPrompt();
    } else {
        // Watch for sync overlay being hidden (MutationObserver)
        const syncEl = document.getElementById('sync-overlay');
        if (syncEl) {
            const obs = new MutationObserver(() => {
                if (syncEl.style.display === 'none') {
                    obs.disconnect();
                    showPatientIdPrompt();
                }
            });
            obs.observe(syncEl, { attributes: true, attributeFilter: ['style'] });
        }
    }
}

// Dev mode: skip straight to results with average CSF curve (?dev)
if (new URLSearchParams(window.location.search).has('dev')) {
    // Hide all overlays
    for (const id of ['sync-overlay','welcome-overlay','tutorial-overlay','cal-guard']) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }
    // Create a fresh engine (prior = average normal CSF)
    const devEngine = new QCSFEngine({ numAFC: 5, psychometricSlope: 3.5 });
    const devParams = devEngine.getExpectedEstimate();
    const explorerURL = buildExplorerURL(devParams);

    // Show results overlay
    const overlay = document.getElementById('results-overlay');
    overlay.style.display = 'flex';
    const clinicEls = overlay.querySelectorAll('.clinic-only');
    const patientEls = overlay.querySelectorAll('.patient-only');
    clinicEls.forEach(el => el.style.display = 'none');
    patientEls.forEach(el => el.style.display = 'block');

    try {
        const plotCanvas = document.getElementById('csf-plot');
        if (plotCanvas) drawCSFPlot(plotCanvas, devEngine, devParams);
    } catch (e) { console.error('[Dev] Plot failed:', e); }

    const explorerLink = document.getElementById('explorer-link');
    if (explorerLink) explorerLink.href = explorerURL;
}
