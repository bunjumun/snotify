/* engine/shaders/space.js - negative-space pass: decides where the projector emits no light.
   A projector can only add light, so the dark is the composition. This pass runs once per frame and
   every other pass reads its result:
     r  reveal   0 = true black, 1 = scene shows through (scene shader and bubbles multiply by it)
     g  rim      thin meniscus light along the edge of a drop (added after the scene, so it also blooms)
     b,a lens    sample offset for the scene behind a drop edge, 0.5 = none
   Compositions (uNsMode): 1 pools, 2 curtains, 3 drops, 4 lanterns. uNsAmt is the share of the frame left dark. */
(function (FX) {
'use strict';

const GLSL_SPACE_FS = FX.glsl.common + `
uniform vec2 uRes;uniform mat3 uS2L;
uniform int uNsMode,uNLamp;
uniform float uNsT,uNsAmt,uNsSoft,uEdge,uLightAng,uFauna;
uniform vec4 uLamp[${FX.MAX_CREATURES}];   // one lamp per creature: x, y, radius, strength
out vec4 fragColor;

const float ISO=0.3,KERNEL_R=0.575;     // Wyvill kernel: a lone drop's edge sits at 0.575 of its support radius at ISO
const float NS_MID=128.0/255.0,NS_LENS=0.12;

// lit fraction -> threshold on a roughly bell-shaped noise field (logistic probit)
float thrFor(float lit,float mu,float sg){lit=clamp(lit,0.004,0.996);return mu-sg*log(lit/(1.0-lit))/1.702;}

// drifting islands of light; the wave gradient g makes their edges ripple with the water
mat2 rot2(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float poolsField(vec2 p,vec2 g){
  vec2 q=p*2.3+g*1.2;
  // value noise hugs its axis-aligned lattice when thresholded: warp the domain and turn each octave so no edge runs straight
  q+=0.30*(vec2(vnoise(q*0.8+vec2(3.1,uNsT*0.020)),vnoise(q*0.8+vec2(11.7,-uNsT*0.017)))-0.5);
  float a=vnoise(rot2(0.55)*q+vec2(uNsT*0.060,-uNsT*0.035));
  float b=vnoise(rot2(1.9)*q*2.1+vec2(7.7-uNsT*0.050,uNsT*0.040));
  return a*0.65+b*0.35;
}

// shafts fanning down from an apex above the frame, wider with depth, brighter near the top
float curtainField(vec2 p,vec2 g){
  float ax=uA*(0.5+0.30*sin(uNsT*0.037));
  float apex=uTop+0.9;                              // above the frame, whatever its height
  float u=(p.x-ax)/(apex-p.y)*apex+g.x*0.9+0.012*sin(9.0*p.y+uNsT*0.5);
  float a=vnoise(vec2(u*5.5,uNsT*0.11));
  float b=vnoise(vec2(u*13.0+5.0,uNsT*0.19));
  return a*0.62+b*0.38+0.10*((p.y-uBot)/(uTop-uBot)-0.5);
}

// five metaballs on slow Lissajous paths: they merge and pinch apart like drops of water
float dropField(vec2 p,float R,out vec2 gr){
  float f=0.0;gr=vec2(0.0);
  for(int i=0;i<5;i++){
    float fi=float(i);
    vec2 c=vec2(uA*(0.5+0.34*sin(uNsT*(0.052+0.011*fi)+fi*2.4)),uBot+(uTop-uBot)*(0.5+0.34*sin(uNsT*(0.041+0.013*fi)+fi*1.7+1.0)));
    float s=(0.62+0.38*hash11(fi*7.3+1.0))*(1.0+0.10*sin(uNsT*0.33+fi*3.1));
    float Ri=R*s/KERNEL_R;
    vec2 d=p-c;float q=dot(d,d)/(Ri*Ri);
    if(q>=1.0)continue;
    float w=1.0-q;
    f+=w*w*w;
    gr+=-6.0*w*w*d/(Ri*Ri);
  }
  return f;
}

// every creature carries its own light; neighbouring lamps merge like the drops do
float lampField(vec2 p){
  float f=0.0;
  for(int i=0;i<${FX.MAX_CREATURES};i++){
    if(i>=uNLamp)break;
    vec4 L=uLamp[i];
    vec2 d=p-L.xy;float q=dot(d,d)/(L.z*L.z);
    if(q<1.0){float w=1.0-q;f+=L.w*w*w*w;}
  }
  return f;
}

void main(){
  vec2 ndc=gl_FragCoord.xy/uRes*2.0-1.0;
  vec2 p=(uS2L*vec3(ndc,1.0)).xy;
  float lit=1.0-0.88*uNsAmt;
  float soft=mix(0.012,0.10,uNsSoft);
  float br=1.0+0.06*sin(uNsT*0.21);        // the dark breathes
  float m=1.0,rim=0.0;vec2 lens=vec2(0.0);
  int mode=uNsMode;
  if(mode==4&&uFauna<0.5)mode=1;           // lanterns need creatures; pools until some swim in
  if(mode>0&&lit<0.995){
    vec2 g;fieldH(p,uT,g);                 // waves and pop ripples nudge every edge
    if(mode==1){
      float t=thrFor(lit*br,0.5,0.11);
      m=smoothstep(t-soft,t+soft,poolsField(p,g));
    }else if(mode==2){
      float t=thrFor(lit*br,0.5,0.16);
      m=smoothstep(t-soft,t+soft,curtainField(p,g));
    }else if(mode==3){
      float R=0.75*sqrt(lit*br*uA*(uTop-uBot)/(3.14159*2.2));   // 0.75: smaller than the area maths says, so drops stay separate and only meet now and then
      vec2 pw=p+g*0.12+0.010*(vec2(vnoise(p*6.0+uNsT*0.30),vnoise(p*6.0+9.0-uNsT*0.25))-0.5);
      vec2 gr;float f=dropField(pw,R,gr);
      float gl=max(length(gr),1e-3);
      float dist=(f-ISO)/gl;               // signed distance to the edge, positive inside
      float w=mix(uPx*1.2,0.05,uNsSoft);
      m=smoothstep(-w,w,dist);
      vec2 nO=-gr/gl;
      float la=radians(uLightAng)+0.4*sin(uT*0.07);
      float face=0.45+0.55*pow(abs(dot(nO,vec2(cos(la),sin(la)))),1.5);
      rim=(1.0-smoothstep(0.0,uPx*2.2,abs(dist)))*face;
      lens=nO*0.035*exp(-max(dist,0.0)/0.05)*step(0.0,dist);
    }else{
      float f=lampField(p+g*0.15);
      float thr=0.25+0.05*(vnoise(p*7.0+vec2(uNsT*0.2,0.0))-0.5);   // ragged edge, like light scattering in murk
      float amb=smoothstep(0.74,1.0,lit);              // low Darkness lets the water fade back in around the lanterns
      m=max(smoothstep(thr*0.6,thr+0.04+0.5*soft,f),amb);
    }
  }
  float ef=min(min(p.x,uA-p.x),min(p.y-uBot,uTop-p.y));
  float edge=uEdge>0.0?smoothstep(0.0,0.02+0.22*uEdge,ef):1.0;
  fragColor=vec4(m*edge,rim*edge,clamp(lens/NS_LENS+NS_MID,0.0,1.0));
}`;

FX.glsl = Object.assign(FX.glsl || {}, { spaceFS: GLSL_SPACE_FS });
})(window.FluidFX);
