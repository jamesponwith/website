import { useEffect, useRef, useState } from "react";
import { Scene, initialSettings, type SceneSettings } from "./Scene";
import { LiveStatus } from "./Pipes";
import { type RuntimeControl } from "./runtime";

const workloads=[
  {id:"render",name:"Light instrument",kind:"RENDER",host:"render-node",icon:"◈",input:{shape:"helix",color:"ice"},result:"scene.state",note:"A visual workload. Typed inputs become light; scene state comes back to its views."},
  {id:"agent",name:"Jev",kind:"INTELLIGENCE",host:"studio",icon:"✳",input:{intent:"make it a little more cosmic"},result:"decision.ready",note:"A semantic workload. Natural language goes in; a typed decision returns."},
  {id:"build",name:"Build & verify",kind:"PROCESS",host:"studio",icon:"⌁",input:{command:"cargo test"},result:"process.output",note:"A familiar workload. A process receives input, produces output, and reports when it exits."},
  {id:"play",name:"Orbital playground",kind:"PLAY",host:"render-node",icon:"◎",input:{gravity:.4,tempo:1.2},result:"simulation.state",note:"A playful workload. The same routing model can carry simulation controls and state."},
];
const envelopeTypes=["input","observe","event","artifact"];
export default function FederationStage({runtime}:{runtime:RuntimeControl}){
  const settings=useRef<SceneSettings>({...initialSettings,color:[.29,.72,.77],speed:.25});
  const [selected,setSelected]=useState(0);
  const [kind,setKind]=useState("input");
  const [step,setStep]=useState(-1);
  const [flight,setFlight]=useState(0);
  useEffect(()=>{if(step<0||step>=3)return;const timer=setTimeout(()=>setStep(s=>s+1),850);return()=>clearTimeout(timer);},[step,flight]);
  const item=workloads[selected];
  const trace=()=>{setFlight(f=>f+1);setStep(0);};
  const payloads:Record<string,unknown>={input:item.input,observe:{subscribe:item.id,cursor:"latest"},event:{type:item.result,resource:item.id},artifact:{resource:item.id,mime:item.id==="build"?"text/plain":"application/json"}};
  return <div className="federation-page">
    <div className="section-heading"><div><span className="eyebrow">03 / A FEDERATION OF POSSIBILITIES</span><h1>Your work has<br/><em>more than one home.</em></h1></div><p>A shell. An agent. A render. A little fun.<br/>Different workloads. One way to reach them.</p></div>
    <div className="federation-workbench"><div className="federation-top"><span><i className="status-dot"/>THE SHARED FABRIC</span><span>INTERACTIVE ROUTING ILLUSTRATION</span></div>
      <div className="federation-map">
        <div className="federation-ambient"><Scene variant={2} settings={settings}/></div>
        <div className="client-row"><div><span className="client-icon">▣</span>Browser</div><div><span className="client-icon">⌘</span>Terminal</div><div><span className="client-icon">▯</span>Phone</div><span className="client-caption">ANY VIEW. ANYWHERE.</span></div>
        <svg className="federation-wires" viewBox="0 0 1000 540" preserveAspectRatio="none" aria-hidden="true"><path d="M185 55 V140 Q185 180 225 180 H775 Q815 180 815 140 V55 M500 55 V230 M500 230 V300 Q500 330 460 330 H270 V395 M500 230 V300 Q500 330 540 330 H730 V395"/><path className={`selected-route route-${selected}`} d={selected===0||selected===3?"M500 55 V300 Q500 330 540 330 H730 V395":"M500 55 V300 Q500 330 460 330 H270 V395"}/>{step>=0&&step<3&&<circle r="4" className="travelling-packet" key={flight}><animateMotion dur="2.55s" fill="freeze" path={selected===0||selected===3?"M500 55 V300 Q500 330 540 330 H730 V395":"M500 55 V300 Q500 330 460 330 H270 V395"}/></circle>}</svg>
        <div className={`fabric-hub ${step===1?"is-receiving":""}`}><span>phux</span><small>ONE LANGUAGE</small><div className="fabric-stream-types"><i/>input<i/>state<i/>events</div></div>
        <div className="host-row"><div className={`federated-host ${item.host==="studio"?"host-selected":""}`}><div className="host-heading"><i className="host-mark">⌘</i><div><b>studio</b><small>THE LOCAL MACHINE</small></div><span>01</span></div><div className="host-workloads">{[1,2].map(i=><button key={i} onClick={()=>{setSelected(i);setStep(-1);}} aria-pressed={selected===i}><span>{workloads[i].icon}</span><div>{workloads[i].name}<small>{workloads[i].kind}</small></div><i>↗</i></button>)}</div></div><div className={`federated-host ${item.host==="render-node"?"host-selected":""}`}><div className="host-heading"><i className="host-mark">◈</i><div><b>render-node</b><small>ANOTHER MACHINE</small></div><span>02</span></div><div className="host-workloads">{[0,3].map(i=><button key={i} onClick={()=>{setSelected(i);setStep(-1);}} aria-pressed={selected===i}><span>{workloads[i].icon}</span><div>{workloads[i].name}<small>{workloads[i].kind}</small></div><i>↗</i></button>)}</div></div></div>
        <div className="map-caption">Resources have identities. Messages know where to go.</div>
      </div>
      <div className="federation-inspection"><div className="envelope-column"><div className="envelope-tabs" role="group" aria-label="Choose message type">{envelopeTypes.map(type=><button key={type} onClick={()=>{setKind(type);setStep(-1);}} aria-pressed={kind===type}>{type}</button>)}</div><pre><span className="json-comment">{'// ONE ENVELOPE. DIFFERENT PAYLOADS.\n'}</span>{JSON.stringify({from:"browser",to:`${item.host}/${item.id}`,kind,payload:payloads[kind]},null,2)}</pre></div><div className="route-explanation"><span className="eyebrow">{item.kind} / {item.host.toUpperCase()}</span><h2>{item.name}</h2><p>{item.note}</p><button className="primary-button" onClick={trace}>{step<0||step===3?"Follow this message":"Following the message…"}<span>→</span></button><div className="route-progress">{["client","phux","host","workload"].map((name,i)=><span key={name} className={step>=i?"reached":""}><i/>{name}</span>)}</div></div></div>
    </div>
    <div className="federation-coda"><h2>Work and play.<br/><em>On the same pipes.</em></h2><div><LiveStatus state={runtime.state}>The local light instrument is live</LiveStatus><p>This map illustrates federation. The live instrument shows the same idea with an actual native process and independent browser views.</p></div></div>
  </div>;
}
