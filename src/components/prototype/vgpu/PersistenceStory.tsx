import { useState } from "react";
import { Scene } from "./Scene";
import { LiveStatus } from "./Pipes";
import { elapsed, formNames, useLiveScene, type RuntimeControl } from "./runtime";

export default function PersistenceStory({runtime,openTerminal}:{runtime:RuntimeControl;openTerminal:()=>void}){
  const settings=useLiveScene(runtime.state);
  const [attached,setAttached]=useState(true);
  const [leftAt,setLeftAt]=useState(0);
  const [recovered,setRecovered]=useState(0);
  const [view,setView]=useState("Browser");
  const {state}=runtime;
  const decision=state.lastIntent?.action!=="no_match"?state.lastIntent:undefined;
  const unmatched=state.lastIntent?.action==="no_match";
  const close=()=>{setLeftAt(state.ticks);setRecovered(0);setAttached(false);};
  const attach=()=>{setRecovered(Math.max(0,state.ticks-leftAt));setAttached(true);};
  return <div className="persistence-v2">
    <div className="persistence-heading"><div><span className="eyebrow">01 / CONTINUITY</span><h1>Close the view.<br/><em>Keep the thread.</em></h1></div><p>A thought becomes work.<br/>A window comes and goes.<br/>Your process has somewhere to stay.</p></div>
    <section className={`continuity-stage ${attached?"":"view-is-closed"}`}>
      <div className="continuity-art"><Scene variant={1} settings={settings} detached={!attached}/></div>
      <div className="continuity-process"><span className="process-glyph">⌘</span><div><b>light-instrument</b><span><i className="status-dot"/>{state.connected?"RUNNING IN PHUX":"CONNECTION LOST"}</span></div><div className="process-clock"><b>{elapsed(state)}</b><span>PROCESS UPTIME</span></div></div>
      <div className="continuity-tether"><i/><span>one connection to the work</span></div>
      <div className={`purposeful-window ${attached?"":"is-closed"}`} aria-hidden={!attached}>
        <div className="purposeful-title"><div className="purposeful-tabs">{["Browser","Desktop"].map(v=><button key={v} tabIndex={attached?0:-1} aria-pressed={view===v} onClick={()=>setView(v)}>{v}</button>)}</div><span>studio / light-instrument</span><button className="integrated-close" tabIndex={attached?0:-1} onClick={close} aria-label="Close this view while keeping the process running">Close view <b>×</b></button></div>
        <div className="purposeful-output"><div className="intent-line"><span>you</span><p>{state.lastIntent?.text||"A light instrument. Make it something beautiful."}</p></div><div className="terminal-response"><span className="response-source">{decision?"jev":"scene"}</span><div><p>{decision?`Understood. ${formNames[decision.shape]||decision.shape}, ${decision.color}, ${decision.speed}× tempo.`:unmatched?"No scene action in that request. The current world keeps running.":"Your light instrument is running in a persistent PHUX session."}</p><span>{decision?"Typed intent delivered through phux.":"The window below is a view of its current state."}</span></div><b>{unmatched?"—":"✓"}</b></div><div className="work-line"><span className="work-line-rule"/><span>PROCESS {state.pid||"—"}</span><span>{state.ticks.toLocaleString()} updates</span><span className="status-text">{state.connected?"still running":"state unavailable"}</span></div>{recovered>0?<div className="return-receipt" role="status"><span>↙</span><div><b>Welcome back.</b><p>{recovered} updates while this view was closed. Same process. Same thread.</p></div></div>:<div className="closing-invitation"><span>↖</span><p>Use <b>Close view</b> above.<br/>Watch the process stay.</p></div>}</div>
      </div>
      {!attached&&<div className="closed-view-card" role="status"><span className="closed-symbol">▱</span><h2>The view is closed.</h2><p>The process has made <b>{Math.max(0,state.ticks-leftAt)}</b> more updates.</p><button className="primary-button" onClick={attach}>Pick up the thread <span>↙</span></button><span className="eyebrow">NOTHING TO RESTART.</span></div>}
      <div className="continuity-stage-foot"><LiveStatus state={state}>The process stays on the host</LiveStatus><span>THE VIEW CAN GO.</span></div>
    </section>
    <div className="continuity-after"><div><span className="eyebrow">PERSISTENCE, WITHOUT THE CEREMONY</span><h2>Same work.<br/><em>Another window.</em></h2></div><div><p>Leave the view. Return to the running process.<br/>Or open a second controller and carry on from there.</p><div className="inline-links"><button onClick={openTerminal}>Read the actual terminal ↗</button><a target="_blank" rel="noreferrer" href="/prototype/vgpu?variant=instrument&controller=phone">Open a second controller ↗</a></div><small>Client frames are illustrative. Process identity, uptime, input and state are live.</small></div></div>
  </div>;
}
