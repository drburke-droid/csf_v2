/**
 * Export Utilities
 * ================
 * Export CSF session data as JSON or CSV for clinical records.
 */

/**
 * Export a session as a downloadable JSON file.
 * @param {object} session - record from IndexedDB
 */
export function exportSessionJSON(session) {
    const data = {
        patientId: session.patientId,
        date: session.timestamp,
        mode: session.mode,
        trialCount: session.trialCount,
        aulcsf: session.aulcsf,
        rank: session.rank,
        params: session.params,
        notchProb: session.notchProb,
        notchEstimate: session.notchEstimate,
        bmaCurve: session.bmaCurve,
        history: session.history
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const name = `csf_${session.patientId}_${session.timestamp.slice(0, 10)}.json`;
    downloadBlob(blob, name);
}

/**
 * Export a session's BMA curve as a CSV file.
 * @param {object} session - record from IndexedDB
 */
export function exportSessionCSV(session) {
    const lines = [
        `# Patient: ${session.patientId}`,
        `# Date: ${session.timestamp}`,
        `# Mode: ${session.mode}`,
        `# AULCSF: ${session.aulcsf.toFixed(3)}`,
        `# Rank: ${session.rank}`,
        `# Trials: ${session.trialCount}`,
        'frequency_cpd,log_sensitivity,sensitivity'
    ];
    for (const pt of session.bmaCurve) {
        const sens = Math.pow(10, pt.logS);
        lines.push(`${pt.freq.toFixed(3)},${pt.logS.toFixed(4)},${sens.toFixed(2)}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const name = `csf_${session.patientId}_${session.timestamp.slice(0, 10)}.csv`;
    downloadBlob(blob, name);
}

/**
 * Export multiple sessions (same patient) as a single CSV for longitudinal comparison.
 * @param {object[]} sessions - array of records from IndexedDB
 */
export function exportMultipleCSV(sessions) {
    if (!sessions.length) return;
    const lines = ['patientId,date,mode,frequency_cpd,log_sensitivity,sensitivity'];
    for (const s of sessions) {
        for (const pt of s.bmaCurve) {
            const sens = Math.pow(10, pt.logS);
            lines.push(`${s.patientId},${s.timestamp},${s.mode},${pt.freq.toFixed(3)},${pt.logS.toFixed(4)},${sens.toFixed(2)}`);
        }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const pid = sessions[0].patientId;
    const name = `csf_${pid}_longitudinal.csv`;
    downloadBlob(blob, name);
}

/** Trigger a file download in the browser. */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
