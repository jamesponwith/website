import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject, type PointerEvent } from "react";
import { SITE } from "../../../../lib/site";
import { Scene } from "../Scene";
import { roundedWire } from "../fabric-layout";
import { useLiveScene, type RuntimeControl } from "../runtime";
import { LiveWorkspace as Workspace } from "./workspace";
import { canAutoGrow } from "./automation";
import "./live.css";

function PaneView({workspace,id,large=false}:{workspace:Workspace;id:string;large?:boolean}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(()=>canvas.current ? workspace.project(id,canvas.current,large?12:8) : undefined,[workspace,id,large]);
  return <canvas ref={canvas} role="img" aria-label={`${workspace.label(id)} · live PHUX terminal output`}/>;
}

function useWires(stage:RefObject<HTMLElement|null>,identity:string) {
  const [paths,setPaths] = useState<string[]>([]);
  useLayoutEffect(()=>{
    const root = stage.current;
    if (!root) return;
    const measure = () => {
      const base = root.getBoundingClientRect(), main = root.querySelector(".live-primary")?.getBoundingClientRect();
      if (!main) return;
      const stacked = base.width < 1000;
      const next = Array.from(root.querySelectorAll(".live-secondary")).map(node=>{
        const box = node.getBoundingClientRect();
        const a = stacked ? {x:main.x-base.x+main.width/2,y:main.bottom-base.y} : {x:main.right-base.x,y:main.y-base.y+main.height/2};
        const b = stacked ? {x:box.x-base.x+box.width/2,y:box.y-base.y} : {x:box.x-base.x,y:box.y-base.y+box.height/2};
        const points = stacked ? [a,{x:a.x,y:b.y-24},{x:b.x,y:b.y-24},b] : [a,{x:b.x-28,y:a.y},{x:b.x-28,y:b.y},b];
        return roundedWire(points).path;
      });
      setPaths(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll(".live-primary,.live-secondary").forEach(el=>observer.observe(el));
    measure();
    return ()=>observer.disconnect();
  },[identity]);
  return paths;
}

function WorkspaceDialog({workspace,selected,close}:{workspace:Workspace;selected:string;close:()=>void}) {
  const state = useSyncExternalStore(workspace.subscribe,workspace.getSnapshot,workspace.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null), target = useRef<HTMLDivElement>(null);
  const [error,setError] = useState("");
  const action = (fn:()=>void) => {try {fn();workspace.focusInput();setError("");} catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}};
  useEffect(()=>{
    dialog.current?.showModal();
    const restore = target.current ? workspace.present(selected,target.current) : ()=>{};
    return ()=>{restore();dialog.current?.close();};
  },[workspace]);
  useEffect(()=>{workspace.followFocus();},[state.focused,workspace]);
  return <dialog ref={dialog} className="live-terminal-dialog" onCancel={close} onClose={close} aria-label="Live PHUX workspace">
    <header><div className="live-pane-tabs" role="group" aria-label="Live terminals">{state.panes.map(pane=><button key={pane.id} aria-pressed={state.focused===pane.id} onClick={()=>action(()=>workspace.focus(pane.id))}><i/>{workspace.label(pane.id)}</button>)}</div><button className="live-dialog-close" aria-label="Close terminal view" onClick={close}>×</button></header>
    <div className="live-terminal-target" ref={target}/>
    <footer><div className="live-command-shortcuts">{["demo colors","ls","clear"].map(command=><button key={command} disabled={state.phase!=="live"} onClick={()=>action(()=>workspace.command(command))}>{command}<span>↵</span></button>)}</div><button className="live-split" disabled={state.pending||state.panes.length>=4||state.phase!=="live"} onClick={()=>action(()=>workspace.split())}>Split terminal ＋</button></footer>
    {(error||state.error)&&<p role="status" className="live-action-error">{error||state.error}</p>}
    <div className="live-dialog-caption"><span><i className="live-status-dot"/>{state.backend==="native"?"Linux session":"Edge demo"}</span><span>Close the view. Keep the workspace.</span></div>
  </dialog>;
}

export default function LiveWorkspace({runtime}:{runtime:RuntimeControl}) {
  const workspace = useMemo(()=>new Workspace(),[]);
  const state = useSyncExternalStore(workspace.subscribe,workspace.getSnapshot,workspace.getSnapshot);
  const stage = useRef<HTMLElement>(null), home = useRef<HTMLDivElement>(null);
  const settings = useLiveScene(runtime.state), pointer = useRef({x:0,y:0,active:0});
  const [selected,setSelected] = useState<string|null>(null), [attempt,setAttempt] = useState(0);
  const [seen,setSeen] = useState(false);
  const interacted = useRef(false);
  const branched = useRef(false), seeded = useRef(new Set<string>());
  const grow = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const secondary = state.panes.slice(1);
  const paths = useWires(stage,state.panes.map(p=>p.id).join("|"));
  useEffect(()=>{
    clearTimeout(grow.current);grow.current=undefined;
    interacted.current=false; branched.current=false; seeded.current.clear();
    if (home.current) void workspace.start(home.current,SITE.demoWsUrl);
  },[workspace,attempt]);
  useEffect(()=>()=>{clearTimeout(grow.current);workspace.dispose();},[workspace]);
  useEffect(()=>{
    if (state.phase!=="live"||state.panes.length!==1||state.pending||selected||branched.current||interacted.current) return;
    // One real multiplexer split, on the existing admitted connection.
    const timer = setTimeout(()=>{branched.current=true;if(interacted.current)return;try {workspace.split();}catch{}},350);
    return ()=>clearTimeout(timer);
  },[state.phase,state.panes.length,state.pending,selected]);
  useEffect(()=>{
    if(state.phase!=="live"||state.backend!=="edge"||selected||interacted.current)return;
    const pane=state.panes.find(p=>!seeded.current.has(p.id));
    if(!pane)return;
    seeded.current.add(pane.id);
    const command=state.panes.indexOf(pane)===0?"demo colors":"ls";
    queueMicrotask(()=>{if(interacted.current)return;try {workspace.focus(pane.id);workspace.command("clear\n"+command);workspace.focus(state.panes[0].id);}catch{}});
  },[state.phase,state.backend,state.panes,selected]);
  useEffect(()=>{
    const root = stage.current;
    if (!root) return;
    let last = 0, timer:ReturnType<typeof setTimeout>;
    const pulse = () => {
      if (performance.now()-last<600) return;
      last = performance.now(); root.classList.remove("has-live-frame");
      requestAnimationFrame(()=>root.classList.add("has-live-frame"));
      clearTimeout(timer); timer = setTimeout(()=>root.classList.remove("has-live-frame"),900);
    };
    root.addEventListener("phux-render",pulse);
    return ()=>{root.removeEventListener("phux-render",pulse);clearTimeout(timer);};
  },[]);
  const open = (id:string) => {
    if(state.phase!=="live")return;
    interacted.current=true;clearTimeout(grow.current);grow.current=undefined;
    setSelected(id);
  };
  const move = (event:PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), x = (event.clientX-box.x)/box.width, y = (event.clientY-box.y)/box.height;
    pointer.current = {x:x*2-1,y:1-y*2,active:1};
    if (!seen) setSeen(true);
    if (x<.7) {clearTimeout(grow.current);grow.current=undefined;return;}
    if (grow.current || !canAutoGrow(state,interacted.current)) return;
    grow.current = setTimeout(()=>{
      grow.current=undefined;
      const current=workspace.getSnapshot();
      if(!canAutoGrow(current,interacted.current))return;
      try {workspace.split();}catch{}
    },1100);
  };
  const primary = state.panes[0];
  return <section ref={stage} data-phase={state.phase} className={`vibe-stage live-session-stage ${seen?"has-attention":""}`} aria-label="Live PHUX session workspace" onPointerMove={move} onPointerLeave={()=>{pointer.current.active=0;clearTimeout(grow.current);grow.current=undefined;}}>
    <div className="vibe-universe"><Scene variant={1} settings={settings} ambient input={pointer}/></div><div className="vibe-shade"/>
    <svg className="live-session-wires" aria-hidden="true">{paths.map((path,index)=><g key={index}><path className="live-wire-track" d={path}/><path className="live-wire-flow" d={path}/></g>)}</svg>
    <div className="live-session-layout">
      <article className="live-glass live-primary">
        <header><span><i className={`live-status-dot ${state.phase!=="live"?"is-waiting":""}`}/>{primary?workspace.label(primary.id):"Your workspace"}</span><small>{state.backend==="native"?"LINUX":state.backend==="edge"?"PHUX / EDGE":"PHUX"}</small></header>
        {primary?<button className="live-pane-preview" disabled={state.phase!=="live"} aria-label={`Open ${workspace.label(primary.id)} live terminal`} onClick={()=>open(primary.id)}><PaneView workspace={workspace} id={primary.id} large/><span className="live-enter">Enter terminal ↗</span></button>:<div className="live-connection-state" role="status"><span>{state.phase==="connecting"?"Connecting your workspace…":state.error||"Opening PHUX…"}</span>{["closed","error"].includes(state.phase)&&<button onClick={()=>setAttempt(a=>a+1)}>Try again ↗</button>}</div>}
        {primary&&["closed","error"].includes(state.phase)&&<div className="live-reconnect" role="status"><p>{state.error}</p><button onClick={()=>setAttempt(a=>a+1)}>Start a fresh workspace ↗</button></div>}
        <footer><span>{state.phase==="live"?"LIVE SESSION":state.phase.toUpperCase()}</span><span>{state.panes.length>1?`${state.panes.length} terminals · one connection`:""}</span></footer>
      </article>
      <div className="live-satellite-grid" aria-label="Terminals in this workspace">{secondary.map(pane=><article className="live-glass live-secondary" key={pane.id}><header><span><i className="live-status-dot"/>{workspace.label(pane.id)}</span><small>SAME WORKSPACE</small></header><button className="live-pane-preview" disabled={state.phase!=="live"} aria-label={`Open ${workspace.label(pane.id)} live terminal`} onClick={()=>open(pane.id)}><PaneView workspace={workspace} id={pane.id}/><span className="live-enter">↗</span></button></article>)}</div>
    </div>
    <p className="live-session-hint">{seen?"Open a terminal. It’s yours.":"Move through it."}</p>
    <div className="live-source-home" ref={home}/>
    {selected&&<WorkspaceDialog workspace={workspace} selected={selected} close={()=>setSelected(null)}/>}
  </section>;
}
