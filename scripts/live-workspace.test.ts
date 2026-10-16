import { expect, test } from "bun:test";
import { paneCrop, paneViewport, readLiveFrame } from "../src/components/prototype/vgpu/live/frames";
import { canAutoGrow } from "../src/components/prototype/vgpu/live/automation";

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
