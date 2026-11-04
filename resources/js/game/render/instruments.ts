import type { AircraftDerived, AircraftState } from '@/sim/core';

/**
 * Приборы пилота в исторических единицах (раздел 12): mph, футы, ft/min, дюймы рт. ст.
 * Рисуются в canvas, который служит текстурой приборной доски в 3D и запасной 2D-панелью.
 */
export const MS_TO_MPH = 2.236936;
export const M_TO_FT = 3.28084;

type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;

function dial(ctx: Ctx, cx: number, cy: number, r: number, label: string): void {
    ctx.save();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#d9d4c4';
    ctx.font = `${Math.round(r * 0.16)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + r * 0.45);
    ctx.restore();
}

function ticks(ctx: Ctx, cx: number, cy: number, r: number, from: number, to: number, count: number, labels?: (i: number) => string): void {
    ctx.save();
    ctx.strokeStyle = '#e8e3d3';
    ctx.fillStyle = '#e8e3d3';
    ctx.font = `${Math.round(r * 0.17)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= count; i++) {
        const a = from + ((to - from) * i) / count - Math.PI / 2;
        const major = labels !== undefined;

        ctx.lineWidth = major ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();

        if (labels) {
            ctx.fillText(labels(i), cx + Math.cos(a) * r * 0.65, cy + Math.sin(a) * r * 0.65);
        }
    }

    ctx.restore();
}

function needle(ctx: Ctx, cx: number, cy: number, r: number, angle: number, color = '#f4f1e6', width = 4): void {
    const a = angle - Math.PI / 2;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * r * 0.15, cy - Math.sin(a) * r * 0.15);
    ctx.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
    ctx.stroke();
    ctx.restore();
}

function airspeed(ctx: Ctx, cx: number, cy: number, r: number, mph: number): void {
    dial(ctx, cx, cy, r, 'MPH');
    const max = 400;
    const span = TAU * 0.9;

    ticks(ctx, cx, cy, r, 0, span, 8, (i) => String(i * 50));
    ticks(ctx, cx, cy, r, 0, span, 40);
    needle(ctx, cx, cy, r, (Math.min(Math.max(mph, 0), max) / max) * span);
}

function altimeter(ctx: Ctx, cx: number, cy: number, r: number, feet: number): void {
    dial(ctx, cx, cy, r, 'ALT FT');
    ticks(ctx, cx, cy, r, 0, TAU, 10, (i) => (i < 10 ? String(i) : ''));
    ticks(ctx, cx, cy, r, 0, TAU, 50);
    needle(ctx, cx, cy, r * 0.6, ((feet / 10000) % 1) * TAU, '#f4f1e6', 6);
    needle(ctx, cx, cy, r, ((feet / 1000) % 1) * TAU);
    ctx.fillStyle = '#e8e3d3';
    ctx.font = `${Math.round(r * 0.2)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(feet / 10) * 10).padStart(5, ' '), cx, cy - r * 0.3);
}

function variometer(ctx: Ctx, cx: number, cy: number, r: number, fpm: number): void {
    dial(ctx, cx, cy, r, 'CLIMB ×100');
    const limit = 2000;
    const v = Math.max(-limit, Math.min(limit, fpm));

    ticks(ctx, cx, cy, r, -Math.PI / 2 - Math.PI * 0.95, -Math.PI / 2 + Math.PI * 0.95, 8, (i) => String(Math.abs((i - 4) * 5)));
    needle(ctx, cx, cy, r, -Math.PI / 2 + (v / limit) * Math.PI * 0.95);
}

function attitude(ctx: Ctx, cx: number, cy: number, r: number, pitch: number, roll: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-roll);

    const offset = Math.max(-r, Math.min(r, pitch * r * 2.2));

    ctx.fillStyle = '#3b6ea5';
    ctx.fillRect(-r * 2, -r * 2 + offset, r * 4, r * 2);
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(-r * 2, offset, r * 4, r * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;

    for (const deg of [-20, -10, 10, 20]) {
        const y = offset - (deg * Math.PI) / 180 * r * 2.2;

        ctx.beginPath();
        ctx.moveTo(-r * 0.25, y);
        ctx.lineTo(r * 0.25, y);
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(-r * 2, offset);
    ctx.lineTo(r * 2, offset);
    ctx.stroke();
    ctx.restore();

    // Силуэт самолёта.
    ctx.save();
    ctx.strokeStyle = '#ffb300';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy);
    ctx.lineTo(cx - r * 0.15, cy);
    ctx.lineTo(cx, cy + r * 0.1);
    ctx.lineTo(cx + r * 0.15, cy);
    ctx.lineTo(cx + r * 0.55, cy);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, 0, TAU);
    ctx.stroke();
}

function headingIndicator(ctx: Ctx, cx: number, cy: number, r: number, heading: number): void {
    dial(ctx, cx, cy, r, '');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-heading);
    ctx.fillStyle = '#e8e3d3';
    ctx.strokeStyle = '#e8e3d3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(r * 0.2)}px sans-serif`;

    for (let i = 0; i < 36; i++) {
        const a = (i * TAU) / 36;
        const major = i % 3 === 0;

        ctx.save();
        ctx.rotate(a);
        ctx.lineWidth = major ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(0, -r * (major ? 0.82 : 0.9));
        ctx.stroke();

        if (major) {
            const label = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'][i / 3] ?? '';

            ctx.fillText(label, 0, -r * 0.66);
        }

        ctx.restore();
    }

    ctx.restore();
    ctx.strokeStyle = '#ffb300';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.55);
    ctx.lineTo(cx, cy + r * 0.4);
    ctx.moveTo(cx - r * 0.3, cy - r * 0.1);
    ctx.lineTo(cx + r * 0.3, cy - r * 0.1);
    ctx.stroke();
}

function turnSlip(ctx: Ctx, cx: number, cy: number, r: number, turnRate: number, slip: number): void {
    dial(ctx, cx, cy, r, 'TURN');
    // Стрелка поворота: стандартный разворот 3°/с — отметка.
    const standard = (3 * Math.PI) / 180;

    needle(ctx, cx, cy, r * 0.9, Math.max(-1.3, Math.min(1.3, (turnRate / standard) * 0.5)));
    ctx.strokeStyle = '#e8e3d3';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - r * 0.6, cy + r * 0.48, r * 1.2, r * 0.26);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx + Math.max(-1, Math.min(1, -slip * 4)) * r * 0.5, cy + r * 0.61, r * 0.11, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#ddd';
    ctx.stroke();
}

function dualGauge(ctx: Ctx, cx: number, cy: number, r: number, label: string, left: number, right: number, max: number, labels: (i: number) => string): void {
    dial(ctx, cx, cy, r, label);
    const span = TAU * 0.8;

    ticks(ctx, cx, cy, r, -span / 2, span / 2, 6, labels);
    needle(ctx, cx, cy, r, -span / 2 + (Math.min(left, max) / max) * span, '#f4f1e6');
    needle(ctx, cx, cy, r * 0.9, -span / 2 + (Math.min(right, max) / max) * span, '#ffb300', 3);
}

function pdi(ctx: Ctx, cx: number, cy: number, r: number, deflection: number): void {
    dial(ctx, cx, cy, r, 'PDI');
    needle(ctx, cx, cy, r, Math.max(-1, Math.min(1, deflection)) * 0.8);
}

export const PANEL_WIDTH = 1536;
export const PANEL_HEIGHT = 512;

export function drawPilotPanel(ctx: Ctx, state: AircraftState, d: AircraftDerived, extras: { pdi: number }): void {
    ctx.fillStyle = '#23241f';
    ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);

    const r = 105;
    const row1 = 140;
    const row2 = 380;

    airspeed(ctx, 150, row1, r, d.indicatedAirspeed * MS_TO_MPH);
    attitude(ctx, 410, row1, r, d.pitch, d.roll);
    altimeter(ctx, 670, row1, r, d.altitude * M_TO_FT);
    turnSlip(ctx, 150, row2, r, d.turnRate, d.slip);
    headingIndicator(ctx, 410, row2, r, d.heading);
    variometer(ctx, 670, row2, r, d.verticalSpeed * M_TO_FT * 60);

    const [l, rr] = state.engines;

    dualGauge(ctx, 950, row1, r, 'MAN. PRESS', l.manifoldInHg, rr.manifoldInHg, 60, (i) => String(i * 10));
    dualGauge(ctx, 950, row2, r, 'RPM ×100', l.rpm, rr.rpm, 3000, (i) => String(i * 5));
    pdi(ctx, 1220, row1, r * 0.85, extras.pdi);

    // Табло: шасси, закрылки, РУД.
    ctx.fillStyle = '#e8e3d3';
    ctx.font = '30px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`GEAR  ${state.gear > 0.98 ? 'DOWN' : state.gear < 0.02 ? 'UP' : 'TRANSIT'}`, 1140, 330);
    ctx.fillText(`FLAPS ${Math.round(state.flaps * 100)}%`, 1140, 372);
    ctx.fillText(`FUEL  ${Math.round(state.fuelKg.reduce((a, b) => a + b, 0) * 0.367)} gal`, 1140, 414);
    ctx.fillStyle = state.contact === 'crashed' ? '#ff5544' : '#7fbf6a';
    ctx.fillText(state.contact.toUpperCase(), 1140, 456);
}
