/* engine/scenes.js - scene registry (the "port" for adding effects) and fragment-shader composition.

   A scene file calls FluidFX.registerScene({...}) once. Fields:
     id         integer >= 1, unique. It is the value of the `mode` parameter and the number key.
     key        stable string id. Its GLSL entry point is scene_<key, with - as _>.
     name       short label for the panel button.
     category   folder the scene lives in (documentation only), e.g. 'fluid fx'.
     waterline  true: scene has a surface (level cycle, froth, wet film). false: full-field underwater.
     mono       true: line-art output (no tone map, optional invert, ring bubbles).
     default    true on at most one scene: the one selected at start.
     fauna      {fish, jelly, manta, angler}: creature counts at Amount = 1.
     style      {rays, snow, vignette, caustic, fauna}: inputs of the shared water shader.
                fauna is one of lit | silhouette | bioluminescent | translucent.
     space      this scene's signature negative-space composition (see engine/shaders/space.js):
                off | pools | curtains | drops | lanterns. The `space` parameter can override it.
     glsl       optional custom GLSL defining `vec3 scene_<key>(vec2 p, float t, vec3 Ld)`.
                When present it replaces the shared water shader for this scene. */
(function (FX) {
'use strict';

const FAUNA_STYLES = { lit: 0, silhouette: 1, bioluminescent: 2, translucent: 3, line: 0 };
// order matches the options of the `space` parameter after 'Scene default'
const SPACE_MODES = { off: 0, pools: 1, curtains: 2, drops: 3, lanterns: 4 };
const SCENE_DEFAULTS = {
  category: 'fluid fx', waterline: true, mono: false, default: false, glsl: null, space: 'off',
  fauna: { fish: 0, jelly: 0, manta: 0, angler: 0 },
  style: { rays: 0, snow: 0, vignette: 0, caustic: 1, fauna: 'translucent' },
};
const registry = new Map();
const fnName = (scene) => 'scene_' + scene.key.replace(/[^a-zA-Z0-9]/g, '_');
const glslFloat = (v) => Number(v).toFixed(4);

function registerScene(def) {
  if (!def || !Number.isInteger(def.id) || def.id < 1) throw new Error('scene needs an integer id >= 1');
  if (typeof def.key !== 'string' || !def.key) throw new Error('scene ' + def.id + ' needs a key');
  if (registry.has(def.id)) throw new Error('duplicate scene id ' + def.id + ' (' + def.key + ')');
  const scene = {
    ...SCENE_DEFAULTS, ...def,
    fauna: { ...SCENE_DEFAULTS.fauna, ...(def.fauna || {}) },
    style: { ...SCENE_DEFAULTS.style, ...(def.style || {}) },
  };
  if (!(scene.style.fauna in FAUNA_STYLES)) throw new Error('scene ' + def.key + ': unknown fauna style ' + scene.style.fauna);
  if (!(scene.space in SPACE_MODES)) throw new Error('scene ' + def.key + ': unknown space composition ' + scene.space);
  if (scene.glsl && !scene.glsl.includes(fnName(scene) + '(')) throw new Error('scene ' + def.key + ': glsl must define ' + fnName(scene));
  scene.spaceMode = SPACE_MODES[scene.space];
  registry.set(scene.id, Object.freeze(scene));
  return scene;
}

const list = () => [...registry.values()].sort((a, b) => a.id - b.id);
const byId = (id) => registry.get(id) || list().find((s) => s.default) || list()[0];

// common + water library + one entry function per scene + a dispatcher on `uMode`
function composeFragmentShader() {
  const scenes = list();
  const functions = scenes.map((s) => s.glsl || ('vec3 ' + fnName(s) + '(vec2 p,float t,vec3 Ld){return waterScene(p,t,Ld,SceneCfg('
    + [s.style.rays, s.style.snow, s.style.vignette, s.style.caustic].map(glslFloat).join(',') + ',' + FAUNA_STYLES[s.style.fauna] + '));}'));
  const dispatch = scenes.map((s, i) => (i ? 'else ' : '') + 'if(uMode==' + s.id + ')c=' + fnName(s) + '(p,uT,Ld)*' + (s.mono ? '1.0' : 'uBright') + ';').join('\n  ');
  // The negative-space pass (shaders/space.js) is sampled 1:1 per pixel: r reveal, g rim light, b/a lens offset.
  // Where reveal is zero the scene shader is skipped for that pixel.
  return FX.glsl.common + FX.glsl.waterLib + FX.glsl.roomLib + '\nuniform sampler2D uNS;\n' + functions.join('\n') + `
void main(){
  vec4 ns=texelFetch(uNS,ivec2(gl_FragCoord.xy),0);
  vec3 c=vec3(0.0);
  if(ns.r>0.002||ns.g>0.002){
    vec2 ndc=gl_FragCoord.xy/uRes*2.0-1.0;
    vec2 p=(uS2L*vec3(ndc,1.0)).xy+(ns.ba-128.0/255.0)*0.12;
    vec3 Ld=lightDir();
    float gainB=uLineMode>0.5?1.0:uBright;
    if(p.y>1.0&&uTop>1.0001)c=ceilingScene(p,uT,Ld)*gainB;          // above the wall's top fold: the surface from below
    else if(p.y<0.0&&uBot<-0.0001){                                  // below its bottom fold: the seabed from above
      c=floorScene(p,uT,Ld)*gainB;
      if(uFauna>0.5&&uShadowAmt>0.0&&uLineMode<0.5)c*=1.0-0.75*uShadowAmt*textureLod(uShadowT,maskUV(p),0.0).r;   // creature footprints
    }
    else{
      ${dispatch}
    }
    vec3 rimc=uLineMode>0.5?vec3(1.0):mix(vec3(1.0),hsv2rgb(vec3(uHue/360.0,0.6,1.0)),0.4);
    c=c*ns.r+rimc*ns.g*uBright;
  }
  fragColor=vec4(c,1.0);
}
`;
}

FX.SPACE_MODES = SPACE_MODES;
FX.registerScene = registerScene;
FX.scenes = { register: registerScene, list, byId, composeFragmentShader };
})(window.FluidFX);
