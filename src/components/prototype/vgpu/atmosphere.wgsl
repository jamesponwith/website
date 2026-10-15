// Analytic optical field: accretion, refraction, caustics, and folded light.
// No meshes, particle sprites, or sampled art. Every visible light is live WGSL.
struct Params {
  timing: vec4f, scene: vec4f, color: vec4f, pointer: vec4f,
  morph: vec4f, topology: vec4f,
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
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
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
  // Filmic highlight roll-off keeps the brightest caustic a warm white.
  color = vec3f(1.0)-exp(-max(color,vec3f(0.0))*1.24);
  return vec4f(color,1.0);
}
