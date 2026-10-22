/* engine/params.js - parameter schema, validation, defaults */
(function (FX) {
'use strict';
const { clamp } = FX;

// Builds the parameter table. The scene list decides the range of `mode`.
FX.buildParams = function buildParams(modeMax, modeDefault) {
  /* ============================== STATE / SCHEMA ============================== */
  // group, key, type, default, min, max, step, label, [options]
  const SCHEMA = [
    ['Scene', 'mode', 'int', modeDefault, 1, modeMax, 1, 'Mode'],
    ['Scene', 'base', 'enum', 0, 0, 5, 1, 'Base layer', ['Black', 'White wash', 'Grid', 'Stripes', 'Rings', 'Checker']],
    ['Scene', 'hue', 'num', 190, 0, 360, 1, 'Hue'],
    ['Scene', 'speed', 'num', 1, 0.1, 3, 0.05, 'Speed'],
    ['Scene', 'scale', 'num', 1, 0.4, 2.5, 0.05, 'Scale'],
    ['Scene', 'brightness', 'num', 1, 0, 2, 0.05, 'Brightness'],
    ['Scene', 'contrast', 'num', 1.8, 0.5, 2.5, 0.05, 'Contrast'],
    ['Scene', 'wash', 'num', 0.1, 0, 1, 0.02, 'Water tint'],
    ['Negative space', 'space', 'enum', 0, 0, 5, 1, 'Composition', ['Scene default', 'Off', 'Pools', 'Curtains', 'Drops', 'Lanterns']],
    ['Negative space', 'spaceAmt', 'num', 0.5, 0, 1, 0.02, 'Darkness'],
    ['Negative space', 'spaceSoft', 'num', 0.4, 0, 1, 0.02, 'Edge softness'],
    ['Negative space', 'spaceDrift', 'num', 1, 0, 3, 0.05, 'Drift speed'],
    ['Negative space', 'blackPoint', 'num', 0.18, 0, 0.5, 0.01, 'Black point'],
    ['Negative space', 'edgeFade', 'num', 0.3, 0, 1, 0.02, 'Frame fade'],
    // Room: where the wall sits in the frame. Both are fractions of the frame height up from the bottom; the wall always keeps >= 0.25.
    ['Room', 'horizon', 'num', 1, 0.3, 1, 0.005, 'Horizon (wall top)'],          // 1 = no ceiling; below 1 the rest is the surface seen from below
    ['Room', 'floorLevel', 'num', 0, 0, 0.5, 0.005, 'Floor level (wall bottom)'], // 0 = no floor; above 0 the strip under it is the seabed seen from above
    ['Room', 'lookUp', 'num', 0.6, 0, 1, 0.02, 'Perspective'],
    ['Room', 'snell', 'num', 0.7, 0, 1, 0.02, "Snell's window"],
    ['Look', 'distortion', 'num', 1, 0, 2.5, 0.05, 'Distortion'],
    ['Look', 'dispersion', 'num', 0.6, 0, 2, 0.05, 'Dispersion'],
    ['Look', 'wetness', 'num', 0.8, 0, 1, 0.02, 'Wetness'],
    ['Look', 'gloss', 'num', 0.7, 0, 1, 0.02, 'Gloss'],
    ['Look', 'sparkle', 'num', 0.6, 0, 1, 0.02, 'Sparkle'],
    ['Look', 'lightAngle', 'num', 35, 0, 360, 1, 'Light angle'],
    ['Look', 'bloom', 'num', 0.35, 0, 1, 0.02, 'Bloom'],
    ['Bubbles & foam', 'bubbles', 'num', 0.6, 0, 1, 0.02, 'Bubbles'],
    ['Bubbles & foam', 'bubbleSize', 'num', 1.3, 0.3, 3, 0.05, 'Bubble size'],
    ['Bubbles & foam', 'foam', 'num', 0.8, 0, 1, 0.02, 'Foam'],
    ['Bubbles & foam', 'foamLife', 'num', 5, 0.5, 15, 0.5, 'Foam half-life s'],
    ['Bubbles & foam', 'tank', 'num', 1.5, 0.3, 5, 0.1, 'Tank height m'],
    ['Fauna', 'fauna', 'num', 0.6, 0, 1, 0.02, 'Amount'],
    ['Fauna', 'faunaSize', 'num', 1, 0.5, 2, 0.05, 'Size'],
    ['Fauna', 'faunaSpeed', 'num', 1, 0.3, 2, 0.05, 'Speed'],
    ['Fauna', 'faunaDepth', 'num', 0.7, 0, 1, 0.02, 'Depth'],            // how far back creatures roam; far ones block and shade less
    ['Fauna', 'shadow', 'num', 0.8, 0, 1, 0.02, 'Shadow'],
    ['Avoidance', 'avoid', 'num', 0.8, 0, 1, 0.02, 'Creature avoidance'],      // 0 = creatures ignore detected objects
    ['Avoidance', 'avoidMargin', 'num', 0.06, 0, 0.3, 0.005, 'Clearance'],
    ['Avoidance', 'avoidBubbles', 'num', 0.6, 0, 1, 0.02, 'Bubble avoidance'],
    ['Avoidance', 'avoidHold', 'num', 1.5, 0, 10, 0.1, 'Hold s'],              // keep an object this long after detection drops out
    ['Avoidance', 'avoidSmooth', 'num', 0.6, 0, 0.95, 0.01, 'Smoothing'],
    ['Avoidance', 'avoidShow', 'bool', false, 0, 1, 1, 'Show boxes'],
    ['Avoidance', 'keepOut', 'num', 0, 0, 1, 0.02, 'Keep-out dark'],           // 0 = off; 1 = detected objects get no light at all
    ['Avoidance', 'keepOutSoft', 'num', 0.04, 0, 0.2, 0.005, 'Keep-out edge'],  // feather (fraction of frame height)
    ['Fauna', 'faunaGlow', 'num', 1, 0, 1.5, 0.05, 'Rim / glow'],
    ['Fauna', 'fish', 'num', 1, 0, 1.5, 0.05, 'Fish'],
    ['Fauna', 'jellies', 'num', 1, 0, 1.5, 0.05, 'Jellyfish'],
    ['Fauna', 'manta', 'num', 1, 0, 1.5, 0.05, 'Rays'],
    ['Fauna', 'angler', 'num', 1, 0, 1.5, 0.05, 'Anglerfish'],
    ['Level', 'auto', 'bool', true, 0, 1, 1, 'Auto cycle'],
    ['Level', 'level', 'num', 0.5, 0, 1, 0.005, 'Level'],
    ['Level', 'rise', 'num', 25, 2, 120, 1, 'Rise s'],
    ['Level', 'hold', 'num', 8, 0, 120, 1, 'Hold s'],
    ['Level', 'drain', 'num', 15, 2, 120, 1, 'Drain s'],
    ['Line art', 'lineStyle', 'enum', 0, 0, 2, 1, 'Style (L)', ['Contours', 'Ridgelines', 'Engraving']],
    ['Line art', 'lineCount', 'int', 36, 8, 120, 1, 'Line count'],
    ['Line art', 'lineThick', 'num', 1.4, 0.5, 5, 0.1, 'Thickness px'],
    ['Line art', 'lineAmp', 'num', 1, 0.2, 3, 0.05, 'Wave amp'],
    ['Line art', 'lineIndex', 'num', 0.6, 0, 1, 0.05, 'Index lines'],
    ['Line art', 'lineTone', 'num', 0, 0, 1, 0.05, 'Tone'],
    ['Line art', 'lineBloom', 'num', 0, 0, 1, 0.05, 'Bloom'],
    ['Line art', 'lineInvert', 'bool', false, 0, 1, 1, 'Invert'],
    ['Output', 'rotation', 'enum', 0, 0, 3, 1, 'Rotate', ['0°', '90°', '180°', '270°']],
    ['Output', 'flipH', 'bool', false, 0, 1, 1, 'Flip H'],
    ['Output', 'flipV', 'bool', false, 0, 1, 1, 'Flip V'],
    ['Output', 'res', 'num', 1, 0.25, 1, 0.05, 'Resolution'],
  ];
  const SPECS = SCHEMA.map(([group, k, type, def, min, max, step, label, opts]) => ({ group, k, type, def, min, max, step, label, opts }));
  const SPEC_BY_KEY = Object.fromEntries(SPECS.map((s) => [s.k, s]));
  const DEFAULTS = Object.freeze(Object.fromEntries(SPECS.map((s) => [s.k, s.def])));

  // Validate at the boundary (URL, storage, postMessage, UI): unknown keys dropped, values clamped.
  function normalize(partial, base) {
    const next = { ...base };
    if (partial && typeof partial === 'object') {
      for (const [k, raw] of Object.entries(partial)) {
        const s = SPEC_BY_KEY[k];
        if (!s) continue;
        if (s.type === 'bool') { next[k] = raw === true || raw === 'true' || raw === 1 || raw === '1'; continue; }
        const x = Number(raw);
        if (!Number.isFinite(x)) continue;
        const c = clamp(x, s.min, s.max);
        next[k] = s.type === 'num' ? c : Math.round(c);
      }
    }
    return Object.freeze(next);
  }
  return { SCHEMA, SPECS, SPEC_BY_KEY, DEFAULTS, normalize };
};
})(window.FluidFX);
