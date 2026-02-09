/**
 * Stimulus Modes
 * ==============
 * Unified interface across three stimulus types:
 *   - gabor:  4-AFC orientation (V/H/DR/DL)
 *   - tumblingE:  4-AFC direction (Up/Down/Left/Right)
 *   - sloan: 10-AFC letter identification (C D H K N O R S V Z)
 *
 * Each mode exports: { numAFC, labels[], generate(), render(), pickTrial(), checkAnswer() }
 */

import { drawGabor }                               from './gabor.js';
import { generateFilteredEs, E_ORIENTATIONS }      from './tumbling-e.js';
import { generateFilteredTemplates, SLOAN_LETTERS } from './sloan-filter.js';
import { drawFilteredLetter }                      from './letter-renderer.js';

const CENTER_FREQ = 4;
const BANDWIDTH   = 1;
const ORIENTATIONS_4 = [0, 45, 90, 135];

/**
 * Create a stimulus mode controller.
 * @param {'gabor'|'tumblingE'|'sloan'} mode
 * @returns {object} mode controller
 */
export function createMode(mode) {
    switch (mode) {
        case 'gabor':      return createGaborMode();
        case 'tumblingE':  return createTumblingEMode();
        case 'sloan':      return createSloanMode();
        default: throw new Error(`Unknown stimulus mode: ${mode}`);
    }
}

// ─── Gabor Gratings (4-AFC orientation) ─────────────────────────────────────

function createGaborMode() {
    const ANGLE_MAP = { 0:'up', 90:'right', 45:'upright', 135:'upleft' };
    const labels = ['↑', '→', '↗', '↖'];
    const keys   = ['up', 'right', 'upright', 'upleft'];

    let currentAngle = 0;

    return {
        id: 'gabor',
        name: 'Gabor Grating',
        numAFC: 4,
        psychometricSlope: 3.5,
        labels,           // Display labels for response buttons
        keys,             // Internal key identifiers
        responseType: 'orientation',

        generate() { /* No templates needed */ },

        render(canvas, stim, cal) {
            currentAngle = ORIENTATIONS_4[Math.floor(Math.random() * 4)];
            drawGabor(canvas, {
                cpd: stim.frequency,
                contrast: stim.contrast,
                angle: currentAngle
            }, cal);
            return currentAngle;
        },

        checkAnswer(response) {
            const map = { up: 0, right: 90, upright: 45, upleft: 135 };
            return map[response] === currentAngle;
        }
    };
}

// ─── Tumbling E (4-AFC direction) ───────────────────────────────────────────

function createTumblingEMode() {
    const labels = ['→', '↓', '←', '↑'];
    const keys   = ['right', 'down', 'left', 'up'];

    let data = null;
    let currentIdx = 0;

    return {
        id: 'tumblingE',
        name: 'Tumbling E',
        numAFC: 4,
        psychometricSlope: 3.5,
        labels,
        keys,
        responseType: 'direction',

        generate() {
            data = generateFilteredEs({ centerFreq: CENTER_FREQ, bandwidth: BANDWIDTH });
        },

        render(canvas, stim, cal) {
            currentIdx = Math.floor(Math.random() * 4);
            drawFilteredLetter(canvas, {
                template:    data.templates[currentIdx],
                templateRes: data.resolution,
                centerFreq:  data.centerFreq,
                cpd:         stim.frequency,
                contrast:    stim.contrast
            }, cal);
            return E_ORIENTATIONS[currentIdx];
        },

        checkAnswer(response) {
            return response === E_ORIENTATIONS[currentIdx];
        }
    };
}

// ─── Sloan Letters (10-AFC identification) ──────────────────────────────────

function createSloanMode() {
    const labels = [...SLOAN_LETTERS];
    const keys   = SLOAN_LETTERS.map(l => l.toLowerCase());

    let data = null;
    let currentIdx = 0;

    return {
        id: 'sloan',
        name: 'Sloan Letters',
        numAFC: 10,
        psychometricSlope: 4.05,
        labels,
        keys,
        responseType: 'letter',

        generate() {
            data = generateFilteredTemplates({ centerFreq: CENTER_FREQ, bandwidth: BANDWIDTH });
        },

        render(canvas, stim, cal) {
            currentIdx = Math.floor(Math.random() * 10);
            drawFilteredLetter(canvas, {
                template:    data.templates[currentIdx],
                templateRes: data.resolution,
                centerFreq:  data.centerFreq,
                cpd:         stim.frequency,
                contrast:    stim.contrast
            }, cal);
            return SLOAN_LETTERS[currentIdx];
        },

        checkAnswer(response) {
            return response.toUpperCase() === SLOAN_LETTERS[currentIdx];
        }
    };
}

export const MODE_IDS = ['gabor', 'tumblingE', 'sloan'];
