/* engine/shaders/room.js - the wall's neighbours. A short-throw frame can span back wall, ceiling and floor; the wall is the
   normal scene (logical y 0..1), the ceiling (y > 1) is the water surface seen from below and the floor (y < 0) is the
   seabed seen from above. Both are one plane seen through foldPlane() (common.js): squeezed toward the fold where it is far
   away, so the room's own perspective does the rest. Used by the scene dispatcher in scenes.js. */
(function (FX) {
'use strict';

const GLSL_ROOM = `
uniform float uSnell,uFloorLit;

// far away the plane's fine detail would only shimmer: fade contrast toward its average instead of toward black
vec3 farFade(vec3 ca,float detail){return mix(vec3(0.18),ca,detail);}
float planeLines(float H,float detail){return isoline(H*uLineCount/0.09,uLineThick)*detail;}

// CEILING - looking up at the surface: ripples squeezed toward the horizon, a bright Snell's window overhead,
// a dim silvery mirror past the critical angle, froth rafts and pop rings where the bubbles arrive on the fold
vec3 ceilingScene(vec2 p,float t,vec3 Ld){
  float n,Q;
  vec2 q=foldPlane(p.x,p.y-1.0,uTop-1.0,n,Q);
  vec2 pl=vec2(q.x,1.0+q.y);
  float dy=p.y-1.0;
  float detail=1.0-smoothstep(1.5,3.4,Q);
  float fold=exp(-dy/0.012);                       // the surface seen edge-on: continues the wall's meniscus line
  vec2 g;float H=fieldH(pl,t,g);
  float cover;
  if(uLineMode>0.5){
    vec3 fo=foamLayer(pl,1.0,t,vec3(1.0),Ld,cover);
    return vec3(clamp(max(max(planeLines(H,detail),fold*0.9),fo.r),0.0,1.0));
  }
  vec3 tint=hsv2rgb(vec3(uHue/360.0,0.6,1.0));
  vec3 deepc=hsv2rgb(vec3(fract(uHue/360.0+0.05),0.95,0.55));
  float tanPsi=0.12+2.1*(Q-1.0);                   // viewing angle from straight up, grows toward the fold
  float win=1.0-smoothstep(0.9,1.4,tanPsi);        // Snell's window edge: tan(48.6 deg) = 1.13
  float gain=mix(1.0,mix(0.22,1.0,win),uSnell);
  vec2 cp=pl+g*0.25*uDistort;float ct=t*0.55+23.0;
  vec2 dv=vec2(0.0008,0.0)*uDisp;
  vec3 ca=farFade(vec3(caustic(cp+dv*0.6,ct),caustic(cp,ct),caustic(cp-dv*0.6,ct)),detail);
  vec3 col=mix(tint*0.85,deepc,0.5)*uWash*(0.75+0.25*vnoise(pl*2.5+vec2(t*0.05,0.0)));
  col+=ca*mix(vec3(1.0),tint,0.5)*1.3;
  // glitter: tilted facets of the surface throw the light back
  vec2 mg=vec2(vnoise(pl*150.0+vec2(t*0.7,0.0)),vnoise(pl*150.0+vec2(41.0,t*0.6)))-0.5;
  vec3 nn=normalize(vec3(-(g*6.0+mg*1.6),1.0));
  vec3 Hh=normalize(Ld+vec3(0.0,0.0,1.0));
  float tw=0.5+0.5*sin(t*8.0+hash21(floor(pl*150.0))*TAU);
  float glit=smoothstep(0.9972-0.003*uSpark,1.0,max(dot(nn,Hh),0.0))*tw*uSpark*2.5*detail;
  col+=glit*mix(vec3(1.0),tint,0.35)*uWet;
  col*=gain;
  col+=mix(tint,vec3(1.0),0.5)*win*0.16*uSnell*(0.7+0.3*clamp(H/0.03,-1.0,1.0));   // the sky through the window
  vec3 fo=foamLayer(pl,1.0,t,tint,Ld,cover);
  col=col*(1.0-0.6*cover)+fo*detail;
  col+=mix(vec3(1.0),tint,0.3)*(fold*0.9+exp(-dy/0.06)*0.12);
  return col;
}

// FLOOR - looking down at the seabed: the caustic network lands here at full strength, grain on the sand, dim toward the fold
vec3 floorScene(vec2 p,float t,vec3 Ld){
  float n,Q;
  vec2 q=foldPlane(p.x,-p.y,-uBot,n,Q);
  vec2 pl=vec2(q.x,-q.y);
  float detail=1.0-smoothstep(1.5,3.4,Q);
  vec2 g;float H=fieldH(pl,t,g);
  float fold=exp(p.y/0.012)*0.2;                   // where the seabed meets the wall
  if(uLineMode>0.5)return vec3(clamp(max(planeLines(H,detail),fold),0.0,1.0))*uFloorLit;
  vec3 tint=hsv2rgb(vec3(uHue/360.0,0.6,1.0));
  vec3 deepc=hsv2rgb(vec3(fract(uHue/360.0+0.05),0.95,0.55));
  vec2 cp=pl+g*0.15*uDistort;float ct=t*0.55+23.0;
  vec2 dv=vec2(0.0008,0.0)*uDisp;
  vec3 ca=farFade(vec3(caustic(cp+dv*0.6,ct),caustic(cp,ct),caustic(cp-dv*0.6,ct)),detail);
  float sand=0.8+0.4*vnoise(pl*60.0);
  vec3 col=mix(tint*0.85,deepc,0.6)*uWash*0.8+ca*mix(vec3(1.0),tint,0.5)*1.5*sand;
  col*=mix(0.55,1.0,n)*uFloorLit;                  // brightest right below the viewer, quiet toward the far wall
  col+=mix(vec3(1.0),tint,0.3)*fold*uFloorLit;
  return col;
}
`;

FX.glsl = Object.assign(FX.glsl || {}, { roomLib: GLSL_ROOM });
})(window.FluidFX);
