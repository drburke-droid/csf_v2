/**
 * Keyboard Input — Multi-Mode
 * ============================
 * Arrow keys → direction (Gabor/Tumbling E)
 * Letter keys → Sloan identification
 * Space → start test
 */

const ARROW_MAP = {
    arrowup:    'up',
    arrowdown:  'down',
    arrowleft:  'left',
    arrowright: 'right',
    w: 'up',    s: 'down',    a: 'left',    d: 'right',
    // Gabor diagonals
    e: 'upright', q: 'upleft'
};

const SLOAN_KEYS = new Set(['c','d','h','k','n','o','r','s','v','z']);

export function initKeyboard(onInput) {
    function handler(e) {
        const key = e.key.toLowerCase();

        // Arrow / WASD → direction
        if (ARROW_MAP[key]) {
            e.preventDefault();
            onInput(ARROW_MAP[key]);
            return;
        }

        // Sloan letters
        if (SLOAN_KEYS.has(key)) {
            e.preventDefault();
            onInput(key);
            return;
        }

        // Space → generic start/advance
        if (key === ' ') {
            e.preventDefault();
            onInput('_start');
        }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
}
