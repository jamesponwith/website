import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { SITE } from "../../../../lib/site";
import { Scene } from "../Scene";
import { useLiveScene, type RuntimeControl } from "../runtime";
import { LiveWorkspace as Workspace, type WorkspaceState } from "./workspace";
import { canAutoGrow } from "./automation";
import { useLiquidLayout } from "./useLiquidLayout";
import { ParticleLinks } from "./ParticleLinks";
import "./live.css";

function PaneView({workspace,id,large=false}:{workspace:Workspace;id:string;large?:boolean}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(()=>canvas.current ? workspace.project(id,canvas.current,large?12:8) : undefined,[workspace,id,large]);
  return <canvas ref={canvas} role="img" aria-label={`${workspace.label(id)} · live PHUX terminal output`}/>;
}

type LayoutProps = {workspace:Workspace;state:WorkspaceState;open:(id:string,node:HTMLElement)=>void;retry:()=>void};
function PrimaryTitle({workspace,state}:Pick<LayoutProps,"workspace"|"state">) {
  const primary=state.panes[0];
  return <header><span><i className={`live-status-dot ${state.phase!=="live"?"is-waiting":""}`}/>{primary?workspace.label(primary.id):"Your workspace"}</span><small>{state.backend==="native"?"LINUX":state.backend==="edge"?"PHUX / EDGE":"PHUX"}</small></header>;
}
function SessionStatus({state,retry}:{state:WorkspaceState;retry:()=>void}) {
  const closed=["closed","error"].includes(state.phase);
  return <div className={state.panes.length?"live-reconnect":"live-connection-state"} role="status"><span>{state.phase==="connecting"?"Connecting your workspace…":state.error||"Opening PHUX…"}</span>{closed&&<button onClick={retry}>Start a fresh workspace ↗</button>}</div>;
}
function PrimaryPane({workspace,state,open,retry}:LayoutProps) {
  const primary=state.panes[0],closed=["closed","error"].includes(state.phase);
  return <article className="live-glass live-primary" data-pane-id={primary?.id}>
    <PrimaryTitle workspace={workspace} state={state}/>
    {primary?<button className="live-pane-preview" disabled={state.phase!=="live"||state.pending} aria-label={`Open ${workspace.label(primary.id)} live terminal`} onClick={event=>open(primary.id,event.currentTarget.closest<HTMLElement>(".live-glass")!)}><PaneView workspace={workspace} id={primary.id} large/><span className="live-enter">Enter terminal ↗</span></button>:<SessionStatus state={state} retry={retry}/>}
    {primary&&closed&&<SessionStatus state={state} retry={retry}/>}
    <footer><span>{state.phase==="live"?"LIVE SESSION":state.phase.toUpperCase()}</span><span>{state.panes.length>1?`${state.panes.length} terminals · one connection`:""}</span></footer>
  </article>;
}
function WorkspaceLayout(props:LayoutProps) {
  const {workspace,state,open}=props;
  return <div className="live-session-layout">
    <PrimaryPane {...props}/>
    <div className="live-satellite-grid" data-count={state.panes.length-1} aria-label="Terminals in this workspace">{state.panes.slice(1).map(pane=><article className="live-glass live-secondary" data-pane-id={pane.id} key={pane.id}><header><span><i className="live-status-dot"/>{workspace.label(pane.id)}</span><small>SAME WORKSPACE</small></header><button className="live-pane-preview" disabled={state.phase!=="live"||state.pending} aria-label={`Open ${workspace.label(pane.id)} live terminal`} onClick={event=>open(pane.id,event.currentTarget.closest<HTMLElement>(".live-glass")!)}><PaneView workspace={workspace} id={pane.id}/><span className="live-enter">↗</span></button></article>)}</div>
  </div>;
}

type SelectedView = {id:string;origin:DOMRect};
function WorkspaceDialog({workspace,selected,close,pulse}:{workspace:Workspace;selected:SelectedView;close:()=>void;pulse:()=>void}) {
  const state = useSyncExternalStore(workspace.subscribe,workspace.getSnapshot,workspace.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null), target = useRef<HTMLDivElement>(null);
  const [error,setError] = useState("");
  const closing=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const action = (fn:()=>void) => {try {pulse();fn();workspace.focusInput();setError("");} catch(cause) {setError(cause instanceof Error?cause.message:String(cause));}};
  const requestClose=()=>{
    if(closing.current)return;
    if(matchMedia("(prefers-reduced-motion: reduce)").matches){close();return;}
    closing.current=true;pulse();dialog.current?.classList.add("is-returning");
    timer.current=setTimeout(close,440);
  };
  useLayoutEffect(()=>{
    const element=dialog.current!;
    element.showModal();element.style.animation="none";
    const box=element.getBoundingClientRect(),origin=selected.origin;
    element.style.setProperty("--liquid-origin-x",`${origin.x+origin.width/2-box.x-box.width/2}px`);
    element.style.setProperty("--liquid-origin-y",`${origin.y+origin.height/2-box.y-box.height/2}px`);
    element.style.setProperty("--liquid-origin-scale-x",String(Math.max(.1,origin.width/box.width)));
    element.style.setProperty("--liquid-origin-scale-y",String(Math.max(.1,origin.height/box.height)));
    element.style.removeProperty("animation");
    const restore = target.current ? workspace.present(selected.id,target.current) : ()=>{};
    return ()=>{clearTimeout(timer.current);restore();element.close();};
  },[workspace]);
  return <dialog ref={dialog} className="live-terminal-dialog" onCancel={event=>{event.preventDefault();requestClose();}} aria-label="Live PHUX workspace">
    <header><div className="live-pane-tabs" role="group" aria-label="Live terminals">{state.panes.map(pane=><button key={pane.id} disabled={state.pending||state.phase!=="live"} aria-pressed={state.focused===pane.id} onClick={()=>action(()=>workspace.focus(pane.id))}><i/>{workspace.label(pane.id)}</button>)}</div><button className="live-dialog-close" aria-label="Close terminal view" onClick={requestClose}>×</button></header>
    <div className="live-terminal-target" aria-busy={state.pending} ref={target}/>
    <footer><div className="live-command-shortcuts">{["demo glass","ls","clear"].map(command=><button key={command} disabled={state.pending||state.phase!=="live"} onClick={()=>action(()=>workspace.command(command))}>{command}<span>↵</span></button>)}</div><button className="live-split" disabled={state.pending||state.panes.length>=4||state.phase!=="live"} onClick={()=>action(()=>workspace.split())}>{state.pending?"Splitting…":"Split terminal ＋"}</button></footer>
    {(error||state.error)&&<p role="status" className="live-action-error">{error||state.error}</p>}
    <div className="live-dialog-caption"><span><i className="live-status-dot"/>{state.backend==="native"?"Linux session":"Edge demo"}</span><span>Close the view. Keep the workspace.</span></div>
  </dialog>;
}

export default function LiveWorkspace({runtime}:{runtime:RuntimeControl}) {
  const workspace = useMemo(()=>new Workspace(),[]);
  const state = useSyncExternalStore(workspace.subscribe,workspace.getSnapshot,workspace.getSnapshot);
  const stage = useRef<HTMLElement>(null), home = useRef<HTMLDivElement>(null);
  const settings = useLiveScene(runtime.state), pointer = useRef({x:0,y:0,active:0});
  const [selected,setSelected] = useState<SelectedView|null>(null), [attempt,setAttempt] = useState(0);
  const [seen,setSeen] = useState(false);
  const interacted = useRef(false);
  const branched = useRef(false), seeded = useRef(new Set<string>());
  const grow = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const {glass,links,pulse,engaged} = useLiquidLayout(stage,state.panes.map(p=>p.id).join("|"),selected!==null,pointer,state.parents);
  const signal = useRef(-10000);
  useEffect(()=>{
    clearTimeout(grow.current);grow.current=undefined;
    interacted.current=false; branched.current=false; seeded.current.clear();
    if (home.current) void workspace.start(home.current,SITE.demoWsUrl);
  },[workspace,attempt]);
  useEffect(()=>()=>{clearTimeout(grow.current);workspace.dispose();},[workspace]);
  useEffect(()=>{
    if (state.phase!=="live"||state.panes.length!==1||state.pending||selected||branched.current||interacted.current) return;
    // One real multiplexer split, on the existing admitted connection.
    const timer = setTimeout(()=>{branched.current=true;if(interacted.current)return;try {pulse();workspace.split();}catch{}},350);
    return ()=>clearTimeout(timer);
  },[state.phase,state.panes.length,state.pending,selected]);
  useEffect(()=>{
    if(state.phase!=="live"||state.pending||state.backend!=="edge"||selected||interacted.current)return;
    const pane=state.panes.find(p=>!seeded.current.has(p.id));
    if(!pane)return;
    seeded.current.add(pane.id);
    const command=state.panes.indexOf(pane)===0?"demo glass":"theme glass\nls";
    queueMicrotask(()=>{if(interacted.current||workspace.getSnapshot().pending){seeded.current.delete(pane.id);return;}try {workspace.focus(pane.id);workspace.command("clear\n"+command);workspace.focus(state.panes[0].id);}catch{}});
  },[state.phase,state.pending,state.backend,state.panes,selected]);
  useEffect(()=>{
    const root = stage.current;
    if (!root) return;
    const pulse = () => {signal.current=performance.now();};
    root.addEventListener("phux-render",pulse);
    return ()=>{root.removeEventListener("phux-render",pulse);};
  },[]);
  const open = (id:string,node:HTMLElement) => {
    if(state.phase!=="live"||state.pending)return;
    interacted.current=true;clearTimeout(grow.current);grow.current=undefined;
    pulse();setSelected({id,origin:node.getBoundingClientRect()});
  };
  const move = (event:PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), x = (event.clientX-box.x)/box.width, y = (event.clientY-box.y)/box.height;
    Object.assign(pointer.current,{x:x*2-1,y:1-y*2,active:1});
    if (!seen) setSeen(true);
    if (x<.7) {clearTimeout(grow.current);grow.current=undefined;return;}
    if (grow.current || !canAutoGrow(state,interacted.current)) return;
    grow.current = setTimeout(()=>{
      grow.current=undefined;
      const current=workspace.getSnapshot();
      if(!canAutoGrow(current,interacted.current)||!engaged.current)return;
      try {pulse();workspace.split();}catch{}
    },1100);
  };
  return <section ref={stage} data-phase={state.phase} className={`vibe-stage live-session-stage ${seen?"has-attention":""} ${selected?"has-terminal-open":""}`} aria-label="Live PHUX session workspace" onPointerMove={move} onPointerLeave={()=>{pointer.current.active=0;clearTimeout(grow.current);grow.current=undefined;}}>
    <div className="vibe-universe"><Scene variant={1} settings={settings} ambient input={pointer} glass={glass}/></div><div className="vibe-shade"/>
    {!selected&&<ParticleLinks links={links} signal={signal}/>}
    <WorkspaceLayout workspace={workspace} state={state} open={open} retry={()=>setAttempt(a=>a+1)}/>
    <p className="live-session-hint">{seen?"Open a terminal. It’s yours.":"Move through it."}</p>
    <div className="live-source-home" ref={home}/>
    {selected&&<WorkspaceDialog workspace={workspace} selected={selected} close={()=>setSelected(null)} pulse={pulse}/>}
  </section>;
}
