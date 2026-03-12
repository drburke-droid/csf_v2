/**
 * App Configuration
 * =================
 * Mode detection and shared constants.
 *
 * Modes:
 *   clinic  – Full scoring, normative ranks, clinical parameters (default)
 *   patient – Educational framing, no scoring, CSF Explorer handoff
 *
 * Usage:
 *   Open index.html?mode=patient  for patient-facing version
 *   Open index.html               for clinic version (default)
 */

const params = new URLSearchParams(window.location.search);

/** Current app mode: 'patient' or 'clinic' */
export const APP_MODE = params.get('mode') === 'patient' ? 'patient' : 'clinic';

export function isPatientMode() { return APP_MODE === 'patient'; }
export function isClinicMode()  { return APP_MODE === 'clinic'; }

/** Base URL for the CSF Explorer handoff */
export const EXPLORER_URL = 'https://calgaryvisioncentre.com/blog/seeing-beyond-2020';

/**
 * Build a CSF Explorer URL with curve parameters.
 * @param {object} params – { peakGain, peakFreq, bandwidth, truncation }
 * @returns {string}
 */
export function buildExplorerURL(csfParams) {
    const p = csfParams;
    const url = new URL(EXPLORER_URL);
    url.searchParams.set('g', p.peakGain.toFixed(2));
    url.searchParams.set('f', p.peakFreq.toFixed(2));
    url.searchParams.set('b', p.bandwidth.toFixed(2));
    url.searchParams.set('d', p.truncation.toFixed(2));
    return url.toString();
}

/** Preserve mode param when navigating between pages */
export function withMode(href) {
    if (APP_MODE === 'patient') {
        const sep = href.includes('?') ? '&' : '?';
        return href + sep + 'mode=patient';
    }
    return href;
}
