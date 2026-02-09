/**
 * Gabor Patch Renderer
 * ====================
 * Draws oriented, contrast-modulated Gabor patches on a canvas.
 * Uses calibrated physical units (cpd → cycles/pixel) with
 * gamma-corrected luminance output.
 */

/**
 * Draw a Gabor patch on the given canvas.
 *
 * @param {HTMLCanvasElement} canvas   – target canvas element
 * @param {object} stimulus
 * @param {number} stimulus.cpd       – spatial frequency in cycles per degree
 * @param {number} stimulus.contrast  – Michelson contrast, 0.0–1.0
 * @param {number} stimulus.angle     – orientation in degrees
 * @param {object} calibration
 * @param {number} calibration.pxPerMm  – pixels per millimeter on this display
 * @param {number} calibration.distMm   – viewing distance in millimeters
 * @param {number} calibration.midPoint – gamma-corrected mid-grey value (0–255)
 */
export function drawGabor(canvas, stimulus, calibration) {
    const ctx = canvas.getContext('2d');
    const w   = canvas.width;
    const h   = canvas.height;
    const img = ctx.createImageData(w, h);
    const d   = img.data;

    const { cpd, contrast, angle } = stimulus;
    const { pxPerMm, distMm, midPoint } = calibration;

    const cX  = w / 2;
    const cY  = h / 2;
    const rad = (angle * Math.PI) / 180;

    // Convert cycles-per-degree → radians-per-pixel
    // pixPerDeg ≈ distMm × tan(1°) × pxPerMm ≈ distMm × 0.017455 × pxPerMm
    const pixPerDeg = distMm * 0.017455 * pxPerMm;
    const cpp       = (2 * Math.PI * cpd) / pixPerDeg;

    // Gaussian envelope: sigma ≈ canvas/7 gives a good visible extent
    const sigma   = w / 7;
    const sig2x2  = 2 * sigma * sigma;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i  = (y * w + x) * 4;
            const dx = x - cX;
            const dy = y - cY;

            // Gaussian envelope (spatial constraint)
            const gauss = Math.exp(-(dx * dx + dy * dy) / sig2x2);

            // Oriented sinusoidal grating
            const xt   = dx * Math.cos(rad) + dy * Math.sin(rad);
            const sine = Math.sin(xt * cpp);

            // Gamma-corrected luminance
            const lum = midPoint + midPoint * contrast * sine * gauss;

            d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, lum));
            d[i + 3] = 255;
        }
    }

    ctx.putImageData(img, 0, 0);
}

/**
 * Clear the canvas to the calibrated mid-grey.
 */
export function clearToGrey(canvas, midPoint) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = `rgb(${midPoint},${midPoint},${midPoint})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}
