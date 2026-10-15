import { sceneFetch, retainSceneTransport, isBrowserConcept } from "./transport";
import { fabricPlaces } from "./useExploration";
import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
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
type Place={x:number;y:number;w:number;h:number};
const positions:Place[]=fabricPlaces;
const positionFor=(slot:number):Place=>positions[slot]||{x:3+(slot-positions.length)%4*23,y:14+Math.floor((slot-positions.length)/4)*19,w:17,h:14};
const hostPosition=(i:number)=>[{x:57,y:48},{x:90,y:29},{x:73,y:53},{x:34,y:71}][i]||{x:35,y:13};
const curve=(a:{x:number;y:number},b:{x:number;y:number},sx=10,sy=10)=>`M${a.x*sx},${a.y*sy} C${(a.x+(b.x-a.x)*.52)*sx},${a.y*sy} ${(a.x+(b.x-a.x)*.48)*sx},${b.y*sy} ${b.x*sx},${b.y*sy}`;
function NativeSignal({session}:{session:FabricSession}){
 const values=Array.isArray(session.metrics?.bins)?session.metrics.bins.slice(0,8).map(Number):Array.from({length:8},(_,i)=>(session.ticks>>i)&1);
 const maximum=Math.max(1,...values.filter(Number.isFinite).map(Math.abs));
 return <div className={`native-glyph glyph-${session.kind}`} aria-label="Live computed samples">{values.map((value,i)=><i key={i} style={{transform:`scaleY(${.2+Math.abs(Number.isFinite(value)?value:0)/maximum*.8})`}}/>)}</div>;
}
// Keep departing geometry briefly so an acknowledged teardown can finish visually.
function usePresence<T extends {id:string}>(current:T[]){
 const previous=useRef(current),[departing,setDeparting]=useState<T[]>([]);
 const timers=useRef(new Set<ReturnType<typeof setTimeout>>());
 const latest=useRef(current);latest.current=current;
 const identity=current.map(item=>item.id).join('|');
 useEffect(()=>{
  const ids=new Set(latest.current.map(item=>item.id));
  const removed=previous.current.filter(item=>!ids.has(item.id));
  previous.current=latest.current;
  if(!removed.length)return;
  setDeparting(items=>[...items.filter(item=>!ids.has(item.id)),...removed]);
  const timer=setTimeout(()=>{timers.current.delete(timer);setDeparting(items=>items.filter(item=>!removed.some(r=>r.id===item.id)));},1050);
  timers.current.add(timer);
 },[identity]);
 useEffect(()=>{previous.current=current;});
 useEffect(()=>()=>{timers.current.forEach(clearTimeout);},[]);
 const lingering=[...departing,...previous.current.filter(item=>!departing.some(d=>d.id===item.id))];
 return [...current,...lingering.filter(item=>!current.some(active=>active.id===item.id))];
}
function useSlots(items:{id:string}[],capacity:number){
 const slots=useRef(new Map<string,number>());
 for(const id of slots.current.keys()){if(!items.some(item=>item.id===id))slots.current.delete(id);}
 for(const item of items){
  const existing=slots.current.get(item.id);
  if(existing!==undefined&&existing<capacity)continue;
  const used=new Set(slots.current.values());let slot=0;while(used.has(slot))slot++;
  if(existing===undefined||slot<capacity)slots.current.set(item.id,slot);
 }
 return slots.current;
}
type Edge={id:string;a:{x:number;y:number};b:{x:number;y:number};session?:FabricSession;leaving:boolean;collapsed:boolean};
const FabricWire=memo(function FabricWire({edge}:{edge:Edge}){
 const d=curve(edge.a,edge.b),alive=Boolean(edge.session?.connected&&!edge.session.paused&&!edge.leaving&&!edge.collapsed);
 const wireId=`fabric-wire-${edge.id}`;
 return <g className={`wire-link ${alive?'wire-alive':''} ${edge.leaving?'wire-leaving':''} ${edge.collapsed?'wire-detached':''}`} data-wire-id={edge.id} data-wire-state={edge.leaving?'teardown':edge.collapsed?'detached':alive?'flowing':'idle'}>
  <path d={d} pathLength="1" className="fabric-wire-halo wire-growth"/>
  <path id={wireId} d={d} pathLength="1" className="fabric-wire wire-growth"/>
  <circle cx={edge.a.x*10} cy={edge.a.y*10} r="3" className="wire-socket socket-source"/>
  <circle cx={edge.b.x*10} cy={edge.b.y*10} r="3" className="wire-socket socket-target"/>
  <circle cx={edge.b.x*10} cy={edge.b.y*10} r="10" className="wire-attach-ring"/>

 </g>;
},(a,b)=>a.edge.id===b.edge.id&&a.edge.leaving===b.edge.leaving&&a.edge.collapsed===b.edge.collapsed&&a.edge.a.x===b.edge.a.x&&a.edge.a.y===b.edge.a.y&&a.edge.b.x===b.edge.b.x&&a.edge.b.y===b.edge.b.y&&a.edge.session?.ticks===b.edge.session?.ticks&&a.edge.session?.paused===b.edge.session?.paused&&a.edge.session?.connected===b.edge.session?.connected);
function WirePacket({edge,size,index}:{edge:Edge;size:{w:number;h:number};index:number}){
 if(!size.w||!edge.session?.connected||edge.session.paused||edge.leaving||edge.collapsed)return null;
 const style={offsetPath:`path("${curve(edge.a,edge.b,size.w/100,size.h/100)}")`,'--packet-delay':`${.7+index%4*.18}s`} as CSSProperties;
 return <span className="wire-packet" style={style} aria-hidden="true"><i/><b>{edge.session.ticks.toString(2).padStart(8,'0').slice(-8)}</b><em/></span>;
}
export default function LiveFabric({fabric,attached=true,revealedIds,proximityPlaces}:{fabric:FabricControl;attached?:boolean;revealedIds?:Set<string>;proximityPlaces?:Map<string,Place>}){
 const [hidden,setHidden]=useState<Set<string>>(new Set());
 const [selected,setSelected]=useState<string|null>(null),[selectedHost,setSelectedHost]=useState<string|null>(null);
 const [detail,setDetail]=useState<FabricSession|null>(null);
 const selectionExists=Boolean(selected&&fabric.state.sessions.some(s=>s.id===selected));
 const hostSelectionExists=Boolean(selectedHost&&fabric.state.hosts.some(h=>h.id===selectedHost));
 useEffect(()=>{if(selected&&!selectionExists){setSelected(null);setDetail(null);}if(selectedHost&&!hostSelectionExists)setSelectedHost(null);},[selected,selectionExists,selectedHost,hostSelectionExists]);
 const wires=useRef<SVGSVGElement>(null),packets=useRef<HTMLDivElement>(null);
 const [wireSize,setWireSize]=useState({w:0,h:0});
 useEffect(()=>{const element=packets.current;if(!element)return;const resize=new ResizeObserver(entries=>{const box=entries[0]?.contentRect;if(box)setWireSize({w:box.width,h:box.height});});resize.observe(element);return()=>resize.disconnect();},[]);
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
 const [moves,setMoves]=useState<Record<string,Place>>({});
 const drag=useRef<{id:string;place:Place;x:number;y:number;width:number;height:number}|null>(null);
 const startDrag=(e:PointerEvent<HTMLSpanElement>,id:string,place:Place)=>{const bounds=e.currentTarget.closest('.fabric-world')!.getBoundingClientRect();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id,place,x:e.clientX,y:e.clientY,width:bounds.width,height:bounds.height};};
 const moveDrag=(e:PointerEvent<HTMLSpanElement>)=>{const d=drag.current;if(!d)return;const x=Math.max(1,Math.min(99-d.place.w,d.place.x+(e.clientX-d.x)/d.width*100));const y=Math.max(10,Math.min(87-d.place.h,d.place.y+(e.clientY-d.y)/d.height*100));setMoves(m=>({...m,[d.id]:{...d.place,x,y}}));};
 const allSessions=fabric.state.sessions.filter(s=>s.id!=='scene');
 const activeSessions=allSessions.filter(s=>!revealedIds||revealedIds.has(s.id));
 const wantedHosts=new Set(['studio',...activeSessions.map(s=>s.hostId)]);
 for(const host of fabric.state.hosts){let parent=host;if(!wantedHosts.has(host.id))continue;while(parent.parentHostId){wantedHosts.add(parent.parentHostId);const ancestor=fabric.state.hosts.find(h=>h.id===parent.parentHostId);if(!ancestor)break;parent=ancestor;}}
 const activeHosts=fabric.state.hosts.filter(h=>wantedHosts.has(h.id));
 const sessions=usePresence(activeSessions),hosts=usePresence(activeHosts);
 const activeSessionIds=new Set(activeSessions.map(s=>s.id)),activeHostIds=new Set(activeHosts.map(h=>h.id));
 const slots=useSlots([...allSessions,...sessions.filter(s=>!allSessions.some(a=>a.id===s.id))],positions.length),hostSlots=useSlots([...fabric.state.hosts,...hosts.filter(h=>!fabric.state.hosts.some(a=>a.id===h.id))],4);
 const hostIndex=(id:string)=>hostSlots.get(id)||0;
 const knownPlaces=useRef(new Map<string,Place>());
 proximityPlaces?.forEach((place,id)=>knownPlaces.current.set(id,place));
 for(const id of knownPlaces.current.keys()){if(!allSessions.some(s=>s.id===id)&&!sessions.some(s=>s.id===id))knownPlaces.current.delete(id);}
 const placed=sessions.map(session=>({session,place:moves[session.id]||knownPlaces.current.get(session.id)||positionFor(slots.get(session.id)||0)}));
 const root={x:51,y:45};
 const sourceFor=(session:FabricSession)=>{const parent=placed.find(p=>p.session.id===session.parentSessionId);return parent?{x:parent.place.x+parent.place.w/2,y:parent.place.y+parent.place.h/2}:hostPosition(hostIndex(session.hostId));};
 const edges=[...hosts.map(host=>({id:`host-${host.id}`,a:host.id==='studio'?root:hostPosition(hostIndex(host.parentHostId||"studio")),b:hostPosition(hostIndex(host.id)),session:sessions.find(s=>s.hostId===host.id),leaving:!activeHostIds.has(host.id),collapsed:host.id==='studio'&&!attached})),...placed.map(({session,place})=>({id:session.id,a:sourceFor(session),b:{x:place.x+place.w/2,y:place.y+place.h/2},session,leaving:!activeSessionIds.has(session.id),collapsed:hidden.has(session.id)}))];
 const inspect=allSessions.find(s=>s.id===selected);
 const inspectHost=fabric.state.hosts.find(h=>h.id===selectedHost);
 return <>
  <svg ref={wires} className="fabric-wires" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">{edges.map(edge=><FabricWire key={edge.id} edge={edge}/>)}</svg>
  <div className="fabric-packets" ref={packets}>{edges.map((edge,index)=><WirePacket key={edge.id} edge={edge} size={wireSize} index={index}/>)}</div>
  {hosts.map(host=>{const p=hostPosition(hostIndex(host.id));return <div className={`fabric-host ${!activeHostIds.has(host.id)?"host-leaving":host.status!=="active"?"host-offline":""}`} key={host.id} style={{left:`${p.x}%`,top:`${p.y}%`}}><i className="host-core"/><button className="host-identity" aria-label={`Inspect ${host.name}`} onClick={()=>setSelectedHost(host.id)}>{host.name}<small>{host.status==="unknown"?"UNREACHABLE":host.status==="stopped"?"STOPPED":isBrowserConcept?"LOGICAL GROUP":"LOCAL HOST"} {host.pid?`· ${host.pid}`:""}</small></button><button title={isBrowserConcept?"Add a browser workload to this group":"Activate a session on this host"} aria-label={`${isBrowserConcept?"Add workload on":"Add session on"} ${host.name}`} onClick={()=>void fabric.addSession(host.id)} disabled={fabric.pending||host.status!=="active"}>＋</button><button title={isBrowserConcept?"Create a logical group from here":"Activate another host from here"} aria-label={`${isBrowserConcept?"Branch group from":"Branch host from"} ${host.name}`} onClick={()=>void fabric.addHost(host.id)} disabled={fabric.pending||host.status!=="active"}>↗</button></div>;})}
  {placed.map(({session,place},i)=>{const isHidden=hidden.has(session.id);const wanted=({compute:['totalIterations','escapedCells'],signals:['rms','samplesProcessed'],render:['energy','positionsIntegrated']} as Record<string,string[]>)[session.kind]||[];const metrics=wanted.filter(k=>session.metrics?.[k]!==undefined).map(k=>[k,session.metrics[k]] as [string,unknown]);return <div key={session.id} className={`fabric-node ${session.connected?'node-connected':''} ${session.paused?'node-paused':''} ${isHidden?'node-collapsed':''} ${!activeSessionIds.has(session.id)?'node-leaving':''}`} style={{left:`${place.x}%`,top:`${place.y}%`,width:`${place.w}%`,height:`${place.h}%`,'--node-delay':'.45s'} as CSSProperties} data-native-pid={session.pid}>
   {isHidden?<button className="node-restore" aria-label={`Reopen ${session.name}`} onClick={()=>setHidden(h=>{const next=new Set(h);next.delete(session.id);return next;})}>◈</button>:<><div className="node-heading"><span className="node-drag" onPointerDown={e=>startDrag(e,session.id,place)} onPointerMove={moveDrag} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} title="Drag session view" aria-label="Drag session view">⠿</span><button className="node-name" onClick={()=>setSelected(session.id)} title={isBrowserConcept?"Inspect browser worker task":"Inspect live process"}><i className={session.connected?'status-dot':'status-dot offline'}/>{session.name}</button><button className="node-close hover-control" aria-label={`Close view of ${session.name}`} onClick={()=>setHidden(h=>new Set(h).add(session.id))}>×</button></div><button className="node-live-output" onClick={()=>setSelected(session.id)} aria-label={`Inspect ${session.name} ${isBrowserConcept?"browser workload":"native process"}`}><NativeSignal session={session}/><div className="node-metrics">{metrics.map(([key,value])=><span key={key}><small>{({totalIterations:'iterations',escapedCells:'escaped',samplesProcessed:'samples',positionsIntegrated:'positions'} as Record<string,string>)[key]||key}</small>{typeof value==='number'?Number(value.toFixed(2)).toLocaleString():String(value).slice(0,12)}</span>)}</div></button><div className="node-foot"><span>{isBrowserConcept?`WORKER · ${session.workerId||session.id}`:`PID ${session.pid}`}<b>{session.ticks.toLocaleString()}</b></span><div><button title={session.paused?'Resume':'Pause'} aria-label={`${session.paused?'Resume':'Pause'} ${session.name}`} onClick={()=>void fabric.command(session.id,session.paused?'resume':'pause')} disabled={fabric.pending}>{session.paused?'▷':'Ⅱ'}</button><button title="Send pulse" aria-label={`Pulse ${session.name}`} onClick={()=>void fabric.command(session.id,'pulse')} disabled={fabric.pending}>↗</button><button title={isBrowserConcept?"Branch another browser workload":"Branch another real session"} aria-label={`Branch from ${session.name}`} onClick={()=>void fabric.addSession(session.hostId,session.id)} disabled={fabric.pending}>＋</button></div></div></>}
  </div>;})}
  {inspect&&<div className="fabric-inspector" role="dialog" aria-label={`${isBrowserConcept?"Browser worker task":"Live process"} ${inspect.name}`}><header><span><i className={inspect.connected?'status-dot':'status-dot offline'}/>{inspect.name}</span><button onClick={()=>setSelected(null)} aria-label="Close process inspector">×</button></header><div className="inspector-identity"><span>{isBrowserConcept?`WORKER · ${inspect.workerId||inspect.id}`:`PID ${inspect.pid}`}</span><span>{!inspect.connected?'OFFLINE':inspect.paused?'PAUSED':'RUNNING'}</span><span>{inspect.ticks.toLocaleString()} ticks</span></div><pre>{(detail?.id===inspect.id?detail.recentlines||[]:inspect.recentlines||[]).slice(-6).join('\n')||JSON.stringify(inspect.metrics,null,2)}</pre><footer><button onClick={()=>void fabric.command(inspect.id,'pulse')} disabled={fabric.pending}>Send pulse ↗</button><button onClick={()=>void fabric.command(inspect.id,inspect.paused?'resume':'pause')} disabled={fabric.pending}>{inspect.paused?'Resume':'Pause'}</button><button className="stop-process" disabled={fabric.pending} onClick={async()=>{if(await fabric.removeSession(inspect.id))setSelected(null);}}>{isBrowserConcept?"Stop workload":"Stop session"}</button></footer></div>}
  {inspectHost&&<div className="fabric-inspector" role="dialog" aria-label={`${isBrowserConcept?"Group":"Host"} ${inspectHost.name}`}><header><span><i className="host-core"/>{inspectHost.name}</span><button onClick={()=>setSelectedHost(null)} aria-label="Close host inspector">×</button></header><div className="inspector-identity"><span>{isBrowserConcept?"BROWSER GROUP":`PID ${inspectHost.pid}`}</span><span>{isBrowserConcept?"LOGICAL GROUP":"LOCAL HOST"}</span><span>{activeSessions.filter(s=>s.hostId===inspectHost.id).length} {isBrowserConcept?"workloads":"sessions"}</span></div><footer><button disabled={fabric.pending} onClick={()=>void fabric.addSession(inspectHost.id)}>{isBrowserConcept?"＋ Workload":"＋ Session"}</button><button disabled={fabric.pending} onClick={()=>void fabric.addHost(inspectHost.id)}>{isBrowserConcept?"＋ Group":"＋ Host"}</button>{inspectHost.id!=='studio'&&<button className="stop-process" disabled={fabric.pending} onClick={async()=>{if(await fabric.removeHost(inspectHost.id))setSelectedHost(null);}}>{isBrowserConcept?"Remove group & branches":"Stop host & branches"}</button>}</footer></div>}
 </>;
}
