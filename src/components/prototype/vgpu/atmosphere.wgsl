// Analytic optical field: accretion, refraction, caustics, and folded light.
// No meshes, particle sprites, or sampled art. Every visible light is live WGSL.
struct Params {
  timing: vec4f, scene: vec4f, color: vec4f, pointer: vec4f,
  morph: vec4f, topology: vec4f,
  glass0: vec4f, glass1: vec4f, glass2: vec4f, glass3: vec4f, glassMeta: vec4f,
}
@group(0) @binding(0) var<uniform> params: Params;
const PI: f32 = 3.141592654;
fn rotate2(p: vec2f, angle: f32) -> vec2f {
  return vec2f(cos(angle)*p.x - sin(angle)*p.y,sin(angle)*p.x + cos(angle)*p.y);
}
fn hash(p: vec2f) -> f32 {
  let a = fract(vec3f(p.xyx) * vec3f(0.1031,0.1030,0.0973));
  let b = a + dot(a,a.yzx + 33.33);
  return fract((b.x+b.y)*b.z);
}
fn noise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2f(1.0,0.0)),u.x),mix(hash(i+vec2f(0.0,1.0)),hash(i+vec2f(1.0)),u.x),u.y);
}
fn fbm(p: vec2f) -> f32 {
  var q = p; var sum = 0.0; var weight = 0.5;
  for (var i = 0; i < 4; i++) {
    sum += noise(q)*weight;
    q = rotate2(q,0.53)*2.03 + vec2f(4.7,7.3);
    weight *= 0.5;
  }
  return sum;
}
fn palette() -> vec3f {
  return max(params.color.xyz,vec3f(0.045));
}
fn light_stream(p: vec2f, t: f32) -> vec3f {
  let bend = p.y + 0.22*sin(p.x*1.7+t*0.16) + 0.065*sin(p.x*4.0-t*0.1);
  let core = exp(-abs(bend)*90.0);
  let glow = exp(-abs(bend)*6.0);
  let caustic = exp(-abs(bend+0.13*sin(p.x*2.0+t*0.12))*38.0);
  return palette()*(glow*0.16+caustic*0.7) + vec3f(1.0,0.93,0.79)*core*2.4;
}
fn horizon(p: vec2f, t: f32) -> vec3f {
  let amplitude = clamp(params.scene.x,0.2,2.8);
  let q = rotate2(p, -0.13 + params.pointer.x*0.035);
  let radius = 0.48 + 0.018*sin(t*0.10) + params.pointer.w*0.018;
  let r = length(q);
  let angle = atan2(q.y,q.x);
  let edge = abs(r-radius);
  let swirl = angle + log(max(r,0.1))*2.4-t*0.045;
  let turbulence = fbm(vec2f(swirl*7.0,(r-radius)*31.0-t*0.13));
  let striation = 0.45+0.55*noise(vec2f(r*550.0+angle*0.7,angle*112.0-t*0.11));
  let atmosphere = exp(-edge*5.5)*(0.30+0.7*turbulence);
  let photon = exp(-edge*145.0)*(0.6+1.4*turbulence);
  let inner = exp(-edge*36.0)*0.6;
  let crown = 0.10+0.90*(1.0-smoothstep(-0.7,0.3,q.y/max(r,0.01)));
  let outerMatter = smoothstep(radius,radius+0.025,r);
  let corona = atmosphere*(0.20+0.80*striation)*outerMatter*crown;
  let tint = palette();
  var color = tint*(corona*0.72+inner*0.35) + mix(tint,vec3f(1.0,0.91,0.73),0.75)*photon*crown*1.35;
  // The far accretion plane is gravitationally lifted around the void.
  let lift = sqrt(max(radius*radius-q.x*q.x,0.0));
  let diskY = q.y + lift*0.30;
  let thickness = 0.013 + abs(q.x)*0.034;
  let disk = exp(-pow(abs(diskY)/(thickness*amplitude),0.78));
  let extent = exp(-pow(abs(q.x)/1.65,2.0));
  let material = 0.32+0.68*fbm(vec2f(q.x*9.0-t*0.18,log(abs(diskY)+0.009)*5.0));
  let lines = 0.38+0.62*noise(vec2f(log(abs(diskY)+0.006)*37.0+t*0.1,q.x*8.0-t*0.16));
  let frontMask = smoothstep(-0.01,0.04,q.y) + smoothstep(radius-0.015,radius+0.015,abs(q.x));
  color += tint*disk*extent*material*(0.5+lines)*min(frontMask,1.0)*1.25;
  let hotDisk = exp(-abs(diskY)*180.0)*extent*min(frontMask,1.0);
  color += vec3f(1.0,0.92,0.78)*hotDisk*0.80;
  // An opaque horizon stays ink-black. Its edge refracts the distant field.
  let voidMask = smoothstep(radius-0.009,radius+0.003,r);
  color *= voidMask;
  let lensGhost = exp(-pow((r-radius*1.09)*48.0,2.0))*0.11;
  color += tint*lensGhost*crown;
  color += tint*exp(-pow(q.y*8.0,2.0)-abs(q.x)*1.1)*0.035;
  return color;
}
struct GlassSurface { distance: f32, gradient: vec2f }
fn glass_surface(p: vec2f, t: f32, mode: f32) -> GlassSurface {
  // Exact derivatives replace four additional complete distance evaluations.
  if (mode < 1.5) {
    let angle = -0.44+0.11*sin(t*0.05);
    let q = rotate2(p,angle);
    let a = q.x*1.35+t*0.13;
    let b = q.x*2.8-t*0.085;
    let c = q.x*1.8+t*0.09;
    let curve = 0.30*sin(a)+0.17*sin(b);
    let halfWidth = 0.18+0.075*cos(c);
    let across = q.y-curve;
    // Match the previous symmetric derivative at the ribbon's medial crease.
    let side = clamp(across/0.0015,-1.0,1.0);
    let slope = 0.405*cos(a)+0.476*cos(b);
    let gradient = rotate2(vec2f(-side*slope+0.135*sin(c),side),-angle);
    return GlassSurface(abs(across)-halfWidth,gradient);
  }
  let radius = length(p);
  let ellipse = length(p*vec2f(0.77,1.12));
  let angle = atan2(p.y,p.x);
  let phase = angle*3.0+t*0.11;
  let ramp = clamp((radius-0.12)/0.50,0.0,1.0);
  let smoothing = ramp*ramp*(3.0-2.0*ramp);
  let radialDerivative = 12.0*ramp*(1.0-ramp);
  let angularGradient = vec2f(-p.y,p.x)/max(dot(p,p),0.000001);
  let rimGradient = 0.07*(cos(phase)*3.0*angularGradient*smoothing+sin(phase)*radialDerivative*p/max(radius,0.000001));
  let gradient = p*vec2f(0.5929,1.2544)/max(ellipse,0.000001)-rimGradient;
  return GlassSurface(ellipse-(0.73+0.07*sin(phase)*smoothing),gradient);
}
fn liquid_glass(p: vec2f, t: f32, mode: f32) -> vec3f {
  let surface = glass_surface(p,t,mode);
  let d = surface.distance;
  let gradient = surface.gradient;
  let inside = 1.0-smoothstep(-0.003,0.003,d);
  let depth = sqrt(max(-d,0.0));
  let normal = normalize(vec3f(gradient*0.70,0.22+depth*1.8));
  let fresnel = 0.04+0.96*pow(1.0-abs(normal.z),4.0);
  let refracted = refract(vec3f(0.0,0.0,-1.0),normal,1.0/1.46);
  let warped = p+refracted.xy*(0.24+depth*0.55)*params.scene.x;
  let red = light_stream(warped+normal.xy*0.015,t).r;
  let green = light_stream(warped,t).g;
  let blue = light_stream(warped-normal.xy*0.018,t).b;
  let transmitted = vec3f(red,green,blue)*exp(-depth*vec3f(0.16,0.08,0.04));
  let edge = exp(-abs(d)*125.0);
  let softEdge = exp(-abs(d)*20.0);
  let studio = pow(max(0.0,dot(normal,normalize(vec3f(-0.7,-0.4,0.7)))),18.0);
  let reflection = pow(max(0.0,sin(normal.x*6.0+normal.y*3.0+t*0.05)),22.0);
  let film = 0.5+0.5*cos(vec3f(0.0,2.1,4.2)+(1.0-normal.z)*12.0);
  var color = light_stream(p,t)*0.055;
  color += (transmitted*0.72+palette()*depth*0.11+film*fresnel*0.19+vec3f(0.80,0.89,1.0)*(studio*1.6+reflection*0.32))*inside;
  color += mix(palette(),vec3f(0.92,0.97,1.0),0.65)*edge*(0.2+studio*1.2);
  color += palette()*softEdge*0.08;
  let caustic = light_stream(p+gradient*0.08,t)*exp(-abs(d-0.065)*18.0)*0.32;
  return color+caustic;
}
fn radiance(p: vec2f, t: f32) -> vec3f {
  let q = rotate2(p,0.35);
  let field = fbm(q*2.2 + vec2f(t*0.035,-t*0.03));
  let warp = q + vec2f(sin(q.y*1.4+t*0.08),cos(q.x*1.6-t*0.05))*field*0.43;
  var c = vec3f(0.0);
  for (var i=0; i<5; i++) {
    let f = f32(i);
    let light = warp.y + sin(warp.x*(1.1+f*0.12)+t*0.10+f*0.42)*0.30+(f-2.0)*0.13;
    let hot = exp(-abs(light)*80.0);
    let bloom = exp(-abs(light)*8.0)*0.1;
    c += mix(palette(),vec3f(0.70,0.89,1.0),f/7.0)*(hot+bloom)*(0.3+0.7*field);
  }
  c += liquid_glass(p+vec2f(0.1,-0.1),t,1.0)*0.35;
  return c;
}
fn folded_light(p: vec2f, t: f32) -> vec3f {
  // Recursive smooth refraction folds a continuous glass surface, not a mesh.
  var q = rotate2(p,0.23+t*0.012);
  var amount = 0.34;
  for (var i=0; i<3; i++) {
    q += sin(q.yx*vec2f(1.7,1.5)+vec2f(t*0.07,-t*0.055))*amount;
    q = rotate2(q,0.12);
    amount *= 0.53;
  }
  let front = liquid_glass(q,t,1.0);
  let rear = liquid_glass(rotate2(q,0.94)*1.25+vec2f(0.20,0.12),t*0.82,1.0);
  return front+rear*0.43;
}
fn architecture(p: vec2f, t: f32) -> vec3f {
  let q = rotate2(p,-0.48);
  var c = vec3f(0.0);
  for (var i=0; i<3; i++) {
    let f=f32(i);
    let edge = q.y+(f-1.0)*0.37+0.03*sin(q.x*1.1+t*0.08);
    let slab = exp(-abs(edge)*85.0);
    let reflection = exp(-abs(edge+0.10)*13.0)*0.07;
    let depth = smoothstep(-0.20,0.02,-edge)*smoothstep(-0.38,-0.21,edge)*0.06;
    c += mix(palette(),vec3f(0.77,0.89,1.0),f*0.22)*(slab*0.63+reflection+depth)*exp(-q.x*q.x*0.28);
  }
  return c+liquid_glass(p*1.1,t,1.0)*0.25;
}
fn optical_mode(p: vec2f,t: f32,mode: f32) -> vec3f {
  if (mode<0.5) { return horizon(p,t); }
  if (mode<2.5) { return liquid_glass(p,t,mode); }
  if (mode<3.5) { return radiance(p,t); }
  if (mode<4.5) { return folded_light(p,t); }
  return architecture(p,t);
}
fn optical_backdrop(uv: vec2f) -> vec3f {
  let aspect = params.timing.y;
  let t = params.timing.x;
  var p = (uv-0.5)*vec2f(aspect,1.0)*2.0;
  // Optical mass is displaced from the copy, and subtly follows attention.
  p -= vec2f(aspect*0.16,-0.01)+params.pointer.xy*vec2f(0.045,-0.035);
  p /= 1.06 + clamp(params.scene.x,0.2,3.0)*0.14;
  let variant = params.timing.z;
  var sourceMode = params.morph.x; var targetMode = params.morph.y;
  if (variant<0.5) { sourceMode=0.0; targetMode=0.0; p*=1.05+params.scene.z*0.055; }
  if (variant>1.5 && variant<2.5) { sourceMode=5.0; targetMode=5.0; }
  if (variant>2.5) { sourceMode=3.0; targetMode=3.0; }
  // Also guard here: stale callers must not pay for two modes at either endpoint.
  var optical: vec3f;
  if (sourceMode==targetMode || params.morph.z<=0.0) {
    optical=optical_mode(p,t,sourceMode);
  } else if (params.morph.z>=1.0) {
    optical=optical_mode(p,t,targetMode);
  } else {
    optical=mix(optical_mode(p,t,sourceMode),optical_mode(p,t,targetMode),params.morph.z);
  }
  let fog=palette()*exp(-dot(p,p)*0.7)*0.006;
  var color = vec3f(0.0025,0.003,0.005)+optical+fog;
  let grain = (hash(floor(uv*params.topology.xy))-0.5)*0.003;
  color += vec3f(grain);
  color *= 1.0-smoothstep(0.45,2.8,length((uv-0.5)*vec2f(aspect,1.0)))*0.55;
  return color;
}

// DOM-aligned liquid panes, measured in CSS pixels. The same optical field is
// evaluated at the refracted ray, so light genuinely moves through the bevel.
struct PanelSurface { distance: f32, gradient: vec2f }
fn rounded_panel(p: vec2f, rect: vec4f) -> PanelSurface {
  let viewport = max(params.topology.xy,vec2f(1.0));
  let local = p-rect.xy*viewport;
  let halfSize = rect.zw*viewport*0.5;
  let radius = min(clamp(min(halfSize.x,halfSize.y)*0.22,10.0,26.0),min(halfSize.x,halfSize.y));
  let q = abs(local)-halfSize+radius;
  let outer = max(q,vec2f(0.0));
  let outsideLength = length(outer);
  var gradient = select(vec2f(0.0,1.0),vec2f(1.0,0.0),q.x>q.y);
  if (outsideLength>0.0001) { gradient=outer/outsideLength; }
  gradient *= sign(local);
  return PanelSurface(outsideLength+min(max(q.x,q.y),0.0)-radius,gradient);
}
fn panel_surface(uv: vec2f) -> PanelSurface {
  let rects = array<vec4f,4>(params.glass0,params.glass1,params.glass2,params.glass3);
  let p = uv*max(params.topology.xy,vec2f(1.0));
  var field = PanelSurface(100000.0,vec2f(0.0,1.0));
  for (var i=0u;i<min(u32(params.glassMeta.x),4u);i++) {
    let pane=rounded_panel(p,rects[i]);
    // Smooth union forms a meniscus where nearby panes meet, rather than
    // drawing two outlines through one another.
    let fusion=18.0+14.0*clamp(params.glassMeta.y,0.0,1.0);
    let h=clamp(0.5+0.5*(pane.distance-field.distance)/fusion,0.0,1.0);
    field=PanelSurface(mix(pane.distance,field.distance,h)-fusion*h*(1.0-h),mix(pane.gradient,field.gradient,h));
  }
  return field;
}
fn panel_microfacet(p: vec2f,t: f32) -> vec3f {
  // Two quiet inversion folds split grazing light into tiny prismatic shards.
  // They modulate the bevel only; no fracture grid crosses the pane's text.
  var q=p*0.017+vec2f(t*0.006,-t*0.004);
  for(var i=0;i<2;i++) { q=rotate2(abs(q)-vec2f(0.62,0.41),0.67)*1.37; }
  let plane=sin(q.x*2.2+q.y*1.3);
  let crease=exp(-abs(q.x+q.y*0.58)*34.0);
  let spectrum=0.5+0.5*cos(vec3f(0.0,2.1,4.2)+plane*3.8);
  return spectrum*(0.004+crease*0.019);
}
fn liquid_panels(uv: vec2f,backdrop: vec3f) -> vec3f {
  let viewport=max(params.topology.xy,vec2f(1.0));
  let field=panel_surface(uv);
  let d=field.distance;
  // Antialias against actual backing pixels, including ambient pixel budgets.
  let aa=max(length(viewport)/max(length(max(params.topology.zw,vec2f(1.0))),1.0),0.65);
  let coverage=1.0-smoothstep(-aa,aa,d);
  let shadowD=panel_surface(uv-vec2f(4.0,11.0)/viewport).distance;
  let shadow=exp(-max(shadowD,0.0)/18.0)*(1.0-smoothstep(-14.0,0.0,-shadowD))*0.16;
  var color=backdrop*(1.0-shadow);
  if(d>max(aa,1.5)) { return color; }
  let depth=max(-d,0.0);
  let energy=clamp(params.glassMeta.y,0.0,1.0);
  let pulseAge=clamp(params.glassMeta.z,0.0,1.5);
  // Interaction travels through the shallow meniscus only, leaving the flat
  // glass and DOM text still. It is not a screen-wide illumination effect.
  let ripple=sin(depth*0.52-pulseAge*14.0+dot(uv*viewport,vec2f(0.005,-0.003)));
  let bezel=16.0+energy*2.5;
  let rim=clamp(1.0-depth/bezel,0.0,1.0);
  let strength=smoothstep(0.05,0.75,length(field.gradient));
  let normal=field.gradient/max(length(field.gradient),0.0001);
  let key=normalize(vec2f(-0.72,-0.69));
  let facing=max(dot(normal,key),0.0);
  let away=max(-dot(normal,key),0.0);
  let pointerPos=(params.pointer.xy*vec2f(0.5,-0.5)+0.5)*viewport;
  let toward=normalize(pointerPos-uv*viewport+vec2f(0.001));
  let attention=1.0+pow(max(dot(normal,toward),0.0),4.0)*params.pointer.z*0.26;
  let sheen=exp(-dot((uv-vec2f(0.20,0.05))*vec2f(params.timing.y,1.0),(uv-vec2f(0.20,0.05))*vec2f(params.timing.y,1.0))*0.9);
  var seen=backdrop;
  if(depth<bezel+aa) {
    let reach=-normal*(9.0+params.pointer.w*1.5+energy*(1.5+ripple*0.60))*rim*rim*strength;
    let refracted=clamp(uv+reach/viewport,vec2f(0.0),vec2f(1.0));
    let split=reach*(0.085+energy*0.012)/viewport;
    // Chromatic ray offsets are confined to the narrow bevel. The broad clear
    // pane and every pixel outside it reuse the original optical evaluation.
    seen=vec3f(optical_backdrop(clamp(refracted-split,vec2f(0.0),vec2f(1.0))).r,optical_backdrop(refracted).g,optical_backdrop(clamp(refracted+split,vec2f(0.0),vec2f(1.0))).b);
  }
  seen=seen*vec3f(0.94,0.965,0.99)+vec3f(0.0045,0.006,0.0085)+vec3f(0.008,0.010,0.014)*sheen;
  seen*=1.0-away*rim*rim*strength*0.12;
  // Broken broad glints reveal material thickness; no perimeter line is drawn.
  let glintMask=0.20+0.80*pow(0.5+0.5*sin(dot(uv*viewport,vec2f(0.013,-0.009))+params.timing.x*0.07),3.0);
  let shoulder=exp(-pow((d+3.0)/(5.5+energy*0.65),2.0));
  let specular=pow(facing,6.0)*attention*glintMask*(1.0+energy*ripple*0.18);
  seen+=vec3f(0.77,0.86,0.95)*shoulder*specular*0.24;
  seen+=vec3f(0.20,0.27,0.34)*pow(facing,3.0)*pow(rim,2.5)*strength*0.18;
  seen+=vec3f(0.017,0.022,0.03)*pow(rim,5.0)*strength;
  seen+=panel_microfacet(uv*viewport,params.timing.x+pulseAge*energy*0.20)*rim*rim*strength*(0.4+facing*0.6)*(1.0+energy*0.12);
  return mix(color,seen,coverage);
}
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var color=optical_backdrop(uv);
  if(params.glassMeta.x>0.0) { color=liquid_panels(uv,color); }
  // Filmic highlight roll-off is shared by the optical world and liquid panes.
  color=vec3f(1.0)-exp(-max(color,vec3f(0.0))*1.24);
  return vec4f(color,1.0);
}
