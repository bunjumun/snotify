/* engine/shaders/common.js - GLSL shared by every program: hashes, wave field, ripple rings, surface */
(function (FX) {
'use strict';
const { MAX_RINGS, WAVES, WAVE_ROT, WAVE_OMEGA } = FX;

const GLSL_COMMON = `#version 300 es
precision highp float;
precision highp int;
uniform float uT,uScale,uSurf,uA,uPx,uHasSurface;
uniform float uTop,uBot,uCeilK;   // logical frame spans uBot (<= 0, floor) .. uTop (>= 1, ceiling); uCeilK sets the look-up perspective
uniform vec4 uRing[${MAX_RINGS}];
const float TAU=6.28318530718;
const vec4 WV[${WAVES.length}]=vec4[${WAVES.length}](${WAVES.map((w) => 'vec4(' + w.map((v) => v.toFixed(4)).join(',') + ')').join(',')});
float hash11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
float hash21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec2 hash22(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.xx+q.yz)*q.zy);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float waveH(vec2 p,float t,out vec2 g){
  float h=0.0;g=vec2(0.0);
  for(int i=0;i<${WAVES.length};i++){
    vec4 w=WV[i];
    float ang=w.x+${WAVE_ROT.toFixed(3)}*sin(t*0.05+float(i));
    vec2 d=vec2(cos(ang),sin(ang));
    float k=w.y/uScale;
    float ph=k*dot(d,p)-${WAVE_OMEGA.toFixed(3)}*sqrt(k)*t+w.w;
    h+=w.z*sin(ph);g+=w.z*k*cos(ph)*d;
  }
  return h;
}
float ringH(vec2 p,float t,out vec2 g){
  float h=0.0;g=vec2(0.0);
  for(int i=0;i<${MAX_RINGS};i++){
    vec4 r=uRing[i];
    if(r.w<=0.0)continue;
    float age=t-r.z;
    if(age<0.0||age>6.0)continue;
    vec2 d=p-r.xy;float rad=length(d)+1e-4;
    float x=rad-0.20*age;
    float env=exp(-x*x*220.0);
    float dec=exp(-age*0.8)/(1.0+rad*8.0);
    float s=sin(95.0*x),c=cos(95.0*x);
    h+=r.w*dec*env*s;
    g+=r.w*dec*env*(95.0*c-440.0*x*s)*d/rad;
  }
  return h;
}
float fieldH(vec2 p,float t,out vec2 g){vec2 g2;float h=waveH(p,t,g);h+=ringH(p,t,g2);g+=g2;return h;}
float surfaceY(float x){vec2 g;return uSurf+fieldH(vec2(x,clamp(uSurf,0.0,1.0)),uT,g);}
// Ceiling and floor are the same plane seen from the wall's fold: d is the distance past the fold, len the extent of that
// zone. n runs 0 (fold, far away) .. 1 (frame edge, close); Q is how squeezed the plane looks there. Returns plane coords
// (x, z) with z measured from the fold; with a large uCeilK there is no squeeze and it is the plain frame.
vec2 foldPlane(float x,float d,float len,out float n,out float Q){
  len=max(len,1e-3);
  n=clamp(d/len,0.0,1.0);
  Q=(1.0+uCeilK)/(n+uCeilK);
  return vec2(uA*0.5+(x-uA*0.5)*Q,len*(1.0+uCeilK)*log((n+uCeilK)/uCeilK));
}
`;
FX.glsl = Object.assign(FX.glsl || {}, { common: GLSL_COMMON });
})(window.FluidFX);
