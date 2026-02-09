/**
 * qCSF Bayesian Adaptive Engine
 * ==============================
 * Implements the quick Contrast Sensitivity Function method.
 *
 * References:
 *   Lesmes, Lu, Baek & Albright (2010). J Vis 10(3):17.
 *   Watson & Ahumada (2005). J Vis 5(9):717-740.
 *   Hou et al. (2010). IOVS 51(10):5365-5377.
 *
 * CSF Model: Truncated log-parabola with 4 parameters:
 *   gmax  – peak gain (log10 sensitivity)
 *   fmax  – peak spatial frequency (cpd)
 *   beta  – bandwidth at half-height (octaves)
 *   delta – low-frequency truncation depth (log10 units below peak)
 *
 * Stimulus selection: one-step-ahead expected entropy minimization
 * with top-decile randomization (Lesmes et al., 2010).
 */

import { linspace } from './utils.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const KAPPA = Math.log10(2); // ≈0.3010

// ─── CSF Model ───────────────────────────────────────────────────────────────

/**
 * Truncated log-parabola CSF.
 * @param {number} freq  – spatial frequency (cpd)
 * @param {number} g     – peak gain (log10 sensitivity)
 * @param {number} f     – peak spatial frequency (cpd)
 * @param {number} b     – bandwidth (octaves)
 * @param {number} d     – low-freq truncation depth (log10 units)
 * @returns {number} log10(sensitivity)
 */
export function logParabolaCSF(freq, g, f, b, d) {
    const betaPrime = Math.log10(Math.pow(2, b));
    const logF    = Math.log10(freq);
    const logFmax = Math.log10(f);

    let logSens = g - KAPPA * Math.pow((logF - logFmax) / (betaPrime / 2), 2);

    // Low-frequency truncation: for f ≤ fmax, floor at (peakGain - delta)
    if (freq <= f) {
        const truncLevel = g - d;
        if (logSens < truncLevel) logSens = truncLevel;
    }

    return logSens;
}


// ─── Engine ──────────────────────────────────────────────────────────────────

/** Default parameter-space grid definitions. */
const DEFAULTS = {
    numAFC:             10,
    lapse:              0.04,
    psychometricSlope:  4.05,
    peakGainValues:     linspace(0.5, 2.8, 10),
    peakFreqValues:     [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16],
    bandwidthValues:    linspace(1.0, 6.0, 6),
    truncationValues:   [0, 0.5, 1.0, 1.5, 2.0],
    stimFreqs:          [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24],
    stimLogContrasts:   linspace(-3.0, 0.0, 30),
};

export class QCSFEngine {
    /**
     * @param {object} [options] – override any of the DEFAULTS above
     */
    constructor(options = {}) {
        const cfg = { ...DEFAULTS, ...options };

        // Task parameters
        this.numAFC     = cfg.numAFC;
        this.gamma      = 1 / this.numAFC;
        this.lapse      = cfg.lapse;
        this.slopeParam = cfg.psychometricSlope;

        // Build parameter grid  (gmax × fmax × beta × delta)
        this.paramGrid = [];
        for (const g of cfg.peakGainValues)
            for (const f of cfg.peakFreqValues)
                for (const b of cfg.bandwidthValues)
                    for (const d of cfg.truncationValues)
                        this.paramGrid.push({ g, f, b, d });
        this.nParams = this.paramGrid.length;

        // Build stimulus grid  (frequency × contrast)
        this.stimGrid = [];
        for (const freq of cfg.stimFreqs)
            for (const logC of cfg.stimLogContrasts)
                this.stimGrid.push({ freq, logContrast: logC });
        this.nStim = this.stimGrid.length;

        // Uniform prior
        this.prior = new Float64Array(this.nParams).fill(1 / this.nParams);

        // Precompute p(correct | hypothesis, stimulus)
        this._precompute();

        // State
        this.trialCount = 0;
        this.history    = [];
    }

    // ── Precomputation ───────────────────────────────────────────────────────

    /** Build the full (nParams × nStim) matrix of p(correct). */
    _precompute() {
        this.pCorrectMatrix = [];

        for (let h = 0; h < this.nParams; h++) {
            const p   = this.paramGrid[h];
            const row = new Float64Array(this.nStim);

            for (let s = 0; s < this.nStim; s++) {
                const stim    = this.stimGrid[s];
                const logSens = logParabolaCSF(stim.freq, p.g, p.f, p.b, p.d);

                // x = how far above threshold (positive = visible)
                const x   = logSens - (-stim.logContrast);
                const psi = 1 / (1 + Math.exp(-this.slopeParam * x));
                const pC  = this.gamma + (1 - this.gamma - this.lapse) * psi;

                row[s] = Math.max(0.001, Math.min(0.999, pC));
            }

            this.pCorrectMatrix.push(row);
        }
    }

    // ── Stimulus Selection ───────────────────────────────────────────────────

    /**
     * Select the next stimulus by minimizing expected posterior entropy.
     * Returns { frequency, contrast, logContrast, stimIndex }.
     */
    selectStimulus() {
        const ee = new Float64Array(this.nStim);

        for (let s = 0; s < this.nStim; s++) {
            let pCorr = 0;
            for (let h = 0; h < this.nParams; h++) {
                pCorr += this.pCorrectMatrix[h][s] * this.prior[h];
            }
            const pInc = 1 - pCorr;

            let hC = 0, hI = 0;
            for (let h = 0; h < this.nParams; h++) {
                const ph = this.prior[h];
                if (ph < 1e-30) continue;
                const pCH = this.pCorrectMatrix[h][s];

                if (pCorr > 1e-30) {
                    const n = (ph * pCH) / pCorr;
                    if (n > 1e-30) hC -= n * Math.log2(n);
                }
                if (pInc > 1e-30) {
                    const n = (ph * (1 - pCH)) / pInc;
                    if (n > 1e-30) hI -= n * Math.log2(n);
                }
            }
            ee[s] = pCorr * hC + pInc * hI;
        }

        // Top-decile randomized selection
        const sorted = Array.from(ee)
            .map((e, i) => ({ e, i }))
            .sort((a, b) => a.e - b.e);

        const topN   = Math.max(1, Math.ceil(this.nStim * 0.1));
        const chosen = sorted[Math.floor(Math.random() * topN)];
        const stim   = this.stimGrid[chosen.i];

        return {
            frequency:   stim.freq,
            contrast:    Math.pow(10, stim.logContrast),
            logContrast: stim.logContrast,
            stimIndex:   chosen.i,
        };
    }

    // ── Bayesian Update ──────────────────────────────────────────────────────

    /**
     * Update posterior after observing a response.
     * @param {number}  stimIndex – from selectStimulus()
     * @param {boolean} correct   – observer's response
     */
    update(stimIndex, correct) {
        let total = 0;
        for (let h = 0; h < this.nParams; h++) {
            const pCH = this.pCorrectMatrix[h][stimIndex];
            this.prior[h] *= correct ? pCH : (1 - pCH);
            total += this.prior[h];
        }
        if (total > 0) {
            for (let h = 0; h < this.nParams; h++) this.prior[h] /= total;
        }

        this.trialCount++;
        this.history.push({ trial: this.trialCount, stimIndex, correct });
    }

    // ── Estimation ───────────────────────────────────────────────────────────

    /** MAP estimate (posterior mode). */
    getEstimate() {
        let best = 0;
        for (let h = 1; h < this.nParams; h++) {
            if (this.prior[h] > this.prior[best]) best = h;
        }
        const p = this.paramGrid[best];
        return { peakGain: p.g, peakFreq: p.f, bandwidth: p.b, truncation: p.d };
    }

    /** Posterior mean estimate (averages in log-space for frequency). */
    getExpectedEstimate() {
        let gM = 0, fM = 0, bM = 0, dM = 0;
        for (let h = 0; h < this.nParams; h++) {
            const w = this.prior[h], p = this.paramGrid[h];
            gM += w * p.g;
            fM += w * Math.log10(p.f);
            bM += w * p.b;
            dM += w * p.d;
        }
        return { peakGain: gM, peakFreq: Math.pow(10, fM), bandwidth: bM, truncation: dM };
    }

    /** Evaluate CSF at a specific frequency using given (or default) params. */
    evaluateCSF(freq, params) {
        const p = params || this.getExpectedEstimate();
        return logParabolaCSF(freq, p.peakGain, p.peakFreq, p.bandwidth, p.truncation);
    }

    /** AULCSF: trapezoidal integration of log-sensitivity over log-frequency. */
    computeAULCSF(params) {
        const p      = params || this.getExpectedEstimate();
        const N      = 500;
        const logMin = Math.log10(0.5);
        const logMax = Math.log10(36);
        const dLogF  = (logMax - logMin) / N;
        let area = 0;

        for (let i = 0; i <= N; i++) {
            const f    = Math.pow(10, logMin + i * dLogF);
            const logS = this.evaluateCSF(f, p);
            if (logS > 0) {
                const w = (i === 0 || i === N) ? 0.5 : 1.0;
                area += logS * dLogF * w;
            }
        }
        return area;
    }

    /** Generate an array of {freq, logS} points for plotting. */
    getCSFCurve(params) {
        const p     = params || this.getExpectedEstimate();
        const curve = [];
        for (let i = 0; i < 100; i++) {
            const f = Math.pow(10, -0.3 + i * 2.0 / 99);
            curve.push({ freq: f, logS: this.evaluateCSF(f, p) });
        }
        return curve;
    }
}
