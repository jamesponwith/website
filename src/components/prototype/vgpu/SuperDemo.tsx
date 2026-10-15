import { isBrowserConcept } from "./transport";
// A live local fabric: native sessions, independent host processes, optical views.
import { useEffect, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react";
import { Scene } from "./Scene";
import { formNames, useLiveScene, type RuntimeControl } from "./runtime";
import LiveFabric, { useFabric } from "./LiveFabric";
import Performance from "./Performance";
import { useExploration } from "./useExploration";
import "../../../styles/terminal-surface.css";
import "./vibe.css";

export default function SuperDemo({runtime,openTerminal}:{runtime:RuntimeControl;openTerminal:()=>void}) {
  const settings=useLiveScene(runtime.state),fabric=useFabric();
  const [controls]=useState(()=>typeof window!=='undefined'&&new URLSearchParams(window.location.search).has('controls'));
  const exploration=useExploration(fabric,!controls);
  const [attached,setAttached]=useState(true),[text,setText]=useState("");
  const [pulse,setPulse]=useState(false),[material,setMaterial]=useState(false);
  const [frost,setFrost]=useState(7),[ink,setInk]=useState(24),[tint,setTint]=useState('#132331');
  const available=fabric.state.hosts.some(h=>h.status==='active');
  const sessionCount=fabric.state.sessions.filter(s=>s.id!=='scene').length;
  useEffect(()=>{if(!runtime.state.lastIntent||runtime.state.lastIntent.action==='no_match')return;setPulse(true);const timer=setTimeout(()=>setPulse(false),1800);return()=>clearTimeout(timer);},[runtime.state.lastIntent?.id]);
  const send=async(value:string)=>{if(!value.trim()||runtime.pending)return;try{await runtime.interpret(value);setText('');}catch{}};
  const submit=(e:FormEvent)=>{e.preventDefault();void send(text);};
  const tilt=(e:PointerEvent<HTMLDivElement>)=>{if(e.pointerType!=='mouse')return;const box=e.currentTarget.getBoundingClientRect();e.currentTarget.style.setProperty('--surface-rx',`${((e.clientY-box.top)/box.height-.5)*-1.4}deg`);e.currentTarget.style.setProperty('--surface-ry',`${((e.clientX-box.left)/box.width-.5)*1.4}deg`);};
  const untilt=(e:PointerEvent<HTMLDivElement>)=>{e.currentTarget.style.setProperty('--surface-rx','0deg');e.currentTarget.style.setProperty('--surface-ry','0deg');};
  return <section ref={exploration.stage} tabIndex={0} className={`vibe-stage ${controls?'':'exploration-mode'} ${exploration.engaged?'is-exploring':''} ${runtime.pending||pulse?'signal-moving':''} ${attached?'':'view-away'} ${sessionCount?'fabric-active':''}`} style={{'--glass-frost':`${frost}px`,'--glass-ink':`${ink}%`,'--glass-tint':tint} as CSSProperties} aria-label={isBrowserConcept?"PHUX concept, live browser compute":"Live PHUX fabric"}>
    <div className="vibe-universe"><Scene variant={1} settings={settings} ambient input={exploration.pointer}/></div><div className="vibe-shade"/>
    <div className="fabric-world">
      <LiveFabric fabric={fabric} attached={attached} revealedIds={controls?undefined:exploration.revealed} proximityPlaces={controls?undefined:exploration.places}/>
      <div className={`work-surface ${attached?'':'surface-away'}`} inert={!attached} onPointerMove={tilt} onPointerLeave={untilt}>
        <div className="surface-light-edge"/>
        <div className="surface-heading"><span><i className={runtime.state.connected?'status-dot':'status-dot offline'}/>studio <small>/ light</small></span><div><button className="surface-material" onClick={()=>setMaterial(v=>!v)} aria-label="Adjust glass material" aria-expanded={material} title="Glass material">◐</button><button className="surface-close hover-control" onClick={()=>setAttached(false)} aria-label="Close workspace view">×</button></div></div>
        <div className="surface-output"><Scene variant={1} settings={settings} active={attached} input={exploration.pointer}/></div>
        <div className="surface-message"><span className="surface-message-glyph">↗</span><p>{runtime.state.lastIntent?.text||'Your scene is running.'}</p></div>
        <div className="surface-footer"><button onClick={openTerminal} aria-label={isBrowserConcept?"Inspect browser runtime":"Open the native terminal"} title={isBrowserConcept?"Inspect browser runtime":"Native terminal"}>⌘</button><span>{formNames[runtime.state.shape]}<i/>{runtime.state.color}<i/>{runtime.state.speed}×</span><button className="surface-branch" onClick={()=>void fabric.addSession()} disabled={fabric.pending||!available} aria-label="Branch another workload" title="Branch a session">＋</button></div>
      </div>
      {!attached&&<button className="vibe-return" onClick={()=>setAttached(true)} aria-label="Reopen workspace view"><span>▣</span><i>↙</i></button>}
    </div>
    {controls&&<div className="fabric-actions"><button className={!sessionCount?'activate-fabric':''} onClick={()=>void (!sessionCount?fabric.activate():fabric.addSession())} disabled={fabric.pending||!available}>{fabric.pending?'Starting…':!available?'Connecting…':!sessionCount?'Activate fabric':'＋ Session'}<span>↗</span></button><button onClick={()=>void fabric.addHost()} disabled={fabric.pending||!available}>＋ Host</button></div>}
    {material&&<aside className="glass-controls" aria-label="Glass material controls"><header>Glass<button onClick={()=>setMaterial(false)} aria-label="Close material controls">×</button></header><label>Frost <input type="range" min="0" max="20" value={frost} onChange={e=>setFrost(Number(e.target.value))} aria-label="Glass frost"/><output>{frost}</output></label><label>Ink <input type="range" min="0" max="80" value={ink} onChange={e=>setInk(Number(e.target.value))} aria-label="Glass background opacity"/><output>{ink}</output></label><div className="glass-tints">{[['#132331','Ice'],['#15151b','Smoke'],['#38291b','Warm']].map(([color,name])=><button key={color} onClick={()=>setTint(color)} style={{background:color}} aria-label={`${name} glass tint`} aria-pressed={tint===color} title={name}/>)}</div></aside>}
    {!isBrowserConcept&&<div className="vibe-input-wrap" id="combo-intent"><form className="vibe-input" onSubmit={submit}><label htmlFor="fabric-intent" className={`vibe-input-mark ${runtime.pending?'is-thinking':''}`}>{runtime.pending?'✳':'Jev'}</label><input id="fabric-intent" value={text} onChange={e=>setText(e.target.value)} aria-label="Ask Jev to change the scene" placeholder="Make the light icy and slow…" autoComplete="off" maxLength={500} disabled={runtime.pending}/><div className="vibe-materials"><button type="button" className="material-glass" onClick={()=>void send('Liquid glass, icy, slow and subtle')} aria-label="Liquid glass" title="Liquid glass" disabled={runtime.pending}/><button type="button" className="material-horizon" onClick={()=>void send('An amber gravitational event horizon, calm and restrained')} aria-label="Event horizon" title="Event horizon" disabled={runtime.pending}/><button type="button" className="material-radiance" onClick={()=>void send('Violet radiance, quiet and expansive')} aria-label="Radiance" title="Radiance" disabled={runtime.pending}/></div><button className="vibe-send" type="submit" aria-label="Send to Jev" title="Send to Jev" disabled={runtime.pending||!text.trim()}>↗</button></form>{(runtime.error||fabric.error)&&<p className="vibe-error" role="alert">{fabric.error||runtime.error}</p>}</div>}
    {isBrowserConcept&&fabric.error&&<p className="vibe-error" role="alert">{fabric.error}</p>}
    <div className="exploration-aura" aria-hidden="true"/><div className="exploration-port" aria-hidden="true"><i/><i/><i/></div><span className="exploration-hint" aria-hidden="true">Move through it</span>
    <span className={`fabric-local-note ${isBrowserConcept?"public-runtime-note":""}`}><i className={runtime.state.connected?'status-dot':'status-dot offline'}/>{isBrowserConcept?"concept · browser compute":"native processes · local hosts"}</span>
    {typeof window!=='undefined'&&new URLSearchParams(window.location.search).has('perf')&&<Performance/>}
  </section>;
}
