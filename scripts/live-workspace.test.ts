import { expect, test } from "bun:test";
import { paneCrop, paneViewport, paneInsets, readLiveFrame } from "../src/components/prototype/vgpu/live/frames";
import { canAutoGrow } from "../src/components/prototype/vgpu/live/automation";
import { advanceRect, advanceSpring, buddingRect, distanceToRect, liquidNeck } from "../src/components/prototype/vgpu/live/living";
import { LiveWorkspace } from "../src/components/prototype/vgpu/live/workspace";
import type { MountOptions, PhuxController } from "../src/components/terminal/core";

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
  const invalid = [null,{}, {...frame,cols:NaN},{...frame,rows:0},{...frame,panes:[{...frame.panes[0],x:-1}]},{...frame,panes:[{...frame.panes[0],cols:121}]},{...frame,panes:[frame.panes[0],frame.panes[0]]},{...frame,panes:Array(5).fill(frame.panes[0])}];
  invalid.forEach(value=>expect(readLiveFrame(value)).toBeNull());
});

test("resize accepts real geometry while old cursor metadata waits for reflow",()=>{
  const resized={cols:120,rows:17,panes:frame.panes.map(p=>({...p,rows:17,cursorRow:23}))};
  const accepted=readLiveFrame(resized)!;
  expect(accepted.rows).toBe(17);
  expect(accepted.panes.map(p=>p.cursorRow)).toEqual([16,16]);
  const crop=paneCrop(accepted,accepted.panes[1],1200,340,8);
  expect(crop.y+crop.h).toBeLessThanOrEqual(340);
  expect(readLiveFrame({...resized,panes:[{...resized.panes[0],cursorRow:NaN}]})).not.toBeNull();
});
test("opening one real resource fits its columns without allocating a new pane",()=>{
  expect(paneViewport(frame,frame.panes[1],480,272,{width:9,height:16})).toEqual({cols:106,rows:17});
  expect(paneViewport(frame,frame.panes[0],480,272,{width:9,height:16})).toEqual({cols:107,rows:17});
  expect(paneViewport(frame,frame.panes[0],50000,50000,{width:9,height:16})).toEqual({cols:480,rows:120});
});
test("a deep split at the total grid limit never reveals neighboring resources",()=>{
  const frame={cols:480,rows:19,panes:[]},pane={id:"@4",x:180,y:0,cols:59,rows:19};
  const cell={width:9,height:16},inset=paneInsets(frame,pane,cell);
  expect(inset).toEqual({left:1620,top:0,right:2169,bottom:0});
  expect(frame.cols*cell.width-inset.left-inset.right).toBe(pane.cols*cell.width);
  expect(frame.rows*cell.height-inset.top-inset.bottom).toBe(pane.rows*cell.height);
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
  expect(bud.x).toBeGreaterThanOrEqual(parent.x);
  expect(bud.y).toBeGreaterThanOrEqual(parent.y);
  expect(bud.x+bud.width).toBeLessThanOrEqual(parent.x+parent.width);
  expect(bud.y+bud.height).toBeLessThanOrEqual(parent.y+parent.height);
  expect(buddingRect(slot,parent,1,0)).toEqual(slot);
  for(let i=0;i<=100;i++){
    const rect=buddingRect(slot,parent,i/100,1);
    expect(rect.width).toBeGreaterThan(0);expect(rect.height).toBeGreaterThan(0);
  }
});

test("liquid necks remain attached throughout pull and merge across responsive slots",()=>{
  const parent={x:40,y:50,width:600,height:240};
  for(const slot of [{x:680,y:180,width:280,height:160},{x:40,y:340,width:280,height:160},{x:340,y:340,width:280,height:160}]){
    for(let i=1;i<=100;i++){
      const child=buddingRect(slot,parent,i/100,0),neck=liquidNeck(parent,child,i/100);
      expect(distanceToRect(neck.a.x,neck.a.y,parent)).toBe(0);
      expect(distanceToRect(neck.b.x,neck.b.y,child)).toBe(0);
      expect(neck.radius).toBeGreaterThanOrEqual(3.5);
      expect(neck.radius).toBeLessThanOrEqual(35.5);
    }
  }
  expect(liquidNeck(parent,parent,0).radius).toBe(3.5);
  expect(liquidNeck(parent,parent,.5).radius).toBeGreaterThan(20);
});

test("adding a sibling retargets an existing pane continuously into its new slot",()=>{
  const original={x:30,y:450,width:250,height:160},target={x:300,y:450,width:250,height:160};
  let state={rect:original,velocity:{x:0,y:0,width:0,height:0}};
  expect(advanceRect(state,target,0).rect).toEqual(original);
  state=advanceRect(state,target,1/60);
  expect(state.rect.x).toBeGreaterThan(original.x);expect(state.rect.x).toBeLessThan(original.x+4);
  for(let i=0;i<180;i++)state=advanceRect(state,target,1/60);
  expect(state.rect.x).toBeCloseTo(target.x,6);
  expect(state.rect.width).toBe(target.width);expect(state.rect.height).toBe(target.height);
});

// Exercise the actual controller with delayed wire announcements and paints.
// The DOM shell is minimal; focus, commands, session and layout all use production code.
class TestNode extends EventTarget {
  dataset:Record<string,string>={}; children:TestNode[]=[]; inert=false; id=""; tabIndex=0; className="";
  clientWidth=480;clientHeight=272;
  style={transform:"",removeProperty(_key:string){this.transform="";}};
  setAttribute(_name:string,_value:string){}
  append(node:TestNode){this.children.push(node);}
  replaceChildren(...nodes:TestNode[]){this.children=nodes;}
  remove(){}
  focus(_options?:unknown){}
}
async function workspaceHarness(run:(h:{workspace:LiveWorkspace;home:TestNode;target:TestNode;canvas:()=>TestNode;announce:(focused:string,pending:boolean,error?:string)=>void;paint:(count:number)=>void;flush:()=>void;disconnect:()=>void;calls:{splits:number;closes:number;mounts:number;focus:string;input:{id:string;text:string}[];sizes:{cols:number;rows:number}[]}})=>Promise<void>|void){
  const previous=new Map<string,PropertyDescriptor|undefined>();
  const install=(name:string,value:unknown)=>{previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});};
  const doc=Object.assign(new EventTarget(),{hidden:false,createElement:()=>new TestNode()});
  const frames=new Map<number,FrameRequestCallback>();let serial=0;
  let mutation:()=>void=()=>{};
  class Observer {constructor(callback:()=>void){mutation=callback;}observe(){}disconnect(){mutation=()=>{};}}
  install("document",doc);install("window",new EventTarget());
  install("MutationObserver",Observer);install("ResizeObserver",class {observe(){}disconnect(){}});
  install("requestAnimationFrame",(callback:FrameRequestCallback)=>{frames.set(++serial,callback);return serial;});
  install("cancelAnimationFrame",(id:number)=>frames.delete(id));
  const home=new TestNode(),target=new TestNode();
  const calls={splits:0,closes:0,mounts:0,focus:"@1",input:[] as {id:string;text:string}[],sizes:[] as {cols:number;rows:number}[]};
  const canvas=()=>home.children[0]?.children[0]||target.children[0]?.children[0];
  let source:TestNode;
  const dispatch=(name:string,detail:unknown)=>{const event=new Event(name);Object.defineProperty(event,"detail",{value:detail});source.dispatchEvent(event);};
  const announce=(focused:string,pending:boolean,error="")=>{calls.focus=focused;dispatch("phux-panes",{focused,pending,error});};
  const paint=(count:number)=>dispatch("phux-render",{cols:120,rows:24,panes:Array.from({length:count},(_,i)=>({id:`@${i+1}`,x:i*30,y:0,cols:29,rows:24,cursorRow:23}))});
  const controller:PhuxController={close(){calls.closes++;},resize(cols,rows){calls.sizes.push({cols,rows});},splitPane(){calls.splits++;announce(calls.focus,true);},focusPane(id){announce(id,false);},sendText(text){calls.input.push({id:calls.focus,text});},focusNextPane(){},closePane(){},sendKey(){},setCtrlLatch(){}};
  const workspace=new LiveWorkspace(async(options:MountOptions)=>{calls.mounts++;source=home.children[0].children[0];source.dataset={phuxCellWidth:"9",phuxCellHeight:"16",phuxConnection:"connected"};options.onEvent?.({type:"phux.session.v1",outcome:"accepted",backend:"edge",expiresAt:1800000000000});return controller;});
  try {
    await workspace.start(home as unknown as HTMLDivElement,"ws://test.invalid/session");
    announce("@1",false);paint(2);
    await run({workspace,home,target,canvas,announce,paint,flush(){const queue=[...frames.values()];frames.clear();queue.forEach(fn=>fn(100));},disconnect(){source.dataset.phuxConnection="disconnected";mutation();},calls});
  }finally{
    workspace.dispose();
    previous.forEach((descriptor,name)=>{if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);});
  }
}

test("rapid splits are one atomic operation through the first real painted child",()=>workspaceHarness(h=>{
  const restore=h.workspace.present("@1",h.target as unknown as HTMLDivElement);h.flush();
  h.workspace.split();h.workspace.split();
  h.workspace.focus("@2");h.workspace.command("echo must-wait");
  expect(h.calls.splits).toBe(1);
  expect(h.calls.focus).toBe("@1");
  expect(h.calls.input.some(p=>p.text.includes("must-wait"))).toBe(false);
  expect(h.target.children[0].inert).toBe(true);
  h.announce("@3",false);
  expect(h.workspace.getSnapshot().pending).toBe(true);
  expect(h.workspace.getSnapshot().focused).toBe("@1");
  h.paint(3);h.flush();
  expect(h.workspace.getSnapshot()).toMatchObject({pending:false,focused:"@3",parents:{"@3":"@1"}});
  expect(h.target.children[0].inert).toBe(false);
  h.workspace.focus("@2");h.workspace.command("echo destination");
  expect(h.calls.input.at(-1)).toEqual({id:"@2",text:"echo destination\n"});
  expect(h.calls.mounts).toBe(1);
  expect(h.calls.sizes.length).toBeLessThanOrEqual(2);
  restore();h.flush();
  expect(h.calls.sizes.at(-1)).toEqual({cols:120,rows:24});
}));

test("closing during a delayed split restores the same session and permits another split",()=>workspaceHarness(h=>{
  const restore=h.workspace.present("@2",h.target as unknown as HTMLDivElement);h.flush();
  h.workspace.split();restore();h.flush();
  h.announce("@3",false);h.paint(3);h.flush();
  expect(h.calls.sizes.at(-1)).toEqual({cols:120,rows:24});
  const restoreAgain=h.workspace.present("@1",h.target as unknown as HTMLDivElement);h.flush();
  h.workspace.split();h.announce("@4",false);h.paint(4);h.flush();
  expect(h.workspace.getSnapshot()).toMatchObject({pending:false,focused:"@4",parents:{"@3":"@2","@4":"@1"}});
  h.workspace.split();expect(h.calls.splits).toBe(2);
  expect(h.calls.mounts).toBe(1);expect(h.calls.closes).toBe(0);
  restoreAgain();
}));

test("failed split releases the operation lock without changing the selected pane",()=>workspaceHarness(h=>{
  h.workspace.split();h.announce("@1",false,"Split unavailable");
  expect(h.workspace.getSnapshot()).toMatchObject({pending:false,focused:"@1",error:"Split unavailable"});
  h.workspace.focus("@2");h.workspace.command("echo still-here");
  expect(h.calls.input.at(-1)?.id).toBe("@2");
  h.workspace.split();expect(h.calls.splits).toBe(2);
}));

test("a failed split restores home dimensions even without another painted frame",()=>workspaceHarness(h=>{
  const restore=h.workspace.present("@1",h.target as unknown as HTMLDivElement);h.flush();
  h.workspace.split();restore();h.flush();
  expect(h.calls.sizes.at(-1)).not.toEqual({cols:120,rows:24});
  h.announce("@1",false,"Split unavailable");h.flush();
  expect(h.calls.sizes.at(-1)).toEqual({cols:120,rows:24});
  expect(h.workspace.getSnapshot().pending).toBe(false);
}));

test("internal client disconnect becomes a recoverable closed workspace",()=>workspaceHarness(async h=>{
  h.workspace.present("@1",h.target as unknown as HTMLDivElement);h.flush();
  h.workspace.split();h.disconnect();
  expect(h.workspace.getSnapshot()).toMatchObject({phase:"closed",pending:false});
  expect(h.target.children[0].inert).toBe(true);
  h.workspace.focus("@2");h.workspace.command("echo closed");h.workspace.split();h.flush();
  expect(h.calls.splits).toBe(1);expect(h.calls.closes).toBe(1);
  const old=h.canvas();
  await h.workspace.start(h.home as unknown as HTMLDivElement,"ws://test.invalid/session");
  const event=new Event("phux-panes");Object.defineProperty(event,"detail",{value:{focused:"stale",pending:true}});old.dispatchEvent(event);
  expect(h.workspace.getSnapshot()).toMatchObject({phase:"live",pending:false,panes:[]});
  expect(h.calls.mounts).toBe(2);
}));
