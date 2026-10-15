import GhosttySurface from "./GhosttySurface";
import { snapshotFrame } from "./terminal-frames";
import { isBrowserConcept, sceneFetch } from "./transport";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Scene, initialSettings, type SceneSettings } from "./Scene";
import IntentInstrument from "./IntentInstrument";
import PersistenceStory from "./PersistenceStory";
import FederationStage from "./FederationStage";
import Observatory from "./Observatory";
import SuperDemo from "./SuperDemo";
import { LiveStatus } from "./Pipes";
import { useRuntime, type RuntimeControl } from "./runtime";
import "./prototype.css";

type Variant="all"|"persistence"|"instrument"|"machine"|"observatory"|"combo";
const variants=[
 {id:"persistence",number:"01",name:"Keep the thread",short:"Continuity",description:"A window goes. The work stays.",color:[.64,.51,.88],art:0},
 {id:"instrument",number:"02",name:"The living field",short:"Intent",description:"A thought becomes a different world.",color:[1,.45,.19],art:1},
 {id:"machine",number:"03",name:"A federation of possibilities",short:"Federation",description:"Work and play. On the same pipes.",color:[.29,.72,.77],art:2},
 {id:"observatory",number:"04",name:"The shared observatory",short:"Observatory",description:"Different payloads. One language.",color:[.43,.58,.9],art:3},
 {id:"combo",number:"05",name:"Everything that runs",short:"All together",description:"The current demo, with the whole world around it.",color:[.73,.54,.96],art:1},
] as const;
const urlFor=(id:string)=>`${isBrowserConcept?"/concepts/vgpu":"/prototype/vgpu"}?variant=${id}`;
const readVariant=()=>{const value=new URLSearchParams(location.search).get("variant");return variants.some(v=>v.id===value)?value as Variant:"all";};
export default function VgpuPrototype(){
 const [variant,setVariant]=useState<Variant>(()=>typeof window==="undefined"?"all":readVariant());
 const [terminalOpen,setTerminalOpen]=useState(false);
 const runtime=useRuntime();
 const controller=typeof window!=="undefined"&&new URLSearchParams(location.search).get("controller")==="phone";
 const change=(value:Variant)=>{setVariant(value);history.pushState({},"",urlFor(value));window.scrollTo({top:0,behavior:"instant"});};
 const cycle=(direction:number)=>{const i=variants.findIndex(v=>v.id===variant);change(variants[(i+direction+variants.length)%variants.length].id);};
 useEffect(()=>{const pop=()=>setVariant(readVariant());const key=(event:KeyboardEvent)=>{if(terminalOpen||variant==="combo")return;if(event.target instanceof Element&&event.target.closest("input,textarea,select,button,[contenteditable]"))return;if(event.key==="ArrowRight"||event.key==="ArrowLeft"){event.preventDefault();cycle(event.key==="ArrowRight"?1:-1);}};window.addEventListener("popstate",pop);window.addEventListener("keydown",key);return()=>{window.removeEventListener("popstate",pop);window.removeEventListener("keydown",key);};},[variant,terminalOpen]);
 const openTerminal=()=>setTerminalOpen(true);
 return <div className={`light-lab variant-${variant} ${controller?"is-controller":""}`}><a className="lab-skip" href="#lab-main">Skip to experience</a><header className="lab-nav"><a className="lab-brand" href={urlFor("all")} onClick={e=>{e.preventDefault();change("all");}}>phux<span>/</span><small>{controller?"remote thought":"light lab"}</small></a><nav aria-label="Lab navigation"><a href={urlFor("all")} onClick={e=>{e.preventDefault();change("all");}}>{variant==="combo"?"Archive ↗":"The collection"}</a><a href="https://docs.phux.sh/overview" target="_blank" rel="noreferrer">Docs ↗</a><button className="nav-live" onClick={openTerminal}><i className="status-dot"/>{isBrowserConcept?"Runtime":"Native terminal"} <span>↗</span></button></nav></header><main id="lab-main">{variant==="all"&&<Gallery change={change}/>} {variant==="persistence"&&<PersistenceStory runtime={runtime} openTerminal={openTerminal}/>} {variant==="instrument"&&<IntentInstrument runtime={runtime} controller={controller}/>} {variant==="machine"&&<FederationStage runtime={runtime}/>} {variant==="observatory"&&<Observatory runtime={runtime}/>} {variant==="combo"&&<SuperDemo runtime={runtime} openTerminal={openTerminal}/>}</main>{variant!=="all"&&!controller&&<nav className="prototype-switcher" aria-label="Compare landing concepts"><button aria-label="Previous concept" className="switch-arrow" onClick={()=>cycle(-1)}>←</button>{variants.map(v=><button key={v.id} onClick={()=>change(v.id)} aria-current={variant===v.id?"page":undefined}><span>{v.number}</span><b>{v.short}</b></button>)}<button aria-label="Next concept" className="switch-arrow" onClick={()=>cycle(1)}>→</button></nav>}<NativeDialog open={terminalOpen} close={()=>setTerminalOpen(false)} runtime={runtime}/></div>;
}
function Gallery({change}:{change:(v:Variant)=>void}){return <div className="collection"><section className="collection-intro"><span className="eyebrow">PHUX / FIVE CONNECTED POSSIBILITIES</span><h1>A common language.<br/><em>Uncommon possibilities.</em></h1><div><p>Intent becomes input. Input becomes a world.<br/>Five ways to feel what phux connects.</p><span className="collection-edition">VOLUME 03<br/>LIGHT / MATTER / INTENT</span></div></section><div className="collection-grid">{variants.map(item=><GalleryCard key={item.id} item={item} select={()=>change(item.id)}/>)}</div><footer className="collection-footer"><span>One shared runtime. Five points of view.</span><span>{isBrowserConcept?"Interactive concepts / browser compute / live vgpu":"Natural-language intent / native PHUX / live vgpu"}</span></footer></div>;}
function GalleryCard({item,select}:{item:typeof variants[number];select:()=>void}){const settings=useRef<SceneSettings>({...initialSettings,color:[...item.color],shape:item.id==="combo"?0:item.id==="instrument"?1:item.id==="machine"?5:item.id==="observatory"?3:2,speed:.4});return <a href={urlFor(item.id)} className={`world-card card-${item.id}`} onClick={e=>{e.preventDefault();select();}}><div className="world-visual"><Scene variant={item.art} settings={settings} miniature/><span className="world-number">{item.number} /</span>{item.id==="persistence"&&<div className="mini-purposeful"><span>studio / light-instrument</span><p>you ↗ a slow amber horizon</p><b>● work stays running</b></div>}{item.id==="machine"&&<div className="mini-fabric"><span>studio</span><b>phux</b><span>render-node</span></div>}{item.id==="observatory"&&<div className="mini-payloads"><span>intent ↗</span><span>◈ state</span><span>▧ artifact</span></div>}{item.id==="combo"&&<div className="mini-combo"><b>phux</b><span>work / play / keep going</span></div>}<span className="world-open">Enter experience ↗</span></div><div className="world-caption"><div><span className="eyebrow">{item.number==="05"?"THE HOMEPAGE CANDIDATE":"AN INTERACTIVE EXPLORATION"}</span><h2>{item.name}</h2><p>{item.description}</p></div><span>↗</span></div></a>;}

function NativeDialog({open,close,runtime}:{open:boolean;close:()=>void;runtime:RuntimeControl}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [screen,setScreen]=useState<string[]>([]);
  const [input,setInput]=useState("");
  const [error,setError]=useState("");
  const [pending,setPending]=useState(false);
  useEffect(()=>{
    if(!open){dialog.current?.close();return;}
    dialog.current?.showModal();
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    let busy=false;
    const poll=async()=>{
      if(busy||document.hidden||controller.signal.aborted)return;
      busy=true;
      try { const response=await sceneFetch("/__scene/screen",{signal:controller.signal}); if(!response.ok)throw new Error("Native screen unavailable");const data=await response.json();if(!controller.signal.aborted)setScreen(data.lines); }
      catch{if(!controller.signal.aborted)setError(isBrowserConcept?"The browser workload could not be read.":"The native screen could not be read. Start bun run preview:vgpu.");}
      finally{busy=false;}
      if(!controller.signal.aborted&&!document.hidden)timer=setTimeout(poll,500);
    };
    const visibility=()=>{clearTimeout(timer);if(!document.hidden)void poll();};
    document.addEventListener("visibilitychange",visibility);
    setError("");void poll();
    return()=>{controller.abort();clearTimeout(timer);document.removeEventListener("visibilitychange",visibility);};
  },[open]);
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!input.trim())return;setPending(true);setError("");try{await runtime.command(input.trim());setInput("");}catch(e){setError(e instanceof Error?e.message:"Command failed");}finally{setPending(false);}};
  return <dialog ref={dialog} className="native-preview-dialog" onCancel={close} onClose={close}><div className="native-dialog-heading"><div><span className="eyebrow">{isBrowserConcept?"PUBLIC CONCEPT / BROWSER COMPUTE":"THE ACTUAL THING"}</span><h2>{isBrowserConcept?"Inside the running workload.":"Native phux. Real process."}</h2></div><button onClick={close} aria-label={isBrowserConcept?"Close runtime inspector":"Close real terminal"}>×</button></div><p>Try <code>color cyan</code>, <code>shape wave</code>, or <code>speed 2</code>. Close this view; the process stays. {isBrowserConcept?"This concept runs computation in a browser worker. PHUX hosts and client frames illustrate the connection model.":"This server is isolated from your usual PHUX sessions."}</p><div className="native-screen-label"><span>{isBrowserConcept?"vgpu / browser worker":"vgpu / native PTY"}</span><span>{isBrowserConcept?"WORKLOAD SNAPSHOT · 500ms":"PHUX SNAPSHOT VIEW · 500ms"}</span></div><GhosttySurface className="native-screen ghostty-native-screen" label={isBrowserConcept?"Browser workload output":"Native PHUX snapshot output"} vt={snapshotFrame(screen.length?screen:[isBrowserConcept?"Reading browser worker…":"Reading native terminal…"])} fontSize={12} active={open}/><form className="console-input native-screen-input" onSubmit={submit}><label htmlFor="native-scene-command">❯</label><input id="native-scene-command" aria-label={isBrowserConcept?"Browser scene command":"Command in native PHUX session"} placeholder="shape sphere" value={input} onChange={e=>setInput(e.target.value)} autoComplete="off" spellCheck={false} disabled={pending}/><button type="submit" aria-label={isBrowserConcept?"Apply browser scene command":"Send command to native session"} disabled={pending}>↵</button></form>{error&&<p className="console-error" role="alert">{error}</p>}<div className="native-dialog-foot"><LiveStatus state={runtime.state}/><span>{isBrowserConcept?"CONCEPT / NOT A NATIVE PHUX SESSION":"LOCAL PREVIEW / DISPOSABLE SESSION"}</span></div></dialog>;
}
