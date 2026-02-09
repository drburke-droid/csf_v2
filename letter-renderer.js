/**
 * Filtered Letter Renderer
 * ========================
 * Draws a bandpass-filtered Sloan letter stimulus at a specified
 * spatial frequency and contrast on a canvas element.
 *
 * The key relationship:
 *   letter_size_deg = centerFreqCycPerLetter / targetCPD
 *   letter_size_px  = letter_size_deg × pixelsPerDegree
 */

/**
 * Draw a filtered letter stimulus on the given canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} stimulus
 * @param {Float64Array} stimulus.template  – normalized filtered letter data (N×N, range [-1,1])
 * @param {number} stimulus.templateRes     – template pixel resolution (e.g. 256)
 * @param {number} stimulus.centerFreq      – filter center frequency (cycles per letter)
 * @param {number} stimulus.cpd             – target spatial frequency (cycles per degree)
 * @param {number} stimulus.contrast        – Michelson contrast, 0.0–1.0
 * @param {object} calibration
 * @param {number} calibration.pxPerMm
 * @param {number} calibration.distMm
 * @param {number} calibration.midPoint     – gamma-corrected mid-grey (0–255)
 */
export function drawFilteredLetter(canvas, stimulus, calibration) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    const { template, templateRes, centerFreq, cpd, contrast } = stimulus;
    const { pxPerMm, distMm, midPoint } = calibration;

    // Compute letter size in pixels
    const pixPerDeg   = distMm * 0.017455 * pxPerMm;
    const letterDeg   = centerFreq / cpd;
    const letterPx    = letterDeg * pixPerDeg;

    // Clear to mid-grey
    ctx.fillStyle = `rgb(${midPoint},${midPoint},${midPoint})`;
    ctx.fillRect(0, 0, W, H);

    // If the letter would be larger than the canvas, clamp
    const maxPx = Math.min(W, H) * 0.9;
    const drawSize = Math.min(letterPx, maxPx);

    // Scale factor from template pixels to display pixels
    const scale = drawSize / templateRes;

    // Offset to center the letter
    const ox = (W - drawSize) / 2;
    const oy = (H - drawSize) / 2;

    // Create ImageData for the canvas
    const img = ctx.createImageData(W, H);
    const d = img.data;

    // Fill with mid-grey first
    for (let i = 0; i < W * H * 4; i += 4) {
        d[i] = d[i+1] = d[i+2] = midPoint;
        d[i+3] = 255;
    }

    // Sample from the template with bilinear interpolation
    for (let py = 0; py < drawSize; py++) {
        const canvasY = Math.round(oy + py);
        if (canvasY < 0 || canvasY >= H) continue;

        for (let px = 0; px < drawSize; px++) {
            const canvasX = Math.round(ox + px);
            if (canvasX < 0 || canvasX >= W) continue;

            // Map display pixel to template coordinate
            const tx = px / scale;
            const ty = py / scale;

            // Bilinear interpolation
            const x0 = Math.floor(tx), y0 = Math.floor(ty);
            const x1 = Math.min(x0 + 1, templateRes - 1);
            const y1 = Math.min(y0 + 1, templateRes - 1);
            const fx = tx - x0, fy = ty - y0;

            const v00 = template[y0 * templateRes + x0];
            const v10 = template[y0 * templateRes + x1];
            const v01 = template[y1 * templateRes + x0];
            const v11 = template[y1 * templateRes + x1];

            const val = v00 * (1-fx)*(1-fy) + v10 * fx*(1-fy)
                      + v01 * (1-fx)*fy     + v11 * fx*fy;

            // Apply contrast and convert to luminance
            const lum = midPoint + midPoint * contrast * val;
            const clamped = Math.max(0, Math.min(255, Math.round(lum)));

            const idx = (canvasY * W + canvasX) * 4;
            d[idx] = d[idx+1] = d[idx+2] = clamped;
        }
    }

    ctx.putImageData(img, 0, 0);
}

/**
 * Clear the canvas to calibrated mid-grey.
 */
export function clearToGrey(canvas, midPoint) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = `rgb(${midPoint},${midPoint},${midPoint})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}
