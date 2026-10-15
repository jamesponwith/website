import { isBrowserConcept } from "./transport";
import { useState, type FormEvent } from "react";
import { Scene } from "./Scene";
import { FlowRail, IntentReceipt, LiveStatus } from "./Pipes";
import { formNames, useLiveScene, type IntentSource, type RuntimeControl } from "./runtime";

export function IntentComposer({runtime,source="browser",compact=false}:{runtime:RuntimeControl;source?:IntentSource;compact?:boolean}){
  const [text,setText]=useState("");
  const send=async(value:string)=>{if(!value.trim())return;try{await runtime.interpret(value,source);setText("");}catch{/* Shared error is visible below the composer. */}};
  const submit=(e:FormEvent)=>{e.preventDefault();void send(text);};
  const suggestions=compact?["A slow amber event horizon","Liquid glass, cold and quiet"]:["A slow amber event horizon","Liquid glass, cold and quiet","Fold light into glass architecture"];
  if(isBrowserConcept)return <BrowserSceneControls runtime={runtime}/>;
  return <div className={`intent-composer ${compact?"composer-compact":""}`}>
    <div className="composer-caption"><span><i className="status-dot"/>INTENT / {source.toUpperCase()}</span><span>{runtime.pending?"JEV IS LISTENING":runtime.state.jevAvailable?"JEV CONNECTED":"JEV CONNECTION PENDING"}</span></div>
    <form onSubmit={submit}><label htmlFor={`intent-${compact?"compact":"main"}`}>↗</label><input id={`intent-${compact?"compact":"main"}`} aria-label="Tell Jev how to transform the scene" value={text} onChange={e=>setText(e.target.value)} placeholder="What should this world become?" autoComplete="off" maxLength={500} disabled={runtime.pending}/><button type="submit" disabled={runtime.pending||!text.trim()} aria-label="Send intent to Jev">{runtime.pending?<span className="thinking-orbit"/>:<><span>Make it happen</span>↵</>}</button></form>
    <div className="intent-suggestions">{suggestions.map(s=><button key={s} onClick={()=>void send(s)} disabled={runtime.pending}>{s}<span>↗</span></button>)}</div>
    {runtime.error&&<p className="intent-error" role="alert">{runtime.error}</p>}
  </div>;
}
export default function IntentInstrument({runtime,controller=false}:{runtime:RuntimeControl;controller?:boolean}){
  const settings=useLiveScene(runtime.state);
  const form=formNames[runtime.state.shape]||"Event horizon";
  if(controller)return <div className="phone-controller"><span className="eyebrow">A SECOND VIEW / SAME PROCESS</span><h1>A thought<br/>from over here.</h1><div className="controller-art"><Scene variant={1} settings={settings} miniature/></div><LiveStatus state={runtime.state}>Shared light instrument</LiveStatus><IntentComposer runtime={runtime} source="phone" compact/><p>This controller is a separate browser view. {isBrowserConcept?"Change the scene here and watch another tab on this browser respond.":"Send an intent here and watch the main scene respond."}</p><a href={`${isBrowserConcept?"/concepts/vgpu":"/prototype/vgpu"}?variant=instrument`} target="_blank" rel="noreferrer">Open the main stage ↗</a></div>;
  return <div className="intent-page">
    <section className="intent-hero">
      <div className="intent-stage"><Scene variant={1} settings={settings}/><div className="scene-axis axis-north">SIGNAL / IN</div><div className="scene-axis axis-east">LIGHT / OUT</div></div>
      <div className="intent-title"><span className="eyebrow">02 / THE LIVING FIELD</span><h1>A thought<br/>bends<br/><em>the world.</em></h1><p>Somewhere, you ask.<br/>Here, the whole world changes.</p></div>
      <div className="live-scene-title"><span className="eyebrow">MATTER / LIGHT / INTENT</span><h2 key={form}>{form}</h2><span>{runtime.state.color} / {runtime.state.speed}×</span></div>
      <div className="intent-stage-foot"><LiveStatus state={runtime.state}>Real PHUX process · live optical field</LiveStatus><a href={`${isBrowserConcept?"/concepts/vgpu":"/prototype/vgpu"}?variant=instrument&controller=phone`} target="_blank" rel="noreferrer">Send it from a second screen <span>↗</span></a></div>
      <div className="intent-dock"><IntentComposer runtime={runtime}/></div>
    </section>
    <section className="intent-understanding"><FlowRail runtime={runtime}/><IntentReceipt runtime={runtime}/><div className="intent-coda"><h2>The language is yours.<br/><em>The connection is phux.</em></h2><p>{isBrowserConcept?<>Refractive worlds. Gravitational light. Live controls.<br/>Browser workers compute. GPU views follow.<br/>Explore native PHUX and Jev in the connected lab.</>:<>Refractive worlds. Gravitational light. Your words.<br/>Jev interprets your intent. A persistent process applies it.<br/>Every attached browser follows the same scene state.</>}</p></div></section>
  </div>;
}

function BrowserSceneControls({runtime}:{runtime:RuntimeControl}) {
  const [error,setError]=useState("");
  const command=async(value:string)=>{try{await runtime.command(value);setError("");}catch(e){setError(e instanceof Error?e.message:"Scene unavailable");}};
  return <div className="intent-composer browser-scene-controls"><div className="composer-caption"><span><i className="status-dot"/>SCENE CONTROLS</span><span>BROWSER CONCEPT</span></div><div className="intent-suggestions">{[["shape torus","Event horizon"],["shape wave","Liquid glass"],["shape galaxy","Radiance"],["color ice","Ice"],["color amber","Amber"],["color violet","Violet"]].map(([value,label])=><button key={value} onClick={()=>void command(value)}>{label}<span>↗</span></button>)}</div>{error&&<p className="intent-error" role="alert">{error}</p>}</div>;
}
