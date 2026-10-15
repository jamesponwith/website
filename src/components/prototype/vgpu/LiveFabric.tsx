import GhosttySurface from "./GhosttySurface";
import { workloadFrame, snapshotFrame } from "./terminal-frames";
import { sceneFetch, retainSceneTransport, isBrowserConcept } from "./transport";
import { createFabricLayout, fabricGeometryMoved, nearestFabricSlot, reserveFabricOrder, swapFabricOrder, type FabricLayout, type Rect, type WireRoute } from "./fabric-layout";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
export type FabricHost={id:string;name:string;pid?:number;workerId?:string;engine?:"browser"|"native";logical?:boolean;local:boolean;status?:string;parentHostId?:string|null};
export type FabricSession={id:string;hostId:string;name:string;kind:string;pid?:number;workerId?:string;engine?:"browser"|"native";ticks:number;paused:boolean;connected:boolean;metrics:Record<string,unknown>;lastCommand?:string;recentlines?:string[];parentSessionId?:string|null};
type FabricState={hosts:FabricHost[];sessions:FabricSession[]};
const empty:FabricState={hosts:[],sessions:[]};
export function useFabric(){
 const [state,setState]=useState<FabricState>(empty),[pending,setPending]=useState(false),[error,setError]=useState("");
 const cursor=useRef(0),revision=useRef(''),busy=useRef(false),generation=useRef(0);
 const ingest=(next:FabricState&{revision?:string;eventCursor?:number})=>{
  revision.current=next.revision||'';cursor.current=next.eventCursor||0;
  setState(previous=>({...next,sessions:next.sessions.map(session=>({...session,recentlines:session.recentlines||previous.sessions.find(s=>s.id===session.id)?.recentlines}))}));
 };
 useEffect(()=>{
  const release=retainSceneTransport();
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,inFlight=false;
  const poll=async()=>{
   if(abort.signal.aborted||document.hidden||inFlight)return;
   inFlight=true;const requestGeneration=generation.current;
   try{
    const query=new URLSearchParams({compact:'1',after:String(cursor.current),revision:revision.current});
    const response=await sceneFetch(`/__scene/fabric?${query}`,{signal:abort.signal});
    if(!response.ok)throw Error('Fabric unavailable');
    if(response.status!==204){const next=await response.json();if(!abort.signal.aborted&&requestGeneration===generation.current)ingest(next);}
   }catch{if(!abort.signal.aborted&&requestGeneration===generation.current){revision.current='';setState(s=>({...s,hosts:s.hosts.map(h=>({...h,status:'unknown'})),sessions:s.sessions.map(n=>({...n,connected:false}))}));}}
   finally{inFlight=false;if(!abort.signal.aborted&&!document.hidden)timer=setTimeout(poll,500);}
  };
  const visible=()=>{clearTimeout(timer);if(!document.hidden)void poll();};
  document.addEventListener('visibilitychange',visible);void poll();
  return()=>{abort.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible);release();};
 },[]);
 async function mutate(path:string,body:unknown,method='POST'){
  const response=await sceneFetch(`/__scene/fabric/${path}`,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'The process could not start.');return result;
 }
 async function act(task:()=>Promise<unknown>){
  if(busy.current)return;busy.current=true;generation.current++;setPending(true);setError('');
  try{await task();generation.current++;const response=await sceneFetch('/__scene/fabric?compact=1');if(response.ok)ingest(await response.json());return true;}
  catch(e){setError(e instanceof Error?e.message:'Native process unavailable');return false;}
  finally{busy.current=false;setPending(false);}
 }
 const addSession=(hostId='studio',parentSessionId?:string)=>act(()=>mutate('session',{hostId,parentSessionId,kind:state.sessions.filter(s=>s.id!=='scene').length%2?'signals':'compute'}));
 const addHost=(parentHostId=state.hosts.at(-1)?.id||'studio')=>act(()=>mutate('host',{parentHostId}));
 const command=(sessionId:string,action:string)=>act(()=>mutate('command',{sessionId,action}));
 const removeSession=(sessionId:string)=>act(()=>mutate('session',{sessionId},'DELETE'));
 const removeHost=(hostId:string)=>act(()=>mutate('host',{hostId},'DELETE'));
 const activate=()=>act(async()=>{await mutate('session',{hostId:'studio',kind:'compute'});await mutate('session',{hostId:'studio',kind:'signals'});await mutate('host',{parentHostId:'studio'});});
 return{state,pending,error,addSession,addHost,command,removeSession,removeHost,activate};
}
export type FabricControl=ReturnType<typeof useFabric>;
// Keep departing geometry briefly so an acknowledged teardown can finish visually.
function usePresence<T extends {id:string}>(current:T[]){
 const previous=useRef(current),painted=useRef(current),[departing,setDeparting]=useState<T[]>([]);
 const timers=useRef(new Map<string,ReturnType<typeof setTimeout>>());
 const latest=useRef(current);latest.current=current;
 const identity=current.map(item=>item.id).join('|');
 useEffect(()=>{
  const ids=new Set(latest.current.map(item=>item.id));
  const removed=previous.current.filter(item=>!ids.has(item.id));
  previous.current=latest.current;
  let returned=false;
  for(const id of ids){const timer=timers.current.get(id);if(timer){clearTimeout(timer);timers.current.delete(id);returned=true;}}
  if(!removed.length&&!returned)return;
  const removedIds=new Set(removed.map(item=>item.id));
  setDeparting(items=>[...items.filter(item=>!ids.has(item.id)&&!removedIds.has(item.id)),...removed]);
  for(const item of removed){
   clearTimeout(timers.current.get(item.id));
   timers.current.set(item.id,setTimeout(()=>{timers.current.delete(item.id);setDeparting(items=>items.filter(candidate=>candidate.id!==item.id));},1050));
  }
 },[identity]);
 useEffect(()=>{previous.current=current;});
 useEffect(()=>()=>{timers.current.forEach(clearTimeout);},[]);
 const lingering=[...departing,...previous.current.filter(item=>!departing.some(d=>d.id===item.id))];
 painted.current=reserveFabricOrder(painted.current,current,lingering);
 return painted.current;
}
function fabricViewportWindow(): Window {
 // An expanded iframe is content height, never the viewport baseline for layout.
 try {
  if(new URLSearchParams(location.search).get('embedded')==='home'&&window.parent.location.origin===location.origin)return window.parent;
 } catch { /* A cross-origin embed retains its own viewport. */ }
 return window;
}
export function useFabricLayout(state:FabricState){
 const hosts=usePresence(state.hosts),sessions=usePresence(state.sessions);
 const [size,setSize]=useState(()=>({w:typeof window==='undefined'?1280:document.documentElement.clientWidth,h:typeof window==='undefined'?800:fabricViewportWindow().innerHeight}));
 const [order,setOrder]=useState<Record<string,string[]>>({});
 useEffect(()=>{
  const viewport=fabricViewportWindow();
  const resize=()=>{const w=document.documentElement.clientWidth,h=viewport.innerHeight;setSize(previous=>previous.w===w&&previous.h===h?previous:{w,h});};
  const message=(event:MessageEvent)=>{if(event.origin===location.origin&&event.source===window.parent&&event.data?.type==='phux:hero-viewport')resize();};
  const observer=new ResizeObserver(resize);observer.observe(document.documentElement);window.addEventListener('resize',resize);window.addEventListener('message',message);resize();
  return()=>{observer.disconnect();window.removeEventListener('resize',resize);window.removeEventListener('message',message);};
 },[]);
 const identity=JSON.stringify([hosts.map(h=>[h.id,h.parentHostId]),sessions.map(s=>[s.id,s.hostId,s.parentSessionId])]);
 const topology=useMemo(()=>({hosts,sessions}),[identity]);
 const layout=useMemo(()=>createFabricLayout(topology.hosts,topology.sessions,size,order),[topology,size,order]);
 const reorder=(from:string,to:string)=>{const change=swapFabricOrder(layout,from,to);if(change)setOrder(previous=>({...Object.fromEntries(Object.entries(previous).filter(([host])=>layout.groups.has(host))),[change.hostId]:change.ids}));};
 return {layout,reorder};
}
type Edge={id:string;route:WireRoute;session?:FabricSession;leaving:boolean;collapsed:boolean};
const FabricWire=memo(function FabricWire({edge}:{edge:Edge}){
 const d=edge.route.path,alive=Boolean(edge.session?.connected&&!edge.session.paused&&!edge.leaving&&!edge.collapsed);
 const wireId=`fabric-wire-${edge.id}`;
 return <g className={`wire-link ${alive?'wire-alive':''} ${edge.leaving?'wire-leaving':''} ${edge.collapsed?'wire-detached':''}`} data-wire-id={edge.id} data-wire-state={edge.leaving?'teardown':edge.collapsed?'detached':alive?'flowing':'idle'}>
  <path d={d} pathLength="1" className="fabric-wire-halo wire-growth"/>
  <path id={wireId} d={d} pathLength="1" className="fabric-wire wire-growth"/>
  <circle cx={edge.route.start.x} cy={edge.route.start.y} r="3" className="wire-socket socket-source"/>
  <circle cx={edge.route.end.x} cy={edge.route.end.y} r="3" className="wire-socket socket-target"/>
  <circle cx={edge.route.end.x} cy={edge.route.end.y} r="10" className="wire-attach-ring"/>

 </g>;
},(a,b)=>a.edge.id===b.edge.id&&a.edge.route.path===b.edge.route.path&&a.edge.leaving===b.edge.leaving&&a.edge.collapsed===b.edge.collapsed&&a.edge.session?.paused===b.edge.session?.paused&&a.edge.session?.connected===b.edge.session?.connected);
function WirePacket({edge,index}:{edge:Edge;index:number}){
 if(!edge.session?.connected||edge.session.paused||edge.leaving||edge.collapsed)return null;
 const style={offsetPath:`path("${edge.route.path}")`,'--packet-delay':`${.7+index%4*.18}s`} as CSSProperties;
 return <span className="wire-packet" style={style} aria-hidden="true"><i/><b>{edge.session.ticks.toString(2).padStart(8,'0').slice(-8)}</b><em/></span>;
}
export default function LiveFabric({fabric,layout,reorder,attached=true,revealedIds}:{fabric:FabricControl;layout:FabricLayout;reorder:(from:string,to:string)=>void;attached?:boolean;revealedIds?:Set<string>}){
 const [hidden,setHidden]=useState<Set<string>>(new Set());
 const [selected,setSelected]=useState<string|null>(null),[selectedHost,setSelectedHost]=useState<string|null>(null);
 const [detail,setDetail]=useState<FabricSession|null>(null);
 const selectionExists=Boolean(selected&&fabric.state.sessions.some(s=>s.id===selected));
 const hostSelectionExists=Boolean(selectedHost&&fabric.state.hosts.some(h=>h.id===selectedHost));
 useEffect(()=>{if(selected&&!selectionExists){setSelected(null);setDetail(null);}if(selectedHost&&!hostSelectionExists)setSelectedHost(null);},[selected,selectionExists,selectedHost,hostSelectionExists]);
 const wires=useRef<SVGSVGElement>(null),packets=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const element=wires.current;if(!element)return;
  let onScreen=true;
  const sync=()=>{const sleep=document.hidden||!onScreen;element.classList.toggle('fabric-sleeping',sleep);packets.current?.classList.toggle('fabric-sleeping',sleep);if(sleep)element.pauseAnimations();else element.unpauseAnimations();};
  const observer=new IntersectionObserver(entries=>{onScreen=entries[0]?.isIntersecting??false;sync();});
  observer.observe(element);document.addEventListener('visibilitychange',sync);sync();
  return()=>{observer.disconnect();document.removeEventListener('visibilitychange',sync);};
 },[]);
 useEffect(()=>{
  setDetail(null);if(!selected||!selectionExists)return;
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   if(document.hidden){timer=setTimeout(poll,1000);return;}
   try{const response=await sceneFetch(`/__scene/fabric/session?sessionId=${encodeURIComponent(selected)}`,{signal:abort.signal});if(response.ok){const result=await response.json();if(!abort.signal.aborted)setDetail(result.session||result);}}catch{}
   if(!abort.signal.aborted)timer=setTimeout(poll,1000);
  };
  void poll();return()=>{abort.abort();clearTimeout(timer);};
 },[selected,selectionExists]);
 const [snapTarget,setSnapTarget]=useState<string|null>(null);
 const drag=useRef<{id:string;target:string;node:HTMLElement;world:HTMLElement;place:Rect;x:number;y:number}|null>(null);
 const settle=useRef<ReturnType<typeof setTimeout>>(undefined);
 const startDrag=(e:PointerEvent<HTMLButtonElement>,id:string,place:Rect)=>{
  if(e.button!==0)return;
  e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);clearTimeout(settle.current);
  const node=e.currentTarget.closest<HTMLElement>('.fabric-node')!,world=node.closest<HTMLElement>('.fabric-world')!;
  drag.current={id,target:id,node,world,place,x:e.clientX,y:e.clientY};
  node.classList.add('node-dragging');world.dataset.arranging='dragging';setSnapTarget(id);
 };
 const moveDrag=(e:PointerEvent<HTMLButtonElement>)=>{
  const d=drag.current;if(!d)return;
  const dx=e.clientX-d.x,dy=e.clientY-d.y;
  d.node.style.transform=`translate3d(${dx}px,${dy}px,0)`;
  const target=nearestFabricSlot(layout,d.id,{x:d.place.x+d.place.w/2+dx,y:d.place.y+d.place.h/2+dy});
  if(target!==d.target){d.target=target;setSnapTarget(target);}
 };
 const finishDrag=(cancelled=false)=>{
  const d=drag.current;if(!d)return;
  d.node.style.transform='';d.node.classList.remove('node-dragging');drag.current=null;setSnapTarget(null);
  if(cancelled||d.id===d.target){delete d.world.dataset.arranging;return;}
  reorder(d.id,d.target);d.world.dataset.arranging='settling';
  settle.current=setTimeout(()=>{delete d.world.dataset.arranging;},450);
 };
 const reorderKey=(e:React.KeyboardEvent<HTMLButtonElement>,id:string)=>{
  const direction=({ArrowUp:-1,ArrowDown:1} as Record<string,number>)[e.key];if(!direction)return;
  e.preventDefault();const members=[...layout.members.values()].find(ids=>ids.includes(id))||[];
  const target=members[members.indexOf(id)+direction];if(target)reorder(id,target);
 };
 const previousLayout=useRef(layout),routingTimer=useRef<ReturnType<typeof setTimeout>>(undefined);
 useLayoutEffect(()=>{
  const previous=previousLayout.current;previousLayout.current=layout;
  if(!fabricGeometryMoved(previous,layout))return;
  finishDrag(true);
  const world=wires.current?.closest<HTMLElement>('.fabric-world');if(!world)return;
  clearTimeout(routingTimer.current);world.dataset.routing='settling';
  routingTimer.current=setTimeout(()=>{delete world.dataset.routing;},450);
 },[layout]);
 useEffect(()=>{
  const cancel=()=>finishDrag(true),visibility=()=>{if(document.hidden)cancel();};
  window.addEventListener('blur',cancel);window.addEventListener('scroll',cancel,true);document.addEventListener('visibilitychange',visibility);
  return()=>{cancel();clearTimeout(settle.current);clearTimeout(routingTimer.current);window.removeEventListener('blur',cancel);window.removeEventListener('scroll',cancel,true);document.removeEventListener('visibilitychange',visibility);const world=wires.current?.closest<HTMLElement>('.fabric-world');if(world){delete world.dataset.arranging;delete world.dataset.routing;}};
 },[]);
 const sessionIdentity=fabric.state.sessions.map(session=>session.id).join('|');
 useEffect(()=>{
  const current=drag.current;if(!current)return;
  if(!fabric.state.sessions.some(session=>session.id===current.id)||hidden.has(current.id)||(revealedIds&&!revealedIds.has(current.id)))finishDrag(true);
 },[sessionIdentity,hidden,revealedIds]);
 const allSessions=fabric.state.sessions.filter(s=>s.id!=='scene');
 const activeSessions=allSessions.filter(s=>!revealedIds||revealedIds.has(s.id));
 const wantedHosts=new Set(['studio',...activeSessions.map(s=>s.hostId)]);
 for(const host of fabric.state.hosts){let parent=host;if(!wantedHosts.has(host.id))continue;while(parent.parentHostId){wantedHosts.add(parent.parentHostId);const ancestor=fabric.state.hosts.find(h=>h.id===parent.parentHostId);if(!ancestor)break;parent=ancestor;}}
 const activeHosts=fabric.state.hosts.filter(h=>wantedHosts.has(h.id));
 const sessions=usePresence(activeSessions),hosts=usePresence(activeHosts);
 const activeSessionIds=new Set(activeSessions.map(s=>s.id)),activeHostIds=new Set(activeHosts.map(h=>h.id));
 const placed=sessions.flatMap(session=>{const place=layout.sessions.get(session.id);return place?[{session,place}]:[];});
 const hostBox=(id:string)=>layout.hosts.get(id)!;
 const edges:Edge[]=[...hosts.map(host=>({id:`host-${host.id}`,route:layout.routes.get(`host-${host.id}`)!,session:sessions.find(s=>s.hostId===host.id),leaving:!activeHostIds.has(host.id),collapsed:host.id==='studio'&&!attached})),...placed.map(({session})=>({id:session.id,route:layout.routes.get(session.id)!,session,leaving:!activeSessionIds.has(session.id),collapsed:hidden.has(session.id)}))].filter(edge=>Boolean(edge.route));
 const snapBox=snapTarget&&layout.sessions.get(snapTarget);
 const inspect=allSessions.find(s=>s.id===selected);
 const inspectHost=fabric.state.hosts.find(h=>h.id===selectedHost);
 const inspectLines=inspect?(detail?.id===inspect.id?detail.recentlines||[]:inspect.recentlines||[]).slice(-8):[];
 return <>
  <svg ref={wires} className="fabric-wires" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">{edges.map(edge=><FabricWire key={edge.id} edge={edge}/>)}</svg>
  <div className="fabric-packets" ref={packets}>{edges.map((edge,index)=><WirePacket key={edge.id} edge={edge} index={index}/>)}</div>
  {snapBox&&<div className="fabric-snap-target" style={{left:snapBox.x,top:snapBox.y,width:snapBox.w,height:snapBox.h}} aria-hidden="true"/>}
  {hosts.filter(host=>layout.hosts.has(host.id)).map(host=>{const p=hostBox(host.id);return <div className={`fabric-host ${!activeHostIds.has(host.id)?"host-leaving":host.status!=="active"?"host-offline":""}`} key={host.id} style={{left:p.x,top:p.y,width:p.w,height:p.h}} data-host-id={host.id}><i className="host-core"/><button className="host-identity" aria-label={`Inspect ${host.name}`} onClick={()=>setSelectedHost(host.id)}>{host.name}<small>{host.status==="unknown"?"UNREACHABLE":host.status==="stopped"?"STOPPED":isBrowserConcept?"LOGICAL GROUP":"LOCAL HOST"} {host.pid?`· ${host.pid}`:""}</small></button><button title={isBrowserConcept?"Add a browser workload to this group":"Activate a session on this host"} aria-label={`${isBrowserConcept?"Add workload on":"Add session on"} ${host.name}`} onClick={()=>void fabric.addSession(host.id)} disabled={fabric.pending||host.status!=="active"}>＋</button><button title={isBrowserConcept?"Create a logical group from here":"Activate another host from here"} aria-label={`${isBrowserConcept?"Branch group from":"Branch host from"} ${host.name}`} onClick={()=>void fabric.addHost(host.id)} disabled={fabric.pending||host.status!=="active"}>↗</button></div>;})}
  {placed.map(({session,place},i)=>{const isHidden=hidden.has(session.id);return <div key={session.id} className={`fabric-node ${session.connected?'node-connected':''} ${session.paused?'node-paused':''} ${isHidden?'node-collapsed':''} ${!activeSessionIds.has(session.id)?'node-leaving':''}`} style={{left:place.x,top:place.y,width:place.w,height:place.h,'--node-delay':'.45s'} as CSSProperties} data-session-id={session.id} data-host-id={session.hostId} data-native-pid={session.pid}>
   {isHidden?<button className="node-restore" aria-label={`Reopen ${session.name}`} onClick={()=>setHidden(h=>{const next=new Set(h);next.delete(session.id);return next;})}>◈</button>:<><div className="node-heading"><button className="node-drag" onPointerDown={e=>startDrag(e,session.id,place)} onPointerMove={moveDrag} onPointerUp={()=>finishDrag()} onPointerCancel={()=>finishDrag(true)} onLostPointerCapture={()=>finishDrag(true)} onKeyDown={e=>reorderKey(e,session.id)} title="Drag to a slot · ↑ ↓ to reorder" aria-label={`Arrange ${session.name}`}>⠿</button><button className="node-name" onClick={()=>setSelected(session.id)} title={isBrowserConcept?"Inspect browser worker task":"Inspect live process"}><i className={session.connected?'status-dot':'status-dot offline'}/>{session.name}</button><button className="node-close hover-control" aria-label={`Close view of ${session.name}`} onClick={()=>setHidden(h=>new Set(h).add(session.id))}>×</button></div><button className="node-live-output" onClick={()=>setSelected(session.id)} aria-label={`Inspect ${session.name} ${isBrowserConcept?"browser workload":"native process"}`}><GhosttySurface vt={workloadFrame(session)} label={`${session.name} live terminal output`} fontSize={9} active={activeSessionIds.has(session.id)}/></button><div className="node-foot"><span>{isBrowserConcept?`WORKER · ${session.workerId||session.id}`:`PID ${session.pid}`}<b>{session.ticks.toLocaleString()}</b></span><div><button title={session.paused?'Resume':'Pause'} aria-label={`${session.paused?'Resume':'Pause'} ${session.name}`} onClick={()=>void fabric.command(session.id,session.paused?'resume':'pause')} disabled={fabric.pending}>{session.paused?'▷':'Ⅱ'}</button><button title="Send pulse" aria-label={`Pulse ${session.name}`} onClick={()=>void fabric.command(session.id,'pulse')} disabled={fabric.pending}>↗</button><button title={isBrowserConcept?"Branch another browser workload":"Branch another real session"} aria-label={`Branch from ${session.name}`} onClick={()=>void fabric.addSession(session.hostId,session.id)} disabled={fabric.pending}>＋</button></div></div></>}
  </div>;})}
  {inspect&&<div className="fabric-inspector" role="dialog" aria-label={`${isBrowserConcept?"Browser worker task":"Live process"} ${inspect.name}`}><header><span><i className={inspect.connected?'status-dot':'status-dot offline'}/>{inspect.name}</span><button onClick={()=>setSelected(null)} aria-label="Close process inspector">×</button></header><div className="inspector-identity"><span>{isBrowserConcept?`WORKER · ${inspect.workerId||inspect.id}`:`PID ${inspect.pid}`}</span><span>{!inspect.connected?'OFFLINE':inspect.paused?'PAUSED':'RUNNING'}</span><span>{inspect.ticks.toLocaleString()} ticks</span></div><GhosttySurface className="inspector-terminal" vt={inspectLines.length?snapshotFrame(inspectLines):workloadFrame(inspect)} label={`${inspect.name} terminal snapshot`} fontSize={11}/><footer><button onClick={()=>void fabric.command(inspect.id,'pulse')} disabled={fabric.pending}>Send pulse ↗</button><button onClick={()=>void fabric.command(inspect.id,inspect.paused?'resume':'pause')} disabled={fabric.pending}>{inspect.paused?'Resume':'Pause'}</button><button className="stop-process" disabled={fabric.pending} onClick={async()=>{if(await fabric.removeSession(inspect.id))setSelected(null);}}>{isBrowserConcept?"Stop workload":"Stop session"}</button></footer></div>}
  {inspectHost&&<div className="fabric-inspector" role="dialog" aria-label={`${isBrowserConcept?"Group":"Host"} ${inspectHost.name}`}><header><span><i className="host-core"/>{inspectHost.name}</span><button onClick={()=>setSelectedHost(null)} aria-label="Close host inspector">×</button></header><div className="inspector-identity"><span>{isBrowserConcept?"BROWSER GROUP":`PID ${inspectHost.pid}`}</span><span>{isBrowserConcept?"LOGICAL GROUP":"LOCAL HOST"}</span><span>{activeSessions.filter(s=>s.hostId===inspectHost.id).length} {isBrowserConcept?"workloads":"sessions"}</span></div><footer><button disabled={fabric.pending} onClick={()=>void fabric.addSession(inspectHost.id)}>{isBrowserConcept?"＋ Workload":"＋ Session"}</button><button disabled={fabric.pending} onClick={()=>void fabric.addHost(inspectHost.id)}>{isBrowserConcept?"＋ Group":"＋ Host"}</button>{inspectHost.id!=='studio'&&<button className="stop-process" disabled={fabric.pending} onClick={async()=>{if(await fabric.removeHost(inspectHost.id))setSelectedHost(null);}}>{isBrowserConcept?"Remove group & branches":"Stop host & branches"}</button>}</footer></div>}
 </>;
}
