// Sonar.
//
// Visibility is 80 units and the playfield is 400 across, so without something
// like this "explore the wreck" means "swim in circles in a green room". The
// radar doesn't remove the fog — it tells you a thing exists and roughly where,
// and you still have to go and find it.
//
// Heading-up rather than north-up: you read it by turning until the blip is at
// the top, which needs no mental rotation and works the same on a phone.
//
// Drawn on a 2D canvas rather than in DOM. Twenty-odd blips as absolutely
// positioned divs means twenty style recalculations a frame, which is a real
// cost on mobile for something that's a handful of arcs here.

const RANGE = 150;          // world units the dish covers
const SIZE = 132;           // CSS pixels

const COLORS = {
  bongReady: '#7de08a',
  bongDark: '#3f5f57',
  baggie: '#b6e88a',
  fish: '#6fd8e0',
  chest: '#ffc061',
  log: '#9ad7ff',
  landmark: '#4b6f78',
};

// Schools and slates are background detail; bongs, baggies and the chest are
// things you act on. Size sorts them so a full dish still reads at a glance.
const SMALL = new Set(['baggie', 'log', 'fish']);

export class Radar {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sweep = 0;
    this.blips = [];

    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    this.ctx.scale(dpr, dpr);
    this.r = SIZE / 2;
  }

  /** @param {{x:number,z:number,type:string,strength?:number}[]} blips world-space */
  setBlips(blips) { this.blips = blips; }

  /**
   * @param {{x:number,z:number}} origin
   * @param {number} yaw kelpie heading; forward is (-sin yaw, -cos yaw)
   */
  draw(dt, origin, yaw) {
    const ctx = this.ctx;
    const r = this.r;
    this.sweep = (this.sweep + dt * 1.15) % (Math.PI * 2);

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.translate(r, r);

    // Dish.
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4,22,28,0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(45,92,96,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Range rings + crosshair.
    ctx.strokeStyle = 'rgba(45,92,96,0.45)';
    for (const f of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(0, 0, (r - 1) * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-r + 3, 0); ctx.lineTo(r - 3, 0);
    ctx.moveTo(0, -r + 3); ctx.lineTo(0, r - 3);
    ctx.stroke();

    // Sweep — a gradient wedge, purely so the thing looks alive.
    const g = ctx.createConicGradient
      ? ctx.createConicGradient(this.sweep - Math.PI / 2, 0, 0)
      : null;
    if (g) {
      g.addColorStop(0, 'rgba(125,224,138,0.22)');
      g.addColorStop(0.08, 'rgba(125,224,138,0.0)');
      g.addColorStop(1, 'rgba(125,224,138,0.0)');
      ctx.beginPath();
      ctx.arc(0, 0, r - 2, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    // Blips. Rotate world offsets into heading-up screen space: forward is
    // (-sin yaw, -cos yaw), so rotating by -yaw puts forward at the top.
    const cos = Math.cos(-yaw), sin = Math.sin(-yaw);
    for (const b of this.blips) {
      const dx = b.x - origin.x;
      const dz = b.z - origin.z;
      // Screen +y is down, and forward should be up, hence the negation.
      let sx = dx * cos - dz * sin;
      let sy = dx * sin + dz * cos;
      let px = (sx / RANGE) * (r - 6);
      let py = (sy / RANGE) * (r - 6);

      const dist = Math.hypot(px, py);
      const edge = r - 7;
      let clamped = false;
      if (dist > edge) {
        // Out of range: pin to the rim and dim it, so you know a direction
        // without being told a distance you haven't earned.
        px = (px / dist) * edge;
        py = (py / dist) * edge;
        clamped = true;
      }

      const col = COLORS[b.type] || '#8b90a0';
      const size = clamped ? 1.8 : (SMALL.has(b.type) ? 2.1 : 3.2);
      const alpha = clamped ? 0.38 : 1;

      ctx.globalAlpha = alpha * (b.strength ?? 1);
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();

      // A halo on things that are ready to be used.
      if (b.type === 'bongReady' && !clamped) {
        ctx.globalAlpha = 0.3 * (b.strength ?? 1);
        ctx.beginPath();
        ctx.arc(px, py, size + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = col;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // You, at the centre, pointing up.
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(3.4, 3.4); ctx.lineTo(0, 1.6); ctx.lineTo(-3.4, 3.4);
    ctx.closePath();
    ctx.fillStyle = '#e7e9ee';
    ctx.fill();

    ctx.restore();
  }
}
