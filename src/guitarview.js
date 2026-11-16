// Guitar-mode drawing: fingertip trails and the readout panel.
import { GUITAR, THEME } from './config.js';

// pulse: 0..1, how recently a hit landed; trails flare with it.
export function drawTrails(ctx, session, time, pulse = 0) {
  ctx.save();
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const role of ['fret', 'pick']) {
    const { motion } = session[role];
    if (!motion.last || time - motion.last.time > GUITAR.gapMs) continue;
    ctx.strokeStyle = GUITAR.colors[role];
    for (const trail of motion.trails) {
      for (let i = 1; i < trail.length; i++) {
        const age = (time - trail[i].time) / GUITAR.trailMs;
        ctx.globalAlpha = Math.max(0, 0.6 * (1 - age));
        ctx.lineWidth = (1 + 4 * (1 - age)) * (1 + GUITAR.show.pulseWidth * pulse);
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// The practice panel, terminal style. view: { note, cents, chord, level, audio, noSignal, summary }
export function drawReadout(ctx, width, view) {
  const { summary } = view;
  const x = 16, y = 16, w = Math.min(width - 32, 440), h = 150;
  ctx.save();
  ctx.fillStyle = THEME.panel + 'dd';
  ctx.strokeStyle = THEME.border;
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = THEME.green;
  ctx.font = `700 40px ${THEME.font}`;
  ctx.fillText(!view.audio ? 'NO_AUDIO' : view.noSignal ? 'NO_SIGNAL' : (view.note || '--'), x + 16, y + 52);
  if (view.audio) {
    if (view.note) {
      ctx.font = `700 14px ${THEME.font}`;
      ctx.fillStyle = view.chord || Math.abs(view.cents) <= 10 ? THEME.green : THEME.yellow;
      ctx.fillText(view.chord ? 'POWER_CHORD' : `${view.cents > 0 ? '+' : ''}${view.cents} CENTS`, x + 150, y + 50);
    }
    // Level meter, on a rough decibel scale from -60 dB to 0 dB.
    const fill = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(view.level, 1e-6)) + 60) / 60));
    ctx.fillStyle = THEME.border;
    ctx.fillRect(x + 290, y + 34, w - 306, 8);
    ctx.fillStyle = THEME.green;
    ctx.fillRect(x + 290, y + 34, (w - 306) * fill, 8);
  }

  ctx.font = `700 15px ${THEME.font}`;
  const row = (label, value, line) => {
    ctx.fillStyle = THEME.muted;
    ctx.fillText(label, x + 16, y + line);
    ctx.fillStyle = THEME.text;
    ctx.fillText(value, x + 136, y + line);
  };
  row('PICK_MOVES', `${summary.pick.strokesPerMin}/min  total ${summary.pick.strokes}`, 86);
  row('FRET_SHIFTS', `${summary.fret.shifts}  fingers ${summary.fret.fingerCmPerS} cm/s`, 110);
  row('HITS', view.audio ? `${summary.notes.perMin}/min  total ${summary.notes.count}` : 'need audio', 134);
  ctx.restore();
}

// The on-screen button: a ring that fills as a fingertip rests on it.
export function drawButton(ctx, button, label) {
  const { x, y, radius } = button;
  ctx.save();
  ctx.lineWidth = 4;
  ctx.fillStyle = button.on ? THEME.green + '33' : THEME.background + '66';
  ctx.strokeStyle = button.on ? THEME.green : THEME.text + 'aa';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (button.progress > 0) {
    ctx.strokeStyle = THEME.green;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(x, y, radius + 7, -Math.PI / 2, -Math.PI / 2 + button.progress * Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = THEME.text;
  ctx.font = `700 17px ${THEME.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
  ctx.restore();
}

// The big chord or note name, in terminal green. It nudges slightly on each
// hit and fades when the sound stops; it never flashes or changes brightness.
// hitAge / heardAge: ms since the last animated hit / since it was last heard.
export function drawChordName(ctx, width, height, { name, hitAge, heardAge }) {
  const { chordY, chordPx, popMs, popScale, holdMs, fadeMs } = GUITAR.show;
  if (!name) return;
  const alpha = heardAge <= holdMs ? 1 : Math.max(0, 1 - (heardAge - holdMs) / fadeMs);
  if (alpha <= 0) return;
  const pop = Math.max(0, 1 - hitAge / popMs) ** 2; // 1 at the moment of the hit, easing to 0
  ctx.save();
  ctx.translate(width / 2, height * chordY);
  ctx.scale(1 + popScale * pop, 1 + popScale * pop);
  ctx.globalAlpha = alpha;
  ctx.font = `700 ${chordPx}px ${THEME.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 10;
  ctx.strokeStyle = THEME.background + 'cc';
  ctx.strokeText(name, 0, 0);
  ctx.shadowColor = THEME.green + '88';
  ctx.shadowBlur = 12;
  ctx.fillStyle = THEME.green;
  ctx.fillText(name, 0, 0);
  ctx.restore();
}

// A thin, faint ring that spreads from the picking hand on a hit.
export function drawHitRing(ctx, origin, hitAge) {
  const { ringMs, ringPx, ringAlpha } = GUITAR.show;
  if (!origin || hitAge >= ringMs) return;
  const progress = hitAge / ringMs, eased = 1 - (1 - progress) ** 2;
  ctx.save();
  ctx.globalAlpha = ringAlpha * (1 - progress);
  ctx.strokeStyle = THEME.green;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, 24 + ringPx * eased, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
