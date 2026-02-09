/**
 * CSF Plot Renderer
 * =================
 * Draws the estimated contrast sensitivity function curve
 * with trial markers on a canvas element.
 */

/**
 * Draw the CSF curve and trial history on a canvas.
 *
 * @param {HTMLCanvasElement} canvas – target canvas
 * @param {object} engine           – QCSFEngine instance (for getCSFCurve, history, stimGrid)
 * @param {object} params           – CSF parameter estimate { peakGain, peakFreq, bandwidth, truncation }
 */
export function drawCSFPlot(canvas, engine, params) {
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    const pad   = { top: 20, right: 20, bottom: 40, left: 55 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top  - pad.bottom;

    // Axis ranges (log10 space)
    const logFMin = -0.3, logFMax = 1.7;   // 0.5 – 50 cpd
    const logSMin = -0.5, logSMax = 3.0;   // 0.3 – 1000 sensitivity

    const toX = logF => pad.left + (logF - logFMin) / (logFMax - logFMin) * plotW;
    const toY = logS => pad.top  + plotH - (logS - logSMin) / (logSMax - logSMin) * plotH;

    // ── Background ───────────────────────────────────────────────────────
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // ── Grid lines ───────────────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth   = 1;

    for (const f of [0.5, 1, 2, 4, 8, 16, 32]) {
        const x = toX(Math.log10(f));
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + plotH); ctx.stroke();
    }
    for (const s of [1, 10, 100, 1000]) {
        const y = toY(Math.log10(s));
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
    }

    // ── CSF Curve ────────────────────────────────────────────────────────
    const curve = engine.getCSFCurve(params);

    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    let started = false;

    for (const pt of curve) {
        if (pt.logS < logSMin) continue;
        const x = toX(Math.log10(pt.freq));
        const y = toY(pt.logS);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── Trial Markers ────────────────────────────────────────────────────
    for (const trial of engine.history) {
        const s = engine.stimGrid[trial.stimIndex];
        const x = toX(Math.log10(s.freq));
        const y = toY(-s.logContrast);   // sensitivity = 1/contrast → log10(sens) = -logContrast

        ctx.beginPath();
        ctx.arc(x, y, trial.correct ? 4 : 3, 0, Math.PI * 2);
        ctx.fillStyle = trial.correct ? 'rgba(0,255,150,0.5)' : 'rgba(255,80,80,0.5)';
        ctx.fill();
    }

    // ── Axis Labels ──────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font      = '10px JetBrains Mono, SF Mono, monospace';
    ctx.textAlign = 'center';

    for (const f of [0.5, 1, 2, 4, 8, 16, 32]) {
        ctx.fillText(String(f), toX(Math.log10(f)), pad.top + plotH + 18);
    }
    ctx.fillText('Spatial Frequency (cpd)', W / 2, H - 5);

    ctx.save();
    ctx.translate(12, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Sensitivity', 0, 0);
    ctx.restore();

    ctx.textAlign = 'right';
    for (const s of [1, 10, 100, 1000]) {
        ctx.fillText(String(s), pad.left - 8, toY(Math.log10(s)) + 4);
    }
}
