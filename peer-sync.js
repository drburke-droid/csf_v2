/**
 * PeerJS Bidirectional Sync
 * =========================
 * Display ↔ Tablet communication protocol:
 *
 * Display → Tablet:
 *   { type: 'state',   mode, labels, keys, trial, maxTrials, responseType }
 *   { type: 'results', score, rank, detail }
 *   { type: 'progress', trial, maxTrials }
 *
 * Tablet → Display:
 *   { type: 'input',    value }
 *   { type: 'setMode',  mode }
 *   { type: 'settings', key, value }
 *   { type: 'command',  action }  // 'start', 'restart', 'calibrate'
 */

export function initSync(laneID, callbacks) {
    let activeConn = null;

    const peer = new Peer(laneID);

    peer.on('open', () => {
        const path = window.location.pathname;
        const dir  = path.substring(0, path.lastIndexOf('/'));
        const tabletURL = `${window.location.origin}${dir}/tablet.html?id=${laneID}`;
        if (callbacks.onReady) callbacks.onReady(tabletURL);
    });

    peer.on('connection', conn => {
        activeConn = conn;
        if (callbacks.onConnect) callbacks.onConnect();

        conn.on('data', data => {
            switch (data.type) {
                case 'input':
                    if (callbacks.onInput) callbacks.onInput(data.value);
                    break;
                case 'setMode':
                    if (callbacks.onModeChange) callbacks.onModeChange(data.mode);
                    break;
                case 'settings':
                    if (callbacks.onSettings) callbacks.onSettings(data.key, data.value);
                    break;
                case 'command':
                    if (callbacks.onCommand) callbacks.onCommand(data.action);
                    break;
            }
        });

        conn.on('close', () => {
            activeConn = null;
            if (callbacks.onDisconnect) callbacks.onDisconnect();
        });
    });

    peer.on('error', err => {
        console.warn('[Sync] PeerJS error:', err.type, err.message);
    });

    return {
        /** Send full state (mode info, labels, etc.) */
        sendState(state) {
            if (activeConn && activeConn.open) {
                activeConn.send({ type: 'state', ...state });
            }
        },

        /** Send progress update */
        sendProgress(trial, maxTrials) {
            if (activeConn && activeConn.open) {
                activeConn.send({ type: 'progress', trial, maxTrials });
            }
        },

        /** Send results */
        sendResults(score, rank, detail) {
            if (activeConn && activeConn.open) {
                activeConn.send({ type: 'results', score, rank, detail });
            }
        },

        /** Check if connected */
        get connected() { return activeConn && activeConn.open; },

        destroy() {
            if (activeConn) activeConn.close();
            peer.destroy();
        }
    };
}
