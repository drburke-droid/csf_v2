/**
 * Shared utility functions for the qCSF project.
 */

/** Generate n evenly spaced values from a to b (inclusive). */
export function linspace(a, b, n) {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(a + (b - a) * i / (n - 1));
    return arr;
}

/** Generate n logarithmically spaced values from 10^logStart to 10^logEnd. */
export function logspace(logStart, logEnd, n) {
    return linspace(logStart, logEnd, n).map(v => Math.pow(10, v));
}

/** Read a calibration value from localStorage, returning null if missing/invalid. */
export function getCalibration(key) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const val = parseFloat(raw);
    return isNaN(val) ? null : val;
}

/** Validate that all required calibration values are present and positive. */
export function isCalibrated() {
    const pxPerMm = getCalibration('user_px_per_mm');
    const distMm  = getCalibration('user_distance_mm');
    return pxPerMm !== null && distMm !== null && pxPerMm > 0 && distMm > 0;
}

/** Get all calibration values as an object. */
export function getCalibrationData() {
    return {
        pxPerMm:  getCalibration('user_px_per_mm') || 0,
        distMm:   getCalibration('user_distance_mm') || 0,
        midPoint: parseInt(localStorage.getItem('user_gamma_grey') || '128'),
        isMirror: localStorage.getItem('mirror_mode') === 'true'
    };
}

/** Check if calibration is older than the given threshold (ms). */
export function isCalibrationStale(maxAgeMs = 24 * 60 * 60 * 1000) {
    const ts = localStorage.getItem('cal_timestamp');
    if (!ts) return true; // no timestamp = treat as stale
    const age = Date.now() - new Date(ts).getTime();
    return age > maxAgeMs;
}
