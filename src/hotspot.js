// A button drawn in the camera picture that is "pressed" by resting a
// fingertip on it. Pure: no DOM, unit tested.
//
// It toggles once a fingertip has stayed inside for `dwellMs`, so a hand
// passing through does nothing. After toggling it will not fire again until
// every fingertip has left and `cooldownMs` has passed.
export class DwellButton {
  constructor({ x, y, radius, dwellMs, cooldownMs }) {
    Object.assign(this, { x, y, radius, dwellMs, cooldownMs });
    this.on = false;
    this.progress = 0;     // 0..1 while a fingertip is dwelling, for drawing
    this.enteredAt = null;
    this.armed = true;
    this.toggledAt = -Infinity;
  }

  moveTo(x, y) {
    this.x = x;
    this.y = y;
    this.enteredAt = null;
    this.progress = 0;
  }

  contains(point, slack = 1) {
    return Math.hypot(point.x - this.x, point.y - this.y) <= this.radius * slack;
  }

  toggle(time) {
    this.on = !this.on;
    this.armed = false;
    this.enteredAt = null;
    this.progress = 0;
    this.toggledAt = time;
  }

  // points: fingertip positions this frame. Returns true when it toggles.
  update(points, time) {
    const inside = points.some(point => this.contains(point));
    if (!inside) {
      this.enteredAt = null;
      this.progress = 0;
      if (time - this.toggledAt >= this.cooldownMs) this.armed = true;
      return false;
    }
    if (!this.armed) return false;
    if (this.enteredAt === null) this.enteredAt = time;
    this.progress = Math.min(1, (time - this.enteredAt) / this.dwellMs);
    if (this.progress < 1) return false;
    this.toggle(time);
    return true;
  }
}
