export type Spring = {position:number;velocity:number};
export type LiquidRect = {x:number;y:number;width:number;height:number};
export const easeBetween = (lo:number,hi:number,value:number) => {
  const t=Math.max(0,Math.min(1,(value-lo)/(hi-lo)));
  return t*t*(3-2*t);
};

/** Exact critically damped spring: independent of the display's refresh rate. */
export function advanceSpring(state:Spring,target:number,elapsed:number):Spring {
  const dt=Math.max(0,Math.min(.1,elapsed)),frequency=9;
  const offset=state.position-target,decay=Math.exp(-frequency*dt);
  const momentum=state.velocity+frequency*offset;
  return {position:target+(offset+momentum*dt)*decay,velocity:(state.velocity-frequency*momentum*dt)*decay};
}
export function distanceToRect(x:number,y:number,rect:LiquidRect) {
  return Math.hypot(Math.max(rect.x-x,0,x-rect.x-rect.width),Math.max(rect.y-y,0,y-rect.y-rect.height));
}
/** A daughter begins inside its parent, stretches through a neck, then settles. */
export function buddingRect(target:LiquidRect,parent:LiquidRect,amount:number,index:number):LiquidRect {
  const p=Math.max(0,Math.min(1,amount)),travel=easeBetween(0,1,p);
  const from={x:parent.x+parent.width*.58,y:parent.y+parent.height*.63};
  const to={x:target.x+target.width/2,y:target.y+target.height/2};
  const bend=Math.sin(p*Math.PI)*(index%2===0?1:-1)*Math.min(34,Math.hypot(to.x-from.x,to.y-from.y)*.12);
  const width=target.width*(.12+.88*p),height=target.height*(.12+.88*p)*(1+.1*Math.sin(p*Math.PI));
  return {x:from.x+(to.x-from.x)*travel+bend-width/2,y:from.y+(to.y-from.y)*travel-height/2,width,height};
}
