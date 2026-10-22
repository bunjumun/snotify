/* engine/shaders/water.js - shared water-scene GLSL library (scenes pick from it) */
(function (FX) {
'use strict';
const { FOAM_N, WET_N } = FX;

const WATER_LIB = `
uniform vec2 uRes;uniform mat3 uS2L;
uniform int uMode,uBase,uLineStyle;
uniform float uLineMode,uFauna,uFaunaGlow;
uniform float uBright,uContrast,uHue,uDistort,uDisp,uWet,uGloss,uSpark,uLightAng,uWash;
uniform float uLineCount,uLineThick,uLineAmp,uLineIndex,uLineTone,uFoamCell;
uniform sampler2D uFoam,uWetTex,uMask,uShadowT;uniform float uShadowAmt;
uniform mat3 uL2S;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0);return c.z*mix(vec3(1.0),clamp(p-1.0,0.0,1.0),c.y);}
vec3 lightDir(){float a=radians(uLightAng)+0.4*sin(uT*0.07);return normalize(vec3(cos(a)*0.62,sin(a)*0.62,0.8));}
vec2 flowDisp(vec2 p,float t){
  return vec2(0.010*sin(7.0*p.y+0.6*t)+0.006*sin(13.0*p.y-0.9*t+1.7*p.x),
              0.008*sin(6.0*p.x+0.5*t+2.0)+0.005*sin(11.0*p.x+0.8*t));
}
vec2 foamAt(float x){
  float u=clamp(x/uA,0.0,1.0)*float(${FOAM_N}-1);
  int i0=int(floor(u));int i1=min(i0+1,${FOAM_N}-1);
  return mix(texelFetch(uFoam,ivec2(i0,0),0).rg,texelFetch(uFoam,ivec2(i1,0),0).rg,fract(u));
}
vec2 wetAt(float y){
  float u=clamp(y,0.0,1.0)*float(${WET_N}-1);
  int i0=int(floor(u));int i1=min(i0+1,${WET_N}-1);
  return mix(texelFetch(uWetTex,ivec2(i0,0),0).rg,texelFetch(uWetTex,ivec2(i1,0),0).rg,fract(u));
}

vec2 maskUV(vec2 pl){return (uL2S*vec3(pl,1.0)).xy*0.5+0.5;}   // creature mask lookup (logical -> screen uv)

// iterated domain-warped sine caustic network
float caustic(vec2 p,float t){
  vec2 q=p*TAU*1.15/uScale-250.0;
  vec2 i=q;float c=1.0;const float inten=0.005;
  for(int n=0;n<5;n++){
    float tt=t*(1.0-(3.5/float(n+1)));
    i=q+vec2(cos(tt-i.x)+sin(tt+i.y),sin(tt-i.y)+cos(tt+i.x));
    c+=1.0/length(vec2(q.x/(sin(i.x+tt)/inten),q.y/(cos(i.y+tt)/inten)));
  }
  c/=5.0;c=abs(1.17-pow(c,1.4));
  return pow(c,6.0+2.0*uContrast)+0.10*pow(c,2.5);   // sharp ridge + soft body
}

float basePattern(vec2 q){
  if(uBase==0)return 0.0;
  if(uBase==1)return 0.38;
  float aa=uPx*1.2;
  if(uBase==2){vec2 c=abs(fract(q/0.1+0.5)-0.5)*0.1;return 0.9*(1.0-smoothstep(aa*0.6,aa*1.6,min(c.x,c.y)));}
  if(uBase==3){float s=q.x*0.8+q.y*0.6;float w=aa/0.06;float c=abs(fract(s/0.06)-0.5)*2.0;return 0.85*(1.0-smoothstep(0.5-w,0.5+w,c));}
  if(uBase==4){float r=length(q-vec2(uA*0.5,0.5));float w=aa/0.06;float c=abs(fract(r/0.06)-0.5)*2.0;return 0.85*(1.0-smoothstep(0.5-w,0.5+w,c));}
  vec2 s=floor(q/0.1);return 0.8*mod(s.x+s.y,2.0);
}
vec3 basePatternRGB(vec2 q,vec2 dv){return vec3(basePattern(q+dv),basePattern(q),basePattern(q-dv));}

float rays(vec2 p,float t,float vd){
  float u=p.x+(1.0-p.y)*0.32+0.05*sin(t*0.11+p.y*2.0);
  float s=vnoise(vec2(u*8.0,t*0.17))*0.62+vnoise(vec2(u*19.0+5.0,t*0.26))*0.38;
  return smoothstep(0.42,0.92,s)*exp(-vd*1.6);
}
float snow(vec2 p,float t){
  float a=0.0;
  for(int l=0;l<3;l++){
    float fl=float(l);
    vec2 q=p*(14.0+fl*16.0)+vec2(sin(t*0.07+fl*2.0)*2.0,t*(0.35+fl*0.25));
    vec2 id=floor(q),f=fract(q)-0.5;
    vec2 h=hash22(id+fl*37.0);
    float d=length(f-(h-0.5)*0.6);
    float r=0.04+0.07*hash21(id+9.0);
    a+=smoothstep(r,0.0,d)*(0.6+0.4*sin(t*(1.0+h.x*3.0)+h.y*TAU))*step(0.55,hash21(id+3.0))*(1.0-fl*0.2);
  }
  return a;
}

// beading droplets, glossy rivulets and a thin sheen on the wet wall above the waterline
vec3 wetFilm(vec2 p,float t,float w,float cl,vec3 tint,vec3 Ld){
  vec3 acc=tint*0.03*w;
  vec3 Lc=mix(vec3(1.0),tint,0.3);
  vec3 Hh=normalize(normalize(vec3(Ld.xy,0.8))+vec3(0.0,0.0,1.0));
  const float cs=0.03;
  vec2 q=p/cs;vec2 id=floor(q);vec2 f=fract(q);
  float prob=clamp(w*0.5+cl*0.45,0.0,1.0);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 o=vec2(float(i),float(j));vec2 cid=id+o;
    if(hash21(cid)>prob)continue;
    vec2 c=o+0.5+(hash22(cid+17.0)-0.5)*0.6-f;
    float R=(0.10+0.20*hash21(cid+5.0))*(1.0+0.8*cl);
    float d=length(c);
    if(d>R*1.15)continue;
    vec2 nd=-c/R;float nz=sqrt(1.0-min(dot(nd,nd),1.0));
    vec3 n=vec3(nd,nz);
    float spot=pow(max(dot(n,Hh),0.0),70.0)*1.5;
    float rim=smoothstep(R*0.7,R,d)*(1.0-smoothstep(R,R*1.12,d));
    vec3 iri=0.5+0.5*cos(TAU*(hash21(cid)*3.0+vec3(0.0,0.33,0.67)));
    acc+=Lc*(0.05*nz+rim*0.38)+vec3(1.0)*spot+iri*rim*cl*0.5;
  }
  const float lw=0.02;
  float lid=floor(p.x/lw);
  if(hash21(vec2(lid,3.0))<w*0.45){
    float xl=(fract(p.x/lw)-0.5)*lw+(hash21(vec2(lid,8.0))-0.5)*lw*0.5;
    float sp=0.012+0.03*hash21(vec2(lid,5.0));
    float len=0.15+0.30*hash21(vec2(lid,6.0));
    float dy=p.y-mod(hash21(vec2(lid,7.0))*3.0-t*sp,1.6);
    float trail=(dy>0.0&&dy<len)?(1.0-dy/len):0.0;
    acc+=Lc*exp(-xl*xl/(2.0*0.0014*0.0014))*trail*0.5*w;
    acc+=vec3(1.0)*smoothstep(0.006,0.0,length(vec2(xl,dy)))*0.9*w;
  }
  return acc;
}

// Voronoi froth riding the surface; cell size follows the mean bubble radius that arrived
vec3 foamLayer(vec2 p,float sY,float t,vec3 tint,vec3 Ld,out float cover){
  cover=0.0;
  float yl=p.y-sY;
  if(yl<-0.003||yl>0.2)return vec3(0.0);
  float cs=max(uFoamCell,0.005)*1.7;
  vec2 q=vec2(p.x,yl)/cs;
  vec2 ip=floor(q),fp=fract(q);
  float F1=9.0,F2=9.0;vec2 cid=vec2(0.0),cvec=vec2(0.0);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 b=vec2(float(i),float(j));
    vec2 r=b+0.15+hash22(ip+b)*0.7-fp;
    float d=dot(r,r);
    if(d<F1){F2=F1;F1=d;cid=ip+b;cvec=r;}else if(d<F2){F2=d;}
  }
  vec2 cq=q+cvec;
  float cy=cq.y*cs,tx=foamAt(cq.x*cs).x;
  float hh=hash21(cid+7.0);
  if(!(cy<tx-0.35*cs+hh*0.9*cs&&tx>0.1*cs&&cy>-0.25*cs))return vec3(0.0);
  // each froth cell is a round bubble (radius Rb); where neighbours touch, the Voronoi border becomes a flat Plateau edge
  float d1=sqrt(F1),d2=sqrt(F2),Rb=0.56,pxw=uPx/cs;
  float disk=1.0-smoothstep(Rb-1.0*pxw,Rb,d1);
  if(disk<=0.0)return vec3(0.0);
  cover=disk;
  float edge=(1.0-smoothstep(0.0,max(0.06,1.6*pxw),d2-d1));
  if(uLineMode>0.5)return vec3(max(edge,1.0-smoothstep(0.0,1.6*pxw*uLineThick,abs(d1-Rb)))*disk);
  vec2 nd=-cvec/Rb;float nz=sqrt(max(1.0-min(dot(nd,nd),1.0),0.0));
  vec3 n=vec3(nd,nz);
  vec3 Hh=normalize(Ld+vec3(0.0,0.0,1.0));
  float spec=pow(max(dot(n,Hh),0.0),60.0)*1.5+pow(max(dot(n,normalize(vec3(-Ld.xy,0.9)+vec3(0.0,0.0,1.0))),0.0),90.0)*0.5;
  float rim=pow(1.0-nz,2.5);
  vec3 iri=0.5+0.5*cos(TAU*(hh+yl*7.0+vec3(0.0,0.33,0.67)));
  float flash=step(0.9965,fract(hh*13.0+t*0.37));
  vec3 lc=mix(vec3(1.0),tint,0.35);
  vec3 c=lc*(0.05+0.10*nz)+lc*rim*0.7+lc*edge*0.5+vec3(1.0)*spec*uWet+iri*rim*0.35+vec3(1.0)*flash*1.2;
  return c*disk;
}

// Per-scene look, filled in by each scene file: rays / marine snow / vignette strength, caustic gain, fauna style
// (0 lit, 1 silhouette, 2 bioluminescent, 3 translucent).
struct SceneCfg{float rays;float snow;float vig;float caus;int fauna;};
vec3 waterScene(vec2 p,float t,vec3 Ld,SceneCfg cfg){
  vec3 tint=hsv2rgb(vec3(uHue/360.0,0.6,1.0));
  vec3 deepc=hsv2rgb(vec3(fract(uHue/360.0+0.05),0.95,0.55));
  bool surf=uHasSurface>0.5;
  float sY=surf?surfaceY(p.x):3.0;
  float depth=sY-p.y;
  float sub=smoothstep(-uPx*1.5,uPx*1.5,depth);
  float vd=surf?max(depth,0.0):(1.0-p.y)*0.9;
  vec3 col=vec3(0.0);

  if(sub>0.0){
    vec2 g;float H=fieldH(p,t,g);
    float shallow=smoothstep(0.0,0.10,vd);
    vec2 refr=(flowDisp(p,t)+g*0.3)*uDistort*(0.35+0.65*shallow);
    if(surf)refr.y+=0.011*exp(-vd*70.0)*uDistort;
    vec2 q=p+refr;
    if(surf)q.y=sY+(q.y-sY)*0.78;
    vec2 dv=(refr*0.12+vec2(0.0008,0.0))*uDisp;
    float dk=surf?1.0-exp(-vd*2.0):vd;
    vec3 absorb=mix(vec3(1.0),tint*0.9,dk)*mix(1.0,0.45,dk);
    vec3 below=basePatternRGB(q,dv)*absorb;
    below+=mix(tint*0.85,deepc,1.0-exp(-vd*1.1))*uWash*(0.75+0.25*vnoise(p*2.5+vec2(t*0.05,0.0)));
    // caustics (warped by the wave + ripple gradient), with chromatic split
    vec2 cp=p+g*0.15*uDistort;float ct=t*0.55+23.0;
    vec3 ca=vec3(caustic(cp+dv*0.6,ct),caustic(cp,ct),caustic(cp-dv*0.6,ct));
    float cf=surf?(0.30+0.70*exp(-vd*1.1)):(0.55+0.45*p.y);
    cf*=cfg.caus;
    below+=ca*mix(vec3(1.0),tint,0.5)*cf*1.5;
    // wet specular: GGX-ish lobe, Fresnel boost, sun-glitter and caustic-ridge sheen
    vec2 mg=vec2(vnoise(p*150.0+vec2(t*0.7,0.0)),vnoise(p*150.0+vec2(41.0,t*0.6)))-0.5;
    vec3 n=normalize(vec3(-(g*6.0+mg*0.45),1.0));   // micro-ripple breaks highlights into wet shards
    vec3 Hh=normalize(Ld+vec3(0.0,0.0,1.0));
    float fres=0.03+0.97*pow(1.0-n.z,4.0);
    float spec=pow(max(dot(n,Hh),0.0),mix(150.0,3000.0,uGloss))*(0.6+10.0*fres)*2.2;
    vec3 n2=normalize(vec3(-(g*6.0+mg*1.6),1.0));
    float tw=0.5+0.5*sin(t*8.0+hash21(floor(p*150.0))*TAU);
    float glit=smoothstep(0.9972-0.003*uSpark,1.0,max(dot(n2,Hh),0.0))*tw*uSpark*2.5;
    float nearS=surf?exp(-vd*0.8):0.8;
    below+=((spec*1.4+glit)*mix(vec3(1.0),tint,0.35)*nearS+pow(ca.g,2.0)*0.45)*uWet;
    if(surf)below+=tint*exp(-vd*22.0)*0.45;
    if(cfg.rays>0.0)below+=mix(tint,vec3(1.0),0.5)*rays(p,t,vd)*cfg.rays;
    if(cfg.snow>0.0)below+=snow(p,t)*mix(tint,vec3(1.0),0.6)*0.6*cfg.snow;
    if(cfg.vig>0.0)below*=mix(1.0,mix(0.45,1.0,smoothstep(1.3,0.2,length((p-vec2(uA*0.5,0.5))*vec2(0.9,1.1)))),cfg.vig);
    // shadows cast on the background by creatures in front (offset away from the light, fading as they swim back)
    if(uFauna>0.5&&uShadowAmt>0.0){
      vec2 su=maskUV(p);float e=0.004;
      float sh=(textureLod(uShadowT,su,0.0).r*2.0+textureLod(uShadowT,su+vec2(e,e),0.0).r+textureLod(uShadowT,su-vec2(e,e),0.0).r
               +textureLod(uShadowT,su+vec2(e,-e),0.0).r+textureLod(uShadowT,su-vec2(e,-e),0.0).r)/6.0;
      below*=1.0-0.75*uShadowAmt*sh;
    }
    // fauna: creatures come from the mask pass (coverage, dome, glow, opacity), refracted like the rest of the water
    if(uFauna>0.5){
      vec2 mp=p+refr;
      vec4 mG=textureLod(uMask,maskUV(mp),0.0);
      vec4 mR=textureLod(uMask,maskUV(mp+dv*0.6),0.0);
      vec4 mB=textureLod(uMask,maskUV(mp-dv*0.6),0.0);
      if(max(max(mG.x,mG.z),max(mR.x,mB.x))>0.003){
        vec3 Lc=mix(vec3(1.0),tint,0.45);
        vec3 cvr=vec3(mR.x,mG.x,mB.x);
        float dm=mG.y,op=max(mG.w,0.25),fg=uFaunaGlow;
        float rimv=pow(1.0-clamp(dm,0.0,1.0),2.0);
        vec3 bodyc,halo;float carve;
        if(cfg.fauna==1){carve=0.93;bodyc=Lc*rimv*1.5*fg;halo=vec3(0.0);}
        else if(cfg.fauna==2){
          vec3 gc=hsv2rgb(vec3(fract(uHue/360.0+0.1),0.55,1.0));
          carve=0.72;bodyc=Lc*rimv*0.35*fg;halo=gc*pow(mG.z,1.3)*1.7*fg;
        }else{
          float e=0.0035;
          vec2 gd=vec2(textureLod(uMask,maskUV(mp+vec2(e,0.0)),0.0).y-textureLod(uMask,maskUV(mp-vec2(e,0.0)),0.0).y,
                       textureLod(uMask,maskUV(mp+vec2(0.0,e)),0.0).y-textureLod(uMask,maskUV(mp-vec2(0.0,e)),0.0).y);
          vec3 cn=normalize(vec3(-gd*2.0,1.0));
          float fsp=pow(max(dot(cn,Hh),0.0),mix(30.0,220.0,uGloss))*1.8*uWet;
          carve=(cfg.fauna==0)?0.55:0.35;
          bodyc=Lc*(0.07+0.30*dm)*(cfg.fauna==3?absorb:vec3(1.0))+ca*Lc*((cfg.fauna==0)?0.8:0.5)+Lc*rimv*0.7*fg+vec3(fsp)*fg;
          halo=Lc*mG.z*0.5*fg;
        }
        below=below*(1.0-carve*cvr*op)+bodyc*cvr+halo;
      }
    }
    col+=below*sub;
  }
  if(surf&&sub<1.0){
    vec3 ab=vec3(basePattern(p));
    vec2 wc=wetAt(p.y);
    if(wc.x>0.02||wc.y>0.02)ab+=wetFilm(p,t,wc.x,wc.y,tint,Ld)*uWet;
    float cover;vec3 fo=foamLayer(p,sY,t,tint,Ld,cover);
    ab=ab*(1.0-0.6*cover)+fo;
    col+=ab*(1.0-sub);
  }
  if(surf){   // meniscus: bright rim that follows the crest facing the light
    float slope=(surfaceY(p.x+0.004)-surfaceY(p.x-0.004))/0.008;
    float face=0.55+0.9*clamp(0.5+slope*6.0*sign(Ld.x+1e-3),0.0,1.0);
    float line=exp(-depth*depth/(2.0*pow(uPx*1.3,2.0)));
    float glow=exp(-abs(depth)/0.007)*(depth>0.0?0.28:0.12);
    col+=mix(vec3(1.0),tint,0.3)*(line*1.4*face*(0.4+0.6*uWet)+glow*uWash+line*0.4);
  }
  return col;
}

float isoline(float f,float thickPx){
  float fw=max(fwidth(f),1e-5);
  float d=abs(f-floor(f+0.5));
  return 1.0-smoothstep((thickPx*0.5-0.5)*fw,(thickPx*0.5+0.5)*fw,d);
}
`;
FX.glsl = Object.assign(FX.glsl || {}, { waterLib: WATER_LIB });
})(window.FluidFX);
