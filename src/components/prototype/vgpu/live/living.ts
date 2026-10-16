export type Spring = {position:number;velocity:number};
export type LiquidRect = {x:number;y:number;width:number;height:number};
export type RectSpring = {rect:LiquidRect;velocity:LiquidRect};
export const easeBetween = (lo:number,hi:number,value:number) => {
  const t=Math.max(0,Math.min(1,(value-lo)/(hi-lo)));
  return t*t*(3-2*t);
};

/** Exact critically damped spring: independent of the display's refresh rate. */
export function advanceSpring(state:Spring,target:number,elapsed:number,frequency=9):Spring {
  const dt=Math.max(0,Math.min(.1,elapsed));
  const offset=state.position-target,decay=Math.exp(-frequency*dt);
  const momentum=state.velocity+frequency*offset;
  return {position:target+(offset+momentum*dt)*decay,velocity:(state.velocity-frequency*momentum*dt)*decay};
}
export function distanceToRect(x:number,y:number,rect:LiquidRect) {
  return Math.hypot(Math.max(rect.x-x,0,x-rect.x-rect.width),Math.max(rect.y-y,0,y-rect.y-rect.height));
}
/** Retarget an existing organized slot without teleporting its live surface. */
export function advanceRect(state:RectSpring,target:LiquidRect,elapsed:number):RectSpring {
  const rect={...state.rect},velocity={...state.velocity};
  for(const key of ["x","y","width","height"] as const){
    const next=advanceSpring({position:rect[key],velocity:velocity[key]},target[key],elapsed);
    rect[key]=next.position;velocity[key]=next.velocity;
  }
  return {rect,velocity};
}
/** A daughter begins inside its parent, stretches through a neck, then settles. */
export function buddingRect(target:LiquidRect,parent:LiquidRect,amount:number,index:number):LiquidRect {
  const p=Math.max(0,Math.min(1,amount)),travel=easeBetween(0,1,p);
  const from={x:parent.x+parent.width/2,y:parent.y+parent.height/2};
  const to={x:target.x+target.width/2,y:target.y+target.height/2};
  const dx=to.x-from.x,dy=to.y-from.y,length=Math.max(1,Math.hypot(dx,dy));
  const tension=Math.sin(p*Math.PI),bend=tension*(index%2===0?1:-1)*12;
  const seedWidth=Math.min(target.width*.48,parent.width*.72),seedHeight=Math.min(target.height*.48,parent.height*.72);
  const width=(seedWidth+(target.width-seedWidth)*p)*(1+tension*.38*Math.abs(dx)/length);
  const height=(seedHeight+(target.height-seedHeight)*p)*(1+tension*.38*Math.abs(dy)/length);
  return {x:from.x+dx*travel-dy/length*bend-width/2,y:from.y+dy*travel+dx/length*bend-height/2,width,height};
}

export type LiquidNeck = {a:{x:number;y:number};b:{x:number;y:number};radius:number};
function insideAnchor(rect:LiquidRect,toward:{x:number;y:number}) {
  const center={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  const dx=toward.x-center.x,dy=toward.y-center.y,length=Math.max(1,Math.hypot(dx,dy));
  const x=dx/length,y=dy/length;
  const edge=Math.min(rect.width/2/Math.max(.0001,Math.abs(x)),rect.height/2/Math.max(.0001,Math.abs(y)));
  const distance=Math.max(0,edge-Math.min(28,rect.width*.2,rect.height*.2));
  return {x:center.x+x*distance,y:center.y+y*distance};
}
/** The material stays joined while moving; only its readable content fades. */
export function liquidNeck(parent:LiquidRect,child:LiquidRect,amount:number):LiquidNeck {
  const p=Math.max(0,Math.min(1,amount));
  const a=insideAnchor(parent,{x:child.x+child.width/2,y:child.y+child.height/2});
  const b=insideAnchor(child,{x:parent.x+parent.width/2,y:parent.y+parent.height/2});
  return {a,b,radius:3.5+Math.min(32,child.height*.22)*Math.pow(Math.sin(Math.PI*p),.7)};
}
