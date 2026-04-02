/**
 * qCSF Bayesian Adaptive Engine
 * ==============================
 * Implements the quick Contrast Sensitivity Function method with an
 * extended model that supports frequency-band-specific sensitivity
 * deficits (notches).
 *
 * References:
 *   Lesmes, Lu, Baek & Albright (2010). J Vis 10(3):17.
 *   Watson & Ahumada (2005). J Vis 5(9):717-740.
 *   Hou et al. (2010). IOVS 51(10):5365-5377.
 *   Campbell & Robson (1968). J Physiol 197:551-566.
 *   Regan, Silver & Murray (1977). Brain 100:563-579.
 *   Bodis-Wollner (1972). Arch Ophthalmol 88:386-391.
 *
 * CSF Model: Truncated log-parabola with 4 base parameters
 *   + optional Gaussian notch (2 additional parameters):
 *
 *   gmax  – peak gain (log10 sensitivity)
 *   fmax  – peak spatial frequency (cpd)
 *   beta  – bandwidth at half-height (octaves)
 *   delta – low-frequency truncation depth (log10 units below peak)
 *   nD    – notch depth (log10 units, 0 = no notch)
 *   nF    – notch center frequency (cpd)
 *
 * The notch component models selective frequency-band deficits
 * documented in optic neuritis (Regan et al., 1977), neurological
 * conditions (Bodis-Wollner, 1972), and amblyopia (Hess & Howell,
 * 1977). It allows the curve to show dips at specific frequencies
 * while maintaining normal sensitivity elsewhere.
 *
 * Stimulus selection: one-step-ahead expected entropy minimization
 * with top-decile randomization (Lesmes et al., 2010).
 *
 * Curve display uses Bayesian Model Averaging (BMA) — the posterior-
 * weighted average of all hypothesis curves — which can represent
 * arbitrary CSF shapes including notches, asymmetries, and multi-
 * modal patterns (Hoeting et al., 1999).
 */

import { linspace } from './utils.js';

// ─── Constants ───────────────────────────────────────────────────────────────
const KAPPA = Math.log10(2); // ≈0.3010

// ─── CSF Model ───────────────────────────────────────────────────────────────

/**
 * Truncated log-parabola CSF with optional Gaussian notch.
 *
 * @param {number} freq  – spatial frequency (cpd)
 * @param {number} g     – peak gain (log10 sensitivity)
 * @param {number} f     – peak spatial frequency (cpd)
 * @param {number} b     – bandwidth (octaves)
 * @param {number} d     – low-freq truncation depth (log10 units)
 * @param {number} [nD=0] – notch depth (log10 units, 0 = no notch)
 * @param {number} [nF=0] – notch center frequency (cpd)
 * @param {number} [nW=0.3] – notch width (log10 units, ~1 octave)
 * @returns {number} log10(sensitivity)
 */
export function logParabolaCSF(freq, g, f, b, d, nD = 0, nF = 0, nW = 0.3) {
    const betaPrime = Math.log10(Math.pow(2, b));
    const logF    = Math.log10(freq);
    const logFmax = Math.log10(f);

    let logSens = g - KAPPA * Math.pow((logF - logFmax) / (betaPrime / 2), 2);

    // Low-frequency truncation: for f ≤ fmax, floor at (peakGain - delta)
    if (freq <= f) {
        const truncLevel = g - d;
        if (logSens < truncLevel) logSens = truncLevel;
    }

    // Gaussian notch: frequency-band-specific sensitivity deficit
    if (nD > 0 && nF > 0) {
        const logDist = logF - Math.log10(nF);
        logSens -= nD * Math.exp(-0.5 * (logDist / nW) * (logDist / nW));
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

    // Notch parameters: model frequency-band-specific deficits
    // Finer depths + more frequencies than original, prior weight reduced
    notchDepthValues:   [0, 0.3, 0.6, 1.0],
    notchFreqValues:    [2, 4, 6, 8],
    notchWidth:         0.3,              // fixed sigma (log10 units ≈ 1 octave)
    noNotchPriorWeight: 2.0,              // reduced from 5.0 — less resistance to detecting notches

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
        this.notchWidth = cfg.notchWidth;

        // Build parameter grid  (gmax × fmax × beta × delta × notch)
        this.paramGrid = [];
        for (const g of cfg.peakGainValues)
            for (const f of cfg.peakFreqValues)
                for (const b of cfg.bandwidthValues)
                    for (const d of cfg.truncationValues) {
                        // No-notch hypothesis
                        this.paramGrid.push({ g, f, b, d, nD: 0, nF: 0 });
                        // Notch hypotheses (only non-zero depths)
                        for (const nD of cfg.notchDepthValues) {
                            if (nD === 0) continue;
                            for (const nF of cfg.notchFreqValues) {
                                this.paramGrid.push({ g, f, b, d, nD, nF });
                            }
                        }
                    }
        this.nParams = this.paramGrid.length;

        // Build stimulus grid  (frequency × contrast)
        this.stimGrid = [];
        for (const freq of cfg.stimFreqs)
            for (const logC of cfg.stimLogContrasts)
                this.stimGrid.push({ freq, logContrast: logC });
        this.nStim = this.stimGrid.length;

        // Weighted prior: favor no-notch hypotheses
        const noNotchW = cfg.noNotchPriorWeight;
        this.prior = new Float64Array(this.nParams);
        let total = 0;
        for (let h = 0; h < this.nParams; h++) {
            const w = this.paramGrid[h].nD === 0 ? noNotchW : 1.0;
            this.prior[h] = w;
            total += w;
        }
        for (let h = 0; h < this.nParams; h++) this.prior[h] /= total;

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
                const logSens = logParabolaCSF(
                    stim.freq, p.g, p.f, p.b, p.d,
                    p.nD, p.nF, this.notchWidth
                );

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

        // Track entropy for convergence monitoring
        if (!this._entropyHistory) this._entropyHistory = [];
        this._entropyHistory.push(this.getPosteriorEntropy());
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

    /**
     * Posterior mean estimate of the 4 base parameters.
     * Used for parametric scoring (AULCSF) and Explorer handoff.
     */
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

    /**
     * Posterior probability that a notch is present.
     * Useful for clinical flagging of frequency-band deficits.
     */
    getNotchProbability() {
        let pNotch = 0;
        for (let h = 0; h < this.nParams; h++) {
            if (this.paramGrid[h].nD > 0) pNotch += this.prior[h];
        }
        return pNotch;
    }

    /**
     * MAP notch estimate (if notch is probable).
     * Returns { depth, freq } of the highest-posterior notch hypothesis,
     * or null if the MAP hypothesis has no notch.
     */
    getNotchEstimate() {
        let best = 0;
        for (let h = 1; h < this.nParams; h++) {
            if (this.prior[h] > this.prior[best]) best = h;
        }
        const p = this.paramGrid[best];
        if (p.nD === 0) return null;
        return { depth: p.nD, freq: p.nF };
    }

    /** Evaluate CSF at a specific frequency using given (or default) params. */
    evaluateCSF(freq, params) {
        const p = params || this.getExpectedEstimate();
        return logParabolaCSF(freq, p.peakGain, p.peakFreq, p.bandwidth, p.truncation);
    }

    /**
     * Bayesian Model Average (BMA) CSF value at a single frequency.
     *
     * Instead of averaging parameters and evaluating a single curve,
     * this averages the CSF values across all posterior hypotheses.
     * The result can represent non-standard shapes (dips, notches,
     * asymmetries) that no single log-parabola could.
     *
     * @param {number} freq – spatial frequency (cpd)
     * @returns {number} posterior-weighted log10(sensitivity)
     */
    getBMAValue(freq) {
        let logS = 0;
        for (let h = 0; h < this.nParams; h++) {
            const p = this.paramGrid[h];
            logS += this.prior[h] * logParabolaCSF(
                freq, p.g, p.f, p.b, p.d,
                p.nD, p.nF, this.notchWidth
            );
        }
        return logS;
    }

    /**
     * BMA CSF curve for plotting.
     * Returns an array of {freq, logS} that can represent any shape
     * supported by the posterior, including mid-frequency dips.
     *
     * @param {number} [nPoints=100] – number of curve points
     * @returns {Array<{freq: number, logS: number}>}
     */
    getBMACurve(nPoints = 100) {
        const curve = [];
        // Range: 0.5 cpd to 60 cpd (20/10 Snellen — clinical maximum)
        const logFMin = -0.3, logFMax = 1.78;
        for (let i = 0; i < nPoints; i++) {
            const freq = Math.pow(10, logFMin + i * (logFMax - logFMin) / (nPoints - 1));
            curve.push({ freq, logS: this.getBMAValue(freq) });
        }
        return curve;
    }

    /**
     * Compute AULCSF using BMA curve (accounts for notches).
     * For normative scoring, use computeAULCSF() with parametric params instead.
     */
    computeBMAAULCSF() {
        const N      = 500;
        const logMin = Math.log10(0.5);
        const logMax = Math.log10(36);
        const dLogF  = (logMax - logMin) / N;
        let area = 0;

        for (let i = 0; i <= N; i++) {
            const f    = Math.pow(10, logMin + i * dLogF);
            const logS = this.getBMAValue(f);
            if (logS > 0) {
                const w = (i === 0 || i === N) ? 0.5 : 1.0;
                area += logS * dLogF * w;
            }
        }
        return area;
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

    // ── Convergence Monitoring ────────────────────────────────────────────────

    /** Shannon entropy of the current posterior (bits). */
    getPosteriorEntropy() {
        let H = 0;
        for (let h = 0; h < this.nParams; h++) {
            const p = this.prior[h];
            if (p > 1e-20) H -= p * Math.log2(p);
        }
        return H;
    }

    /**
     * Check if the posterior has converged.
     * @param {number} thresholdBits  – entropy must be below this (default 5.5)
     * @param {number} deltaThreshold – entropy change per trial must be below this (default 0.05)
     * @param {number} windowSize     – number of recent trials to check delta over (default 5)
     * @returns {boolean}
     */
    isConverged(thresholdBits = 5.5, deltaThreshold = 0.05, windowSize = 5) {
        if (!this._entropyHistory || this._entropyHistory.length < windowSize) return false;
        const H = this._entropyHistory;
        const current = H[H.length - 1];
        if (current > thresholdBits) return false;
        // Average entropy change per trial over the window
        const older = H[H.length - windowSize];
        const delta = Math.abs(older - current) / windowSize;
        return delta < deltaThreshold;
    }

    /** Get convergence diagnostic info. */
    getConvergenceInfo() {
        const entropy = this._entropyHistory && this._entropyHistory.length > 0
            ? this._entropyHistory[this._entropyHistory.length - 1]
            : this.getPosteriorEntropy();
        return {
            entropy,
            entropyHistory: this._entropyHistory ? [...this._entropyHistory] : [],
            isConverged: this.isConverged(),
            trialCount: this.trialCount
        };
    }

    // ── Prior Management ──────────────────────────────────────────────────────

    /** Return a copy of the current posterior (for saving to database). */
    getPrior() {
        return new Float64Array(this.prior);
    }

    /**
     * Load an informative prior from a previous session, blended with the
     * default prior to avoid over-confidence if vision has changed.
     *
     * Must be called after construction but before the first selectStimulus().
     *
     * @param {Float64Array} priorArray – posterior from a previous session
     * @param {number} alpha – blending weight for informative prior (default 0.7)
     */
    loadPrior(priorArray, alpha = 0.7) {
        if (priorArray.length !== this.nParams) {
            console.warn('[Engine] Prior length mismatch:', priorArray.length, 'vs', this.nParams);
            return;
        }
        // Verify the incoming prior sums to ~1
        let inSum = 0;
        for (let h = 0; h < this.nParams; h++) inSum += priorArray[h];
        if (inSum < 0.01) {
            console.warn('[Engine] Prior sums to ~0, ignoring.');
            return;
        }

        // Blend: alpha * informative + (1-alpha) * default
        const defaultPrior = this.prior; // current (default) prior
        for (let h = 0; h < this.nParams; h++) {
            this.prior[h] = alpha * (priorArray[h] / inSum) + (1 - alpha) * defaultPrior[h];
        }
        // Renormalize
        let total = 0;
        for (let h = 0; h < this.nParams; h++) total += this.prior[h];
        if (total > 0) {
            for (let h = 0; h < this.nParams; h++) this.prior[h] /= total;
        }
    }

    /** Generate parametric curve {freq, logS} points for plotting. */
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
