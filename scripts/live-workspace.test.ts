import { expect, test } from "bun:test";
import { paneCrop, paneViewport, readLiveFrame } from "../src/components/prototype/vgpu/live/frames";
import { canAutoGrow } from "../src/components/prototype/vgpu/live/automation";
import { advanceSpring, buddingRect, distanceToRect } from "../src/components/prototype/vgpu/live/living";

const frame = {cols:120,rows:24,panes:[{id:"@1",x:0,y:0,cols:59,rows:24,cursorRow:3},{id:"@2",x:60,y:0,cols:60,rows:24,cursorRow:23}]};
test("real published pane geometry preserves separators and independent resources",()=>{
  expect(readLiveFrame(frame)).toEqual(frame);
  expect(paneCrop(frame,frame.panes[1],1200,480,8)).toEqual({x:600,y:320,w:600,h:160});
  expect(paneCrop(frame,frame.panes[0],1200,480,12)).toEqual({x:0,y:0,w:590,h:240});
});
test("projection follows the actual cursor while clamping to the real pane",()=>{
  for(let cursorRow=0;cursorRow<24;cursorRow++) {
    const pane={...frame.panes[1],cursorRow};
    const crop=paneCrop(frame,pane,1200,480,8);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.y+crop.h).toBeLessThanOrEqual(480);
    expect(cursorRow*20).toBeGreaterThanOrEqual(crop.y);
    expect(cursorRow*20).toBeLessThan(crop.y+crop.h);
  }
});
test("malformed or stale out-of-bounds pane announcements never reach drawImage",()=>{
  const invalid = [null,{}, {...frame,cols:NaN},{...frame,rows:0},{...frame,panes:[{...frame.panes[0],x:-1}]},{...frame,panes:[{...frame.panes[0],cols:121}]},{...frame,panes:[frame.panes[0],frame.panes[0]]},{...frame,panes:[{...frame.panes[0],cursorRow:24}]},{...frame,panes:Array(5).fill(frame.panes[0])}];
  invalid.forEach(value=>expect(readLiveFrame(value)).toBeNull());
});
test("opening one real resource fits its columns without allocating a new pane",()=>{
  expect(paneViewport(frame,frame.panes[1],480,272,{width:9,height:16})).toEqual({cols:106,rows:17});
  expect(paneViewport(frame,frame.panes[0],480,272,{width:9,height:16})).toEqual({cols:107,rows:17});
  expect(paneViewport(frame,frame.panes[0],50000,50000,{width:9,height:16})).toEqual({cols:480,rows:120});
});
test("automatic branching stops permanently after someone enters a terminal",()=>{
  const state={phase:"live",pending:false,panes:[{},{}]};
  expect(canAutoGrow(state,false)).toBe(true);
  expect(canAutoGrow(state,true)).toBe(false);
  expect(canAutoGrow({...state,pending:true},false)).toBe(false);
  expect(canAutoGrow({...state,phase:"closed"},false)).toBe(false);
  expect(canAutoGrow({...state,panes:[{},{},{}]},false)).toBe(false);
});

test("liquid springs converge equally at 30, 60 and 120 Hz and reverse without jumping",()=>{
  const results=[30,60,120].map(hz=>{
    let spring={position:0,velocity:0};
    for(let i=0;i<hz;i++)spring=advanceSpring(spring,1,1/hz);
    expect(spring.position).toBeGreaterThan(.998);
    const before=spring.position;
    spring=advanceSpring(spring,0,1/hz);
    expect(Math.abs(spring.position-before)).toBeLessThan(.05);
    for(let i=0;i<hz*2;i++)spring=advanceSpring(spring,0,1/hz);
    expect(Math.abs(spring.position)).toBeLessThan(.000001);
    return spring.position;
  });
  expect(Math.max(...results)-Math.min(...results)).toBeLessThan(.000001);
});
test("a living pane starts within its parent and settles into its exact organized slot",()=>{
  const parent={x:40,y:50,width:600,height:240},slot={x:680,y:180,width:280,height:160};
  const bud=buddingRect(slot,parent,0,0);
  expect(distanceToRect(bud.x+bud.width/2,bud.y+bud.height/2,parent)).toBe(0);
  expect(bud.width).toBeLessThan(slot.width*.15);
  expect(buddingRect(slot,parent,1,0)).toEqual(slot);
  for(let i=0;i<=100;i++){
    const rect=buddingRect(slot,parent,i/100,1);
    expect(rect.width).toBeGreaterThan(0);expect(rect.height).toBeGreaterThan(0);
  }
});
