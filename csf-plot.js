/**
 * CSF Plot Renderer
 * =================
 * Draws the estimated contrast sensitivity function curve
 * with trial markers on a canvas element.
 *
 * Uses Bayesian Model Averaging (BMA) for the primary curve,
 * which can represent non-standard CSF shapes including
 * mid-frequency dips and frequency-band deficits.
 */

/**
 * Draw the CSF curve and trial history on a canvas.
 *
 * @param {HTMLCanvasElement} canvas – target canvas
 * @param {object} engine           – QCSFEngine instance
 * @param {object} params           – CSF parameter estimate (for parametric reference)
 */
export function drawCSFPlot(canvas, engine, params) {
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    const pad   = { top: 20, right: 30, bottom: 50, left: 65 };
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

    // ── Snellen Letter Background ──────────────────────────────────────
    // Letters demonstrate the CSF concept: large→small (left→right),
    // high contrast→low contrast (bottom→top)
    {
        const SLOAN = ['C','D','H','K','N','O','R','S','V','Z'];
        const cols = 8, rows = 7;
        const cellW = plotW / cols;
        const cellH = plotH / rows;
        // Font sizes: large on left, shrinks quickly toward right
        const maxFont = Math.min(cellH * 0.85, cellW * 1.2);
        const minFont = Math.max(4, maxFont * 0.04);
        // Background is #0a0a0c ≈ rgb(10,10,12), so letters lighter = more visible
        const bgLum = 10;

        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.left, pad.top, plotW, plotH);
        ctx.clip();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Seeded pseudo-random for consistent letter placement
        let seed = 42;
        const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };

        for (let c = 0; c < cols; c++) {
            // Size interpolation: steeper exponential so letters shrink fast
            const t = c / (cols - 1);                       // 0 (left) → 1 (right)
            const fSize = maxFont * Math.pow(minFont / maxFont, Math.pow(t, 0.6));
            const cx = pad.left + cellW * (c + 0.5);

            for (let r = 0; r < rows; r++) {
                // Contrast: bottom row (r = rows-1) = bright white, top row (r = 0) = nearly invisible
                const ct = r / (rows - 1);                    // 0 (top) → 1 (bottom)
                // Steep power curve — bottom is bold white, fades fast toward top
                const alpha = 0.01 + Math.pow(ct, 3.5) * 0.89;

                const cy = pad.top + cellH * (r + 0.5);
                const letter = SLOAN[Math.floor(rand() * SLOAN.length)];

                ctx.font = `600 ${fSize}px "DM Sans", system-ui, sans-serif`;
                ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
                ctx.fillText(letter, cx, cy);
            }
        }
        ctx.restore();
    }

    // (grid lines removed — letter background serves as visual reference)

    // ── BMA Curve (primary — can show dips and non-standard shapes) ─────
    const bmaCurve = engine.getBMACurve(150);

    // Gradient fill under curve
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    grad.addColorStop(0, 'rgba(0,255,204,0.12)');
    grad.addColorStop(1, 'rgba(0,255,204,0.0)');

    ctx.beginPath();
    let firstX = null, firstY = null, lastX = null;
    for (const pt of bmaCurve) {
        if (pt.logS < logSMin) continue;
        const x = toX(Math.log10(pt.freq));
        const y = toY(Math.min(pt.logS, logSMax));
        if (firstX === null) { ctx.moveTo(x, y); firstX = x; firstY = y; }
        else ctx.lineTo(x, y);
        lastX = x;
    }
    if (firstX !== null && lastX !== null) {
        ctx.lineTo(lastX, toY(logSMin));
        ctx.lineTo(firstX, toY(logSMin));
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
    }

    // BMA curve stroke
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    let started = false;
    for (const pt of bmaCurve) {
        if (pt.logS < logSMin) continue;
        const x = toX(Math.log10(pt.freq));
        const y = toY(Math.min(pt.logS, logSMax));
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // (parametric reference curve removed)

    // ── Curve region labels (below = visible, above = not) ──────────────
    {
        const labelSize = Math.max(10, Math.round(W / 60));
        ctx.font = `300 ${labelSize}px "DM Sans", system-ui, sans-serif`;
        ctx.textAlign = 'center';

        // "Visible" — below the curve, toward bottom-left
        ctx.fillStyle = 'rgba(0,255,204,0.25)';
        ctx.fillText('visible to you', pad.left + plotW * 0.25, pad.top + plotH * 0.82);

        // "Not visible" — above the curve, toward top-right
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillText('not visible to you', pad.left + plotW * 0.72, pad.top + plotH * 0.15);
    }

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
    const fontSize = Math.max(11, Math.round(W / 70));
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font      = `${fontSize}px "DM Sans", system-ui, sans-serif`;

    // X-axis: "Coarse Detail" (left) ← → "Fine Detail" (right)
    ctx.textAlign = 'left';
    ctx.fillText('Coarse Detail', pad.left + 4, pad.top + plotH + fontSize + 12);
    ctx.textAlign = 'right';
    ctx.fillText('Fine Detail', pad.left + plotW - 4, pad.top + plotH + fontSize + 12);

    // X-axis arrow line
    const arrowY = pad.top + plotH + fontSize + 26;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left + 4, arrowY);
    ctx.lineTo(pad.left + plotW - 4, arrowY);
    ctx.stroke();
    // arrowhead right
    ctx.beginPath();
    ctx.moveTo(pad.left + plotW - 4, arrowY);
    ctx.lineTo(pad.left + plotW - 12, arrowY - 3);
    ctx.lineTo(pad.left + plotW - 12, arrowY + 3);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();

    // Y-axis: "High Contrast" (bottom/origin) and "Low Contrast" (top)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font      = `${fontSize}px "DM Sans", system-ui, sans-serif`;

    ctx.save();
    ctx.translate(fontSize + 2, pad.top + plotH - 4);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'left';
    ctx.fillText('High Contrast', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(fontSize + 2, pad.top + 4);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'right';
    ctx.fillText('Low Contrast', 0, 0);
    ctx.restore();
}
