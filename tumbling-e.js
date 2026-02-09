/**
 * Tumbling E — Bandpass Filtered
 * ==============================
 * Generates the 4 cardinal orientations of a tumbling E optotype,
 * applies the same raised-cosine bandpass filter as the Sloan letters.
 *
 * The E is drawn per the Snellen/Sloan spec (5×5 grid, stroke=1 unit)
 * then rotated for each orientation: Right (0°), Down (90°), Left (180°), Up (270°).
 */

import { applyBandpassFilter } from './filter-core.js';

const RES = 256;
const E_ORIENTATIONS = ['right', 'down', 'left', 'up'];

/**
 * Draw a standard E (opening facing right) on a canvas.
 */
function drawBaseE(ctx, size) {
    const u  = size / 5;
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2;
    const x0 = cx - size / 2;
    const y0 = cy - size / 2;

    ctx.fillStyle = '#000';
    // Vertical bar (left side)
    ctx.fillRect(x0, y0, u, 5 * u);
    // Top horizontal
    ctx.fillRect(x0, y0, 5 * u, u);
    // Middle horizontal
    ctx.fillRect(x0, y0 + 2 * u, 5 * u, u);
    // Bottom horizontal
    ctx.fillRect(x0, y0 + 4 * u, 5 * u, u);
}

/**
 * Generate all 4 filtered tumbling E templates.
 */
export function generateFilteredEs(options = {}) {
    const centerFreq = options.centerFreq || 4;
    const bandwidth  = options.bandwidth  || 1;
    const N          = options.resolution || RES;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = offCanvas.height = N;
    const offCtx = offCanvas.getContext('2d');

    const templates = [];
    const rotations = [0, 90, 180, 270]; // right, down, left, up

    for (const rot of rotations) {
        offCtx.fillStyle = '#fff';
        offCtx.fillRect(0, 0, N, N);

        offCtx.save();
        offCtx.translate(N / 2, N / 2);
        offCtx.rotate((rot * Math.PI) / 180);
        offCtx.translate(-N / 2, -N / 2);

        drawBaseE(offCtx, N * 0.75);
        offCtx.restore();

        // Extract as signed image
        const imgData = offCtx.getImageData(0, 0, N, N);
        const re = new Float64Array(N * N);
        for (let i = 0; i < N * N; i++) {
            re[i] = (imgData.data[i * 4] / 255) - 0.5;
        }

        // Apply bandpass filter + normalize
        const filtered = applyBandpassFilter(re, N, centerFreq, bandwidth);
        templates.push(filtered);
    }

    return {
        orientations: [...E_ORIENTATIONS],
        templates,
        resolution: N,
        centerFreq
    };
}

export { E_ORIENTATIONS };
