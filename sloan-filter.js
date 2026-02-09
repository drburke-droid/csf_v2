/**
 * Sloan Letter Bandpass Filter
 * ============================
 * Generates the 10 standard Sloan optotypes (C D H K N O R S V Z),
 * applies a 2D raised-cosine bandpass filter, and produces
 * contrast-normalized templates.
 */

import { applyBandpassFilter } from './filter-core.js';

const RES = 256;
const SLOAN_LETTERS = ['C', 'D', 'H', 'K', 'N', 'O', 'R', 'S', 'V', 'Z'];

function drawSloanLetter(ctx, letter, size) {
    const u  = size / 5;
    const cx = ctx.canvas.width / 2;
    const cy = ctx.canvas.height / 2;
    const x0 = cx - size / 2;
    const y0 = cy - size / 2;

    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = u;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.beginPath();

    switch (letter) {
        case 'C':
            ctx.moveTo(x0 + 5*u, y0 + u/2);
            ctx.lineTo(x0 + u/2, y0 + u/2);
            ctx.lineTo(x0 + u/2, y0 + 5*u - u/2);
            ctx.lineTo(x0 + 5*u, y0 + 5*u - u/2);
            ctx.stroke(); break;
        case 'D':
            ctx.moveTo(x0 + u/2, y0 + u/2);
            ctx.lineTo(x0 + u/2, y0 + 5*u - u/2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x0 + u/2, y0 + u/2);
            ctx.lineTo(x0 + 3*u, y0 + u/2);
            ctx.quadraticCurveTo(x0 + 5*u - u/2, y0 + u/2, x0 + 5*u - u/2, y0 + 2.5*u);
            ctx.quadraticCurveTo(x0 + 5*u - u/2, y0 + 5*u - u/2, x0 + 3*u, y0 + 5*u - u/2);
            ctx.lineTo(x0 + u/2, y0 + 5*u - u/2);
            ctx.stroke(); break;
        case 'H':
            ctx.moveTo(x0 + u/2, y0 + u/2); ctx.lineTo(x0 + u/2, y0 + 5*u - u/2);
            ctx.moveTo(x0 + 5*u - u/2, y0 + u/2); ctx.lineTo(x0 + 5*u - u/2, y0 + 5*u - u/2);
            ctx.moveTo(x0 + u/2, y0 + 2.5*u); ctx.lineTo(x0 + 5*u - u/2, y0 + 2.5*u);
            ctx.stroke(); break;
        case 'K':
            ctx.moveTo(x0 + u/2, y0 + u/2); ctx.lineTo(x0 + u/2, y0 + 5*u - u/2);
            ctx.moveTo(x0 + 5*u - u/2, y0 + u/2); ctx.lineTo(x0 + u/2, y0 + 2.5*u);
            ctx.lineTo(x0 + 5*u - u/2, y0 + 5*u - u/2);
            ctx.stroke(); break;
        case 'N':
            ctx.moveTo(x0 + u/2, y0 + 5*u - u/2); ctx.lineTo(x0 + u/2, y0 + u/2);
            ctx.lineTo(x0 + 5*u - u/2, y0 + 5*u - u/2); ctx.lineTo(x0 + 5*u - u/2, y0 + u/2);
            ctx.stroke(); break;
        case 'O':
            ctx.moveTo(x0 + u/2, y0 + u);
            ctx.quadraticCurveTo(x0 + u/2, y0 + u/2, x0 + u, y0 + u/2);
            ctx.lineTo(x0 + 4*u, y0 + u/2);
            ctx.quadraticCurveTo(x0 + 5*u - u/2, y0 + u/2, x0 + 5*u - u/2, y0 + u);
            ctx.lineTo(x0 + 5*u - u/2, y0 + 4*u);
            ctx.quadraticCurveTo(x0 + 5*u - u/2, y0 + 5*u - u/2, x0 + 4*u, y0 + 5*u - u/2);
            ctx.lineTo(x0 + u, y0 + 5*u - u/2);
            ctx.quadraticCurveTo(x0 + u/2, y0 + 5*u - u/2, x0 + u/2, y0 + 4*u);
            ctx.closePath(); ctx.stroke(); break;
        case 'R':
            ctx.moveTo(x0 + u/2, y0 + 5*u - u/2); ctx.lineTo(x0 + u/2, y0 + u/2);
            ctx.lineTo(x0 + 3.5*u, y0 + u/2);
            ctx.quadraticCurveTo(x0 + 5*u - u/2, y0 + u/2, x0 + 5*u - u/2, y0 + 1.5*u);
            ctx.quadraticCurveTo(x0 + 5*u - u/2, y0 + 2.5*u, x0 + 3*u, y0 + 2.5*u);
            ctx.lineTo(x0 + u/2, y0 + 2.5*u);
            ctx.moveTo(x0 + 2.5*u, y0 + 2.5*u); ctx.lineTo(x0 + 5*u - u/2, y0 + 5*u - u/2);
            ctx.stroke(); break;
        case 'S':
            ctx.moveTo(x0 + 5*u - u/2, y0 + u);
            ctx.quadraticCurveTo(x0 + 5*u - u/2, y0 + u/2, x0 + 2.5*u, y0 + u/2);
            ctx.quadraticCurveTo(x0 + u/2, y0 + u/2, x0 + u/2, y0 + 1.5*u);
            ctx.quadraticCurveTo(x0 + u/2, y0 + 2.5*u, x0 + 2.5*u, y0 + 2.5*u);
            ctx.quadraticCurveTo(x0 + 5*u - u/2, y0 + 2.5*u, x0 + 5*u - u/2, y0 + 3.5*u);
            ctx.quadraticCurveTo(x0 + 5*u - u/2, y0 + 5*u - u/2, x0 + 2.5*u, y0 + 5*u - u/2);
            ctx.quadraticCurveTo(x0 + u/2, y0 + 5*u - u/2, x0 + u/2, y0 + 4*u);
            ctx.stroke(); break;
        case 'V':
            ctx.moveTo(x0 + u/2, y0 + u/2); ctx.lineTo(x0 + 2.5*u, y0 + 5*u - u/2);
            ctx.lineTo(x0 + 5*u - u/2, y0 + u/2);
            ctx.stroke(); break;
        case 'Z':
            ctx.moveTo(x0 + u/2, y0 + u/2); ctx.lineTo(x0 + 5*u - u/2, y0 + u/2);
            ctx.lineTo(x0 + u/2, y0 + 5*u - u/2); ctx.lineTo(x0 + 5*u - u/2, y0 + 5*u - u/2);
            ctx.stroke(); break;
    }
}

export function generateFilteredTemplates(options = {}) {
    const centerFreq = options.centerFreq || 4;
    const bandwidth  = options.bandwidth  || 1;
    const N          = options.resolution || RES;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = offCanvas.height = N;
    const offCtx = offCanvas.getContext('2d');

    const templates = [];

    for (const letter of SLOAN_LETTERS) {
        offCtx.fillStyle = '#fff';
        offCtx.fillRect(0, 0, N, N);
        drawSloanLetter(offCtx, letter, N * 0.75);

        const imgData = offCtx.getImageData(0, 0, N, N);
        const re = new Float64Array(N * N);
        for (let i = 0; i < N * N; i++) {
            re[i] = (imgData.data[i * 4] / 255) - 0.5;
        }

        templates.push(applyBandpassFilter(re, N, centerFreq, bandwidth));
    }

    return { letters: [...SLOAN_LETTERS], templates, resolution: N, centerFreq };
}

export { SLOAN_LETTERS };
