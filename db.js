/**
 * Patient Database (IndexedDB)
 * ============================
 * Persists CSF test sessions by patient ID.
 * Stores full posterior (21K floats) for informative prior loading.
 */

const DB_NAME = 'manifold_csf';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('patientId', 'patientId', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('mode', 'mode', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Save a test session.
 * @param {object} record - { patientId, timestamp, mode, trialCount, aulcsf, rank, params, bmaCurve, posterior, notchProb, notchEstimate, history, detail }
 * @returns {Promise<number>} - the auto-generated session ID
 */
export async function saveSession(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.add(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get all sessions for a patient, newest first.
 * @param {string} patientId
 * @returns {Promise<object[]>}
 */
export async function getSessionsByPatient(patientId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const idx = store.index('patientId');
        const req = idx.getAll(patientId);
        req.onsuccess = () => {
            const results = req.result || [];
            results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            resolve(results);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get the most recent session for a patient.
 * @param {string} patientId
 * @returns {Promise<object|null>}
 */
export async function getLatestSession(patientId) {
    const sessions = await getSessionsByPatient(patientId);
    return sessions.length > 0 ? sessions[0] : null;
}

/**
 * Get all unique patient IDs.
 * @returns {Promise<string[]>}
 */
export async function getAllPatients() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
            const ids = [...new Set((req.result || []).map(r => r.patientId))];
            ids.sort();
            resolve(ids);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Delete a session by ID.
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteSession(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Get a single session by its auto-increment ID.
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getSession(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}
