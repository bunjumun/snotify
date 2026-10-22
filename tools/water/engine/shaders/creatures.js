/* engine/shaders/creatures.js - fauna mask pass: each creature is an instanced quad whose fragment shader
   evaluates a signed-distance shape. Output channels (MAX-blended):
     r coverage | g dome (0 at the edge, 1 deep inside) | b glow (photophores, lure, eyes) | a body opacity.
   Scenes then style the mask (lit, silhouette, bioluminescent, translucent, line art). */
(function (FX) {
'use strict';
const GLSL_COMMON = FX.glsl.common;

const GLSL_CREATURE_VS = `#version 300 es
precision highp float;
uniform mat3 uL2S;
uniform vec3 uShadow;   // xy: shadow offset on the background for a creature at the front, z: 1 = drawing shadows
uniform float uFloorSh; // 1 = drawing the floor shadow: the creature's footprint on the seabed, in the room's perspective
uniform float uA,uBot,uCeilK;
in vec4 aA;in vec4 aB;in vec2 aC;in float aD;
flat out vec4 vB;flat out vec2 vC;flat out float vS;flat out float vZ;
out vec2 vL;out vec2 vW;
const vec2 EXT[4]=vec2[4](vec2(1.55,0.85),vec2(1.45,2.2),vec2(1.35,1.15),vec2(1.55,1.45));
const vec2 OFF[4]=vec2[4](vec2(0.0,0.0),vec2(0.0,-1.1),vec2(-0.65,0.0),vec2(0.2,0.25));
void main(){
  int sp=int(aB.x+0.5);
  vec2 c=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1))*2.0-1.0;
  vec2 l=c*EXT[sp]+OFF[sp];
  float cs=cos(aA.w),sn=sin(aA.w);
  vec2 o=vec2(l.x*aB.y,l.y)*aA.z;
  vec2 r=vec2(cs*o.x-sn*o.y,sn*o.x+cs*o.y);
  vec2 w=aA.xy+r+uShadow.xy*uShadow.z*(1.0-aD);
  if(uFloorSh>0.5){
    // depth 0 (front) lies at the frame's bottom edge, depth 1 (back) at the wall/floor fold; same squeeze as floorScene()
    float n=1.0-aD;
    float Q=(1.0+uCeilK)/(n+uCeilK);
    float lift=clamp(aA.y,0.0,1.0);                       // higher creatures throw a longer, fainter footprint
    w=vec2(uA*0.5+(aA.x-uA*0.5+r.x)/Q,uBot*n+r.y*0.3/Q*(1.0+0.5*lift));
  }
  vL=l;vW=w;vB=aB;vC=aC;vS=aA.z;vZ=aD;
  gl_Position=vec4((uL2S*vec3(w,1.0)).xy,0.0,1.0);
}`;

const GLSL_CREATURE_FS = GLSL_COMMON + `
uniform vec3 uShadow;
flat in vec4 vB;flat in vec2 vC;flat in float vS;flat in float vZ;in vec2 vL;in vec2 vW;
out vec4 fragColor;
float smin(float a,float b,float k){float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0);return mix(b,a,h)-k*h*(1.0-h);}
float ell(vec2 p,vec2 r){return (length(p/r)-1.0)*min(r.x,r.y);}
float segD(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0));}

// head at +x, dorsal up; size = half length
void fishSDF(vec2 p,float ph,out float d,out float glow){
  float tw=smoothstep(0.1,-1.3,p.x);
  vec2 q=p;q.y-=sin(ph-p.x*2.5)*0.18*tw*tw;
  float body=ell(q-vec2(0.12,0.0),vec2(0.82,0.38));
  float xt=-q.x-0.5;
  float ht=0.06+0.46*clamp(xt/0.75,0.0,1.0);
  float tail=max(max(abs(q.y)-ht,max(-xt,xt-0.75))*0.8,max(xt-0.5,0.0)*1.5-abs(q.y));
  float dorsal=ell(vec2(q.x+(q.y-0.3)*0.45,q.y)-vec2(-0.02,0.36),vec2(0.27,0.15));
  float pelvic=ell(vec2(q.x+(q.y+0.3)*0.4,q.y)-vec2(0.05,-0.36),vec2(0.17,0.08));
  d=smin(smin(smin(body,tail,0.12),dorsal,0.08),pelvic,0.06);
  glow=0.0;
  for(int i=0;i<5;i++){vec2 r=p-vec2(-0.25+0.2*float(i),-0.12);glow+=exp(-dot(r,r)/0.0014)*0.8;}
  vec2 e=p-vec2(0.62,0.08);glow+=exp(-dot(e,e)/0.0012);
}

// bell up, tentacles down; size = bell radius; pulse in -1..1 (1 = contracted)
void jellySDF(vec2 p,float pulse,float ph,float seed,out float d,out float glow,out float opa){
  float rx=1.0-0.20*pulse;
  float ry=(p.y>0.0)?0.72*(1.0+0.35*pulse):0.2;
  float kk=length(vec2(p.x/rx,p.y/ry));
  float bell=(kk-1.0)*0.4;
  float tnt=1e3;
  for(int i=0;i<7;i++){
    float fi=float(i);
    float xi=(-0.85+fi*0.2833)*(1.0-0.2*pulse);
    float off=sin(p.y*3.2+ph*1.7+fi*1.9+seed*6.0)*0.10*clamp(-p.y*0.7,0.0,1.0);
    float w=0.017*(1.0-clamp(-p.y/3.0,0.0,1.0)*0.55);
    tnt=min(tnt,max(abs(p.x-xi-off)-w,max(p.y-0.02,-3.0-p.y)));
  }
  float arms=1e3;
  for(int i=0;i<3;i++){
    float fi=float(i);
    float off=sin(p.y*4.0+ph*1.3+fi*2.1)*0.12*clamp(-p.y,0.0,1.0);
    arms=min(arms,max(abs(p.x-(fi-1.0)*0.28-off)-0.05*(1.0-clamp(-p.y/1.6,0.0,1.0)*0.6),max(p.y,-1.7-p.y)));
  }
  float rest=min(tnt,arms);
  d=min(bell,rest);
  opa=mix(0.4,0.55,step(bell,rest));
  float up=step(-0.1,p.y);
  glow=(exp(-pow((kk-0.93)*8.0,2.0))*0.9+(1.0-smoothstep(0.0,0.9,kk))*0.22
       +pow(0.5+0.5*cos(atan(p.x,max(p.y,0.0))*7.0),6.0)*(1.0-min(kk,1.0))*0.55)*up*step(kk,1.15);
}

// seen from below: wings spread along y, flap travels outward, head at +x, long tail
void mantaSDF(vec2 p,float ph,out float d,out float glow){
  float ay=abs(p.y);
  float x=p.x+0.30*sin(ph-ay*2.6)*ay;
  float le=0.38-0.62*pow(ay,1.15);
  float te=-0.12-0.40*ay-0.15*ay*ay;
  float wing=max(max(x-le,te-x)*0.7,ay-1.0);
  float lobe=ell(vec2(x-0.5,ay-0.14),vec2(0.17,0.08));
  float tt=clamp((-x-0.15)/1.7,0.0,1.0);
  float tail=max(ay-(0.03*(1.0-tt)+0.004),max(-(x+0.15),x+1.85));
  d=smin(smin(wing,lobe,0.05),tail,0.03);
  glow=0.0;
}

// round body, opening jaw, glowing lure on a stalk
void anglerSDF(vec2 p,float open,float ph,out float d,out float glow){
  float body=ell(p,vec2(0.82,0.62));
  float gap=0.2*open*smoothstep(0.15,0.85,p.x);
  body=max(body,-max(abs(p.y+0.12)-gap,0.28-p.x));
  body=smin(body,ell(p-vec2(0.5,-0.36),vec2(0.34,0.14)),0.05);
  float xt=-p.x-0.6;
  float tail=max(abs(p.y+sin(ph-p.x*2.0)*0.09*clamp(xt,0.0,1.0))-(0.07+0.42*clamp(xt/0.55,0.0,1.0)),max(-xt,xt-0.6))*0.8;
  d=smin(body,tail,0.1);
  vec2 prev=vec2(0.25,0.5);float stalk=1e3;
  for(int i=1;i<=6;i++){
    float s=float(i)/6.0;
    vec2 cur=vec2(0.25+0.6*s,0.5+0.8*sin(s*1.9)+0.05*sin(ph*2.0+s*5.0));
    stalk=min(stalk,segD(p,prev,cur));prev=cur;
  }
  float bulb=length(p-prev);
  d=min(d,min(stalk-0.018,bulb-0.1));
  vec2 eye=p-vec2(0.55,0.2);
  glow=exp(-bulb*bulb/0.045)*(0.85+0.15*sin(uT*3.0+ph))+exp(-dot(eye,eye)/0.002)*0.6;
  for(int i=0;i<5;i++){
    float xx=0.4+0.1*float(i);
    vec2 r=p-vec2(xx,-0.12+0.2*open*smoothstep(0.15,0.85,xx)*0.9);
    glow+=exp(-dot(r,r)/0.0006)*0.7;
  }
}

void main(){
  if(uHasSurface>0.5&&vW.y>surfaceY(vW.x))discard;
  float sp=vB.x,al=vB.w,ph=vB.z;
  float d=1.0,glow=0.0,opa=1.0;
  if(sp<0.5)fishSDF(vL,ph,d,glow);
  else if(sp<1.5)jellySDF(vL,vC.x,ph,vC.y,d,glow,opa);
  else if(sp<2.5)mantaSDF(vL,ph,d,glow);
  else anglerSDF(vL,vC.x,ph,d,glow);
  float px=uPx/vS;
  float cov=1.0-smoothstep(-px,px,d);
  float dome=sqrt(max(1.0-pow(1.0-clamp(-d/0.28,0.0,1.0),2.0),0.0));
  if(uShadow.z>0.5){fragColor=vec4(cov*al*(1.0-vZ),0.0,0.0,0.0);return;}   // shadow pass: fades toward the back
  // blocking fades with depth too: a creature far back stops hiding the light behind it
  fragColor=vec4(cov*al,dome*cov*al,min(glow,1.5)*al,opa*al*clamp(cov*4.0,0.0,1.0)*(1.0-0.8*vZ));
}`;

FX.glsl = Object.assign(FX.glsl || {}, { creatureVS: GLSL_CREATURE_VS, creatureFS: GLSL_CREATURE_FS });
})(window.FluidFX);
