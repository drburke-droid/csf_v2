/**
 * Filter Core — 2D FFT + Raised Cosine Bandpass
 * ===============================================
 * Shared signal processing functions used by both
 * the Sloan letter and Tumbling E generators.
 */

// ─── 1D Radix-2 FFT ────────────────────────────────────────────────────────

function fft1d(re, im, invert) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = 2 * Math.PI / len * (invert ? -1 : 1);
        const wRe = Math.cos(ang), wIm = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let curRe = 1, curIm = 0;
            for (let j = 0; j < len / 2; j++) {
                const uRe = re[i + j], uIm = im[i + j];
                const vRe = re[i + j + len/2] * curRe - im[i + j + len/2] * curIm;
                const vIm = re[i + j + len/2] * curIm + im[i + j + len/2] * curRe;
                re[i + j] = uRe + vRe;
                im[i + j] = uIm + vIm;
                re[i + j + len/2] = uRe - vRe;
                im[i + j + len/2] = uIm - vIm;
                const newCurRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = newCurRe;
            }
        }
    }
    if (invert) {
        for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
    }
}

// ─── 2D FFT (separable) ────────────────────────────────────────────────────

function fft2d(re, im, N, invert) {
    const rowRe = new Float64Array(N), rowIm = new Float64Array(N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) { rowRe[x] = re[y * N + x]; rowIm[x] = im[y * N + x]; }
        fft1d(rowRe, rowIm, invert);
        for (let x = 0; x < N; x++) { re[y * N + x] = rowRe[x]; im[y * N + x] = rowIm[x]; }
    }
    const colRe = new Float64Array(N), colIm = new Float64Array(N);
    for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) { colRe[y] = re[y * N + x]; colIm[y] = im[y * N + x]; }
        fft1d(colRe, colIm, invert);
        for (let y = 0; y < N; y++) { re[y * N + x] = colRe[y]; im[y * N + x] = colIm[y]; }
    }
}

// ─── Raised Cosine Bandpass ─────────────────────────────────────────────────

function buildRaisedCosineFilter(N, centerCycPerObj, bwOctaves) {
    const filter = new Float64Array(N * N);
    const halfBW = bwOctaves / 2;

    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const fx = (x <= N/2 ? x : x - N);
            const fy = (y <= N/2 ? y : y - N);
            const f = Math.sqrt(fx * fx + fy * fy);

            if (f === 0) { filter[y * N + x] = 0; continue; }

            const octDist = Math.abs(Math.log2(f / centerCycPerObj));
            if (octDist <= halfBW) {
                filter[y * N + x] = 0.5 * (1 + Math.cos(Math.PI * octDist / halfBW));
            }
        }
    }
    return filter;
}

/**
 * Apply raised-cosine bandpass filter to a signed image.
 * Input: Float64Array of N×N values (centered around 0).
 * Returns: Float64Array of N×N contrast-normalized values (range [-1, 1]).
 */
export function applyBandpassFilter(inputRe, N, centerFreq, bandwidth) {
    const re = new Float64Array(inputRe);
    const im = new Float64Array(N * N);
    const filterMask = buildRaisedCosineFilter(N, centerFreq, bandwidth);

    // Forward FFT
    fft2d(re, im, N, false);

    // Apply filter
    for (let i = 0; i < N * N; i++) {
        re[i] *= filterMask[i];
        im[i] *= filterMask[i];
    }

    // Inverse FFT
    fft2d(re, im, N, true);

    // Contrast normalization
    let maxAbs = 0;
    for (let i = 0; i < N * N; i++) {
        const a = Math.abs(re[i]);
        if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs > 0) {
        for (let i = 0; i < N * N; i++) re[i] /= maxAbs;
    }

    return re;
}
