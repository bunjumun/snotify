/* scenes/fluid fx/line-art.js - stylised black-and-white line art driven by the same wave field.
   Three styles (contours / ridgelines / engraving) are picked by the lineStyle parameter. */
FluidFX.registerScene({
  id: 5, key: 'line-art', name: 'Lines', category: 'fluid fx',
  space: 'pools',   // lines are drawn in and out of drifting patches, like a searchlight over a plotter
  waterline: true, mono: true,
  fauna: { fish: 30, jelly: 3, manta: 1, angler: 0 },
  style: { fauna: 'line' },
  glsl: `
vec3 scene_line_art(vec2 p,float t,vec3 Ld){
  float sY=surfaceY(p.x);
  float depth=sY-p.y;
  float N=uLineCount,th=uLineThick;
  vec2 g;float H=fieldH(p,t,g);
  float v=0.0;
  if(uLineStyle==0){          // contours: isolines of the wave field below the waterline, straight lines above
    float fW=H*N/0.09,fA=(p.y-uSurf)*N*0.45;
    float lW=isoline(fW,th*(1.0+uLineIndex*1.4*step(abs(mod(floor(fW+0.5),5.0)),0.5)));
    float lA=isoline(fA,th*(1.0+uLineIndex*1.4*step(abs(mod(floor(fA+0.5),5.0)),0.5)));
    v=depth>0.0?lW:lA;
  }else if(uLineStyle==1){    // ridgelines: stacked waveforms, nearer lines hide farther ones
    float sp=1.0/N;
    int K=int(min(ceil(0.075*uLineAmp*N)+1.0,11.0));
    float r0=floor(p.y*N);
    for(int k=-11;k<=12;k++){
      if(k<-K)continue;
      if(k>K+1)break;
      float j=r0+float(k);
      if(j<0.0||j>N-1.0)continue;
      float yj=(j+0.5)*sp;
      float sj=clamp((sY-yj)/0.06,0.0,1.0);
      float off=0.0,slope=0.0;
      if(sj>0.0){vec2 gg;float hj=fieldH(vec2(p.x,yj),t,gg);off=hj*1.9*uLineAmp*sj;slope=gg.x*1.9*uLineAmp*sj;}
      float yy=yj+off;
      float wv=th*0.5*uPx*sqrt(1.0+slope*slope);
      if(yy+wv+uPx>=p.y){v=1.0-smoothstep(wv-0.5*uPx,wv+0.5*uPx,abs(yy-p.y));break;}
    }
  }else{                      // engraving: hatch weight follows shading, cross-hatch in the shadows
    float sh=depth>0.0?clamp(0.5+1.4*dot(normalize(vec3(-g*6.0,1.0)).xy,Ld.xy)+0.35*H/0.04,0.0,1.0):1.0;
    float off=depth>0.0?H*1.5*uLineAmp:0.0;
    float tw=th*(0.35+2.2*(1.0-sh));
    float l1=isoline((p.y+off)*N,tw);
    float l2=isoline((p.x*0.8+p.y*0.6+off*0.5)*N*0.9,tw*0.7)*smoothstep(0.38,0.18,sh)*step(0.0,depth);
    v=max(l1,l2);
    v=max(v,uLineTone*0.5*(1.0-sh)*step(0.0,depth));
  }
  float wb=th*1.9*uPx*0.5;
  v=max(v,1.0-smoothstep(wb-0.5*uPx,wb+0.5*uPx,abs(depth)));
  // fauna as line art: clean outline, cut the lines behind, and style-specific interior marks
  vec4 mk=vec4(0.0);
  if(uFauna>0.5)mk=textureLod(uMask,maskUV(p),0.0);
  float fcv=mk.x,fwc=max(fwidth(fcv),1e-3);
  float inCr=step(0.5,fcv);
  v*=1.0-inCr;
  float outl=1.0-smoothstep(th*0.5-0.5,th*0.5+0.5,abs(fcv-0.5)/fwc);
  float innr=0.0;
  if(uLineStyle==0)innr=isoline(mk.y*3.0,th*0.9)*inCr*step(0.12,mk.y);
  else if(uLineStyle==2)innr=isoline((p.y*0.9+p.x*0.25)*N*1.1,th*(0.4+1.6*(1.0-mk.y)))*inCr*0.9;
  float dots=smoothstep(0.5,0.7,mk.z);
  v=max(v,max(outl,max(innr,dots)));
  float cover;vec3 fo=foamLayer(p,sY,t,vec3(1.0),Ld,cover);
  return vec3(smoothstep(0.2,0.8,clamp(max(v,fo.r),0.0,1.0)));   // tighten AA so the frame reads close to 1-bit
}
`,
});
