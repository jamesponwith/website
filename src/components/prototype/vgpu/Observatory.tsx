import { isBrowserConcept } from "./transport";
import { useState } from "react";
import { Scene } from "./Scene";
import { IntentComposer } from "./IntentInstrument";
import { FlowRail, LiveStatus } from "./Pipes";
import { formNames, useLiveScene, type RuntimeControl } from "./runtime";

const kinds=[{id:"intent",label:"Intent",type:"input",color:"#bb9cf0",icon:"↗"},{id:"state",label:"State",type:"observe",color:"#8bc8dc",icon:"◈"},{id:"artifact",label:"Artifact",type:"artifact",color:"#b7ce9a",icon:"▧"},{id:"decision",label:"Needs you",type:"event",color:"#e8b67b",icon:"?"}];
export default function Observatory({runtime}:{runtime:RuntimeControl}){
  const [selected,setSelected]=useState("intent");
  const [approved,setApproved]=useState(false);
  const [replay,setReplay]=useState(0);
  const settings=useLiveScene(runtime.state);
  const chosen=kinds.find(k=>k.id===selected)!;
  const last=runtime.state.lastIntent;
  const live=selected==="state"||(!isBrowserConcept&&selected==="intent");
  const envelopes:Record<string,unknown>={intent:{from:last?.source||"browser",to:last?.action==="no_match"?"jev":"jev → light-instrument",kind:last?.action==="no_match"?"intent.no_match":"input",payload:last?.action==="no_match"?{request:last.text,status:"not dispatched; scene unchanged"}:last?{world:formNames[last.shape],color:last.color,speed:last.speed}:{intent:"Your next thought goes here"}},state:{from:"light-instrument",to:"all subscribed views",kind:"state",payload:{shape:runtime.state.shape,color:runtime.state.color,tick:runtime.state.ticks}},artifact:{from:"build-worker",to:"review-view",kind:"artifact",payload:{name:"test-results.json",mime:"application/json",status:"ready"}},decision:{from:"review-agent",to:"human",kind:"needs_input",payload:{question:"Apply the verified change?",status:approved?"answered":"waiting"}}};
  return <div className="observatory-v2">
    <div className="section-heading"><div><span className="eyebrow">04 / THE SHARED OBSERVATORY</span><h1>More than text.<br/><em>All on the same pipes.</em></h1></div><p>Intent, state, artifacts, decisions.<br/>Different things moving through one system.</p></div>
    <div className="observatory-shell"><div className="observatory-bar"><span><i className="status-dot"/>STUDIO / THE SHARED WORKSPACE</span><LiveStatus state={runtime.state}>Native scene live</LiveStatus></div>
      <div className="observatory-body"><div className="shared-pipe-map" key={`${selected}-${replay}`} style={{"--packet-color":chosen.color} as React.CSSProperties}>
        <div className="pipe-map-grid"/>
        <div className="pipe-actors actors-top"><div className={`pipe-actor ${selected==="intent"?"active":""}`}><i>↗</i><span>You<small>ANY CLIENT</small></span></div><div className={`pipe-actor ${selected==="intent"?"active":""}`}><i>✳</i><span>Jev<small>TYPED INTENT</small></span></div><div className={`pipe-actor ${selected==="artifact"?"active":""}`}><i>⌁</i><span>Build worker<small>ARTIFACTS</small></span></div></div>
        <div className="shared-pipe"><div className="shared-pipe-track"><i className="flowing-message">{chosen.type}<span>{chosen.icon}</span></i><i className="flowing-message message-return">{selected==="decision"?(approved?"answer":"needs_input"):"state"}<span>↙</span></i></div><div className="shared-pipe-label"><b>phux</b><span>INPUT · OBSERVE · EVENTS · RESOURCES</span></div></div>
        <div className="pipe-actors actors-bottom"><div className={`pipe-actor ${selected==="state"||selected==="intent"?"active":""}`}><i>◈</i><span>Light instrument<small>LIVE RENDER</small></span></div><div className={`pipe-actor ${selected==="decision"?"active":""}`}><i>?</i><span>Review agent<small>NEEDS A DECISION</small></span></div><div className="pipe-actor"><i>▣</i><span>Your views<small>SAME RESOURCES</small></span></div></div>
        <div className="pipe-map-foot"><span>ROUTING ILLUSTRATION / LIVE STATE BELOW.</span><button onClick={()=>setReplay(v=>v+1)} aria-label="Replay the selected message">↻ Replay</button></div>
      </div><aside className="observatory-render"><div className="render-card-heading"><span><i className="status-dot"/>LIGHT-INSTRUMENT</span><span>LIVE OUTPUT</span></div><div className="observatory-live-scene"><Scene variant={1} settings={settings} miniature/></div><div className="render-card-caption"><h2>{formNames[runtime.state.shape]}</h2><span>{runtime.state.color} / {runtime.state.speed}×</span></div><div className="mirrored-view"><span>▯</span><div><b>A second view</b><p>Same {formNames[runtime.state.shape].toLowerCase()}. Same {runtime.state.color}. Same process.</p></div><a href={`${isBrowserConcept?"/concepts/vgpu":"/prototype/vgpu"}?variant=instrument&controller=phone`} target="_blank" rel="noreferrer">↗<span className="sr-only">Open second controller</span></a></div></aside></div>
      <div className="payload-inspector"><div className="payload-selection"><span className="eyebrow">SAME ROUTING. DIFFERENT MEANING.</span><div>{kinds.map(k=><button key={k.id} onClick={()=>setSelected(k.id)} aria-pressed={selected===k.id}><i style={{background:k.color}}/>{k.label}<span>{k.type}</span></button>)}</div><p>{live?"Reading the actual light-instrument state and its most recent intent.":"A protocol illustration: this payload demonstrates another kind of work on the same shared fabric."}</p></div><div className="payload-code"><div><span>{live?"LIVE APPLICATION TRACE":"PROTOCOL EXAMPLE"}</span><span>{last&&live?last.id.slice(0,12):"phux / resource envelope"}</span></div><pre>{JSON.stringify(envelopes[selected],null,2)}</pre>{selected==="decision"&&<button className="approve-button" onClick={()=>{setApproved(v=>!v);setReplay(v=>v+1);}}>{approved?"Answer delivered. Replay question":"Yes, apply the verified change"}<span>↵</span></button>}</div></div>
    </div>
    <section className="observatory-command"><div><span className="eyebrow">DON'T JUST WATCH IT.</span><h2>Put a thought<br/><em>on the wire.</em></h2><p>{isBrowserConcept?<>Change the live scene.<br/>Watch input become state, across browser tabs.</>:<>Ask Jev for a transformation.<br/>Watch input become state, in both views.</>}</p></div><IntentComposer runtime={runtime} compact/></section><FlowRail runtime={runtime}/>
  </div>;
}
