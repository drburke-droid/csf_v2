/**
 * Results & Scoring
 * =================
 * Normative ranking and result formatting for the qCSF test.
 *
 * AULCSF normative ranges derived from published qCSF literature:
 *   Hou et al. (2016) J Vis 16(6):18  – 112 normal observers
 *   Hou et al. (2010) IOVS 51(10)     – young normals & amblyopes
 */

/**
 * @typedef {object} TestResult
 * @property {number} aulcsf     – area under the log CSF
 * @property {string} rank       – normative rank label (clinic mode only)
 * @property {string} detail     – formatted parameter summary
 * @property {object} params     – raw CSF parameter estimates
 * @property {number} notchProb  – posterior probability of a frequency-band deficit
 */

/**
 * Compute the final test result from the engine state.
 *
 * @param {QCSFEngine} engine – completed engine instance
 * @returns {TestResult}
 */
export function computeResult(engine) {
    const params = engine.getExpectedEstimate();
    const aulcsf = engine.computeAULCSF(params);

    let rank;
    if      (aulcsf > 2.0) rank = 'SUPERIOR';
    else if (aulcsf > 1.6) rank = 'ABOVE AVERAGE';
    else if (aulcsf > 1.2) rank = 'NORMAL';
    else if (aulcsf > 0.8) rank = 'BELOW AVERAGE';
    else                    rank = 'IMPAIRED';

    const peakSens = Math.pow(10, params.peakGain).toFixed(0);
    const detail   = `Peak: ${peakSens} @ ${params.peakFreq.toFixed(1)} cpd | BW: ${params.bandwidth.toFixed(1)} oct`;

    const notchProb = engine.getNotchProbability();

    return { aulcsf, rank, detail, params, notchProb };
}

/**
 * Build a full session record for database storage.
 *
 * @param {QCSFEngine} engine    – completed engine instance
 * @param {TestResult}  result   – from computeResult()
 * @param {string}      patientId
 * @param {string}      modeId   – 'gabor' | 'tumblingE' | 'sloan'
 * @returns {object} ready for IndexedDB
 */
export function buildSessionRecord(engine, result, patientId, modeId) {
    return {
        patientId,
        timestamp: new Date().toISOString(),
        mode: modeId,
        trialCount: engine.trialCount,
        aulcsf: result.aulcsf,
        rank: result.rank,
        detail: result.detail,
        params: result.params,
        bmaCurve: engine.getBMACurve(150),
        posterior: new Float64Array(engine.prior),
        notchProb: result.notchProb,
        notchEstimate: engine.getNotchEstimate(),
        history: [...engine.history]
    };
}
