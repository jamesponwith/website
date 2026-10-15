import { type RuntimeControl, type RuntimeState } from "./runtime";

export function LiveStatus({state,children="Native process connected"}:{state:RuntimeState;children?:string}){return <span className="live-status"><i className={state.connected?"status-dot":"status-dot offline"}/>{state.connected?children:"Local runtime offline"}</span>;}
const stages=[{name:"You",detail:"an intention",icon:"↗"},{name:"Jev",detail:"a typed decision",icon:"✳"},{name:"phux",detail:"a routed input",icon:"⌘"},{name:"vgpu",detail:"a new world",icon:"◈"},{name:"Every view",detail:"the same state",icon:"▣"}];
export function FlowRail({runtime}:{runtime:RuntimeControl}){
  const {pending,state}=runtime;
  return <div className={`flow-rail ${pending?"is-thinking":""} ${state.lastIntent&&state.lastIntent.action!=="no_match"?"has-delivery":""}`} key={state.lastIntent?.id||"idle"} aria-label="Intent flows from a client through Jev and PHUX to the renderer and every view">
    {stages.map((stage,i)=><div className={`flow-stop flow-stop-${i}`} key={stage.name}><span className="flow-icon">{stage.icon}</span><div><b>{stage.name}</b><small>{pending&&i===1?"understanding…":stage.detail}</small></div>{i<4&&<span className="flow-wire"><i/></span>}</div>)}
  </div>;
}
export function IntentReceipt({runtime}:{runtime:RuntimeControl}){
  const decision=runtime.state.lastIntent;
  if(!decision)return <div className="receipt-idle">A sentence becomes a decision. A decision becomes an input. Every view gets the result.</div>;
  if(decision.action==="no_match")return <div className="receipt-idle">Jev found no scene action in “{decision.text}”. The running scene was left as it was.</div>;
  return <details className="intent-receipt"><summary><span className="receipt-check">✓</span><span>“{decision.text}”</span><span className="receipt-time">Jev / {decision.latencyMs} ms <b>Follow the message ↗</b></span></summary><div className="receipt-content"><div><span className="eyebrow">JEV'S DECISION</span><code>{JSON.stringify({shape:decision.shape,color:decision.color,speed:decision.speed},null,2)}</code></div><div><span className="eyebrow">PHUX INPUT</span><code>{decision.commands.join("\n")}</code></div><div><span className="eyebrow">THE RECEIPT</span><p>{decision.model}<br/>{Math.round(decision.confidence*100)}% confidence<br/>From {decision.source}<br/><span className="mono">{decision.id.slice(0,16)}</span></p></div></div></details>;
}
