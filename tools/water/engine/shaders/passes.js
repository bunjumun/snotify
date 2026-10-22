/* engine/shaders/passes.js - full-screen, bubble, bloom and composite programs */
(function (FX) {
'use strict';
const GLSL_COMMON = FX.glsl.common;

const GLSL_FULLSCREEN_VS = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;

const GLSL_BUBBLE_VS = `#version 300 es
precision highp float;
uniform mat3 uL2S;
in vec4 aA;in vec2 aB;
out vec2 vE;out vec2 vW;out float vR;out float vTilt;
void main(){
  vec2 c=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1))*2.0-1.0;
  float R=aA.z,asp=aA.w;
  vec2 e=c*1.25;
  vec2 local=vec2(e.x*R*pow(asp,-1.0/3.0),e.y*R*pow(asp,2.0/3.0));
  float ct=cos(aB.x),st=sin(aB.x);
  vec2 w=aA.xy+vec2(ct*local.x-st*local.y,st*local.x+ct*local.y);
  vE=e;vW=w;vR=R;vTilt=aB.x;
  gl_Position=vec4((uL2S*vec3(w,1.0)).xy,0.0,1.0);
}`;

const GLSL_BUBBLE_FS = GLSL_COMMON + `
uniform vec3 uTint;uniform float uLightAng,uLineMode,uWet,uBright,uLineThick;
uniform sampler2D uNS;   // negative space: bubbles do not glow in the dark
in vec2 vE;in vec2 vW;in float vR;in float vTilt;
out vec4 fragColor;
void main(){
  if(uHasSurface>0.5&&vW.y>surfaceY(vW.x))discard;
  float nsm=texelFetch(uNS,ivec2(gl_FragCoord.xy),0).r;
  if(nsm<0.002)discard;
  float rr=length(vE);
  float px=uPx/vR;
  float la=radians(uLightAng)+0.4*sin(uT*0.07);
  vec2 Ls=vec2(cos(la),sin(la));
  float ct=cos(-vTilt),st=sin(-vTilt);
  vec2 Ll=vec2(ct*Ls.x-st*Ls.y,st*Ls.x+ct*Ls.y);
  vec2 dir=rr>1e-3?vE/rr:vec2(0.0);
  if(uLineMode>0.5){
    float m=1.0-smoothstep((uLineThick*0.5-0.5)*px,(uLineThick*0.5+0.5)*px,abs(rr-1.0));
    float tick=smoothstep(0.93,0.99,dot(dir,Ll))*(1.0-smoothstep(0.0,2.0*px,abs(rr-0.78)))*step(rr,0.9);
    fragColor=vec4(vec3(max(m,tick))*nsm,1.0);return;
  }
  float inside=1.0-smoothstep(1.0-px,1.0+px,rr);
  float fres=pow(1.0-sqrt(max(1.0-rr*rr,0.0)),3.0);
  float rim=fres*(0.35+0.65*pow(abs(dot(dir,Ll)),1.5))*1.4;
  float edge=(1.0-smoothstep(0.0,2.0*px,abs(rr-0.98)))*0.5;
  float s1=smoothstep(0.16,0.0,length(vE-Ll*0.52))*1.8;
  float s2=smoothstep(0.10,0.0,length(vE+Ll*0.55))*0.7;
  float atten=uHasSurface>0.5?0.55+0.45*exp(-(surfaceY(vW.x)-vW.y)*1.2):1.0;
  vec3 lc=mix(vec3(1.0),uTint,0.4);
  vec3 c=(lc*(rim+edge+0.035)+vec3(1.0)*(s1+s2)*uWet)*inside*atten*uBright*nsm;
  fragColor=vec4(c,1.0);
}`;

const GLSL_BRIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;uniform vec2 uTexel;uniform float uThresh;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy*uTexel;
  vec3 c=(texture(uTex,uv+uTexel*vec2(-1.0,-1.0)).rgb+texture(uTex,uv+uTexel*vec2(1.0,-1.0)).rgb
         +texture(uTex,uv+uTexel*vec2(-1.0,1.0)).rgb+texture(uTex,uv+uTexel*vec2(1.0,1.0)).rgb)*0.25;
  float l=max(c.r,max(c.g,c.b));
  o=vec4(c*max(l-uThresh,0.0)/max(l,1e-4),1.0);
}`;

const GLSL_BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;uniform vec2 uDir;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy/vec2(textureSize(uTex,0));
  vec2 s=uDir/vec2(textureSize(uTex,0))*1.5;
  vec3 c=texture(uTex,uv).rgb*0.227027;
  c+=(texture(uTex,uv+s).rgb+texture(uTex,uv-s).rgb)*0.1945946;
  c+=(texture(uTex,uv+s*2.0).rgb+texture(uTex,uv-s*2.0).rgb)*0.1216216;
  c+=(texture(uTex,uv+s*3.0).rgb+texture(uTex,uv-s*3.0).rgb)*0.054054;
  c+=(texture(uTex,uv+s*4.0).rgb+texture(uTex,uv-s*4.0).rgb)*0.016216;
  o=vec4(c,1.0);
}`;

const GLSL_COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene,uBloom;uniform vec2 uRes;uniform float uBloomAmt,uLine,uInvert,uT,uBlack,uKeep,uKeepSoft;
uniform int uNBox;uniform vec4 uBox[32];   // detected objects, screen 0..1 from the top-left: x0,y0,x1,y1
out vec4 o;
float keepOut(vec2 uv){   // 1 = lit, 0 = inside a detected object (feathered rounded box)
  float m=1.0;vec2 s=vec2(uv.x*uRes.x,(1.0-uv.y)*uRes.y);float f=max(uKeepSoft*uRes.y,1.0);
  for(int i=0;i<32;i++){if(i>=uNBox)break;
    vec4 b=uBox[i]*vec4(uRes,uRes);vec2 c=(b.xy+b.zw)*0.5,h=(b.zw-b.xy)*0.5;
    vec2 d=abs(s-c)-h;float sd=length(max(d,0.0))+min(max(d.x,d.y),0.0);
    m=min(m,smoothstep(0.0,f,sd));}
  return mix(1.0,m,uKeep);
}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec3 c=texture(uScene,uv).rgb+texture(uBloom,uv).rgb*uBloomAmt;
  if(uKeep>0.0)c*=keepOut(uv);
  if(uLine>0.5){c=clamp(c,0.0,1.0);if(uInvert>0.5)c=1.0-c;o=vec4(c,1.0);return;}
  c=aces(c);
  c=max(c-uBlack,0.0)/(1.0-uBlack);                  // stage black: the dim wash becomes unlit, not dark grey
  float lum=max(c.r,max(c.g,c.b));
  c+=(h21(gl_FragCoord.xy+fract(uT)*61.7)-0.5)/255.0*smoothstep(0.0,0.02,lum);   // dither the light, never the black
  o=vec4(c,1.0);
}`;
FX.glsl = Object.assign(FX.glsl || {}, { fullscreenVS: GLSL_FULLSCREEN_VS, bubbleVS: GLSL_BUBBLE_VS, bubbleFS: GLSL_BUBBLE_FS, brightFS: GLSL_BRIGHT_FS, blurFS: GLSL_BLUR_FS, compositeFS: GLSL_COMPOSITE_FS });
})(window.FluidFX);
