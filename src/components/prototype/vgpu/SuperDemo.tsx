import { useState } from "react";
import Tour from "../../tour/Tour";
import { Scene } from "./Scene";
import { IntentComposer } from "./IntentInstrument";
import { FlowRail, IntentReceipt, LiveStatus } from "./Pipes";
import { formNames, useLiveScene, type RuntimeControl } from "./runtime";
import "../../../styles/terminal-surface.css";

export default function SuperDemo({runtime}:{runtime:RuntimeControl;openTerminal:()=>void}){
  const settings=useLiveScene(runtime.state);
  const [view,setView]=useState(true);
  return <div className="combo-page"><div className="combo-sky" aria-hidden="true"><Scene variant={1} settings={settings}/></div>
    <section className="combo-intro"><span className="eyebrow">05 / THE WHOLE THING</span><h1>One place for<br/><em>everything that runs.</em></h1><p>Your terminals. Your agents. Your machines. Your next idea.<br/>A shared language for getting from intent to something real.</p><div className="combo-actions"><a className="primary-button" href="#combo-intent">Give it an idea <span>↗</span></a><a href="https://docs.phux.sh/overview" target="_blank" rel="noreferrer">Meet phux <span>→</span></a></div></section>
    <section className="combo-world"><div className="combo-world-caption"><span>THE WORK IS ALIVE.</span><LiveStatus state={runtime.state}>Native light instrument running</LiveStatus></div>
      <div className="combo-workspace"><div className="combo-workspace-head"><div className="workspace-wordmark">phux<span>/ studio</span></div><div className="workspace-resource-tabs"><button aria-pressed={view} onClick={()=>setView(true)}>Workspace</button><button aria-pressed={!view} onClick={()=>setView(false)}>Scene</button></div><span className="workspace-status"><i className={runtime.state.connected?"status-dot":"status-dot offline"}/>{runtime.state.connected?"CONNECTED":"RECONNECTING"}</span></div>
        <div className={`combo-product-stage ${view?"":"workspace-hidden"}`}><div className="original-demo-label"><span>THE PHUX PRODUCT TOUR</span><span>ATTACH · AGENTS · WALK AWAY · REMOTE</span></div><div className="combo-tour"><Tour prepare={()=>{}}/><a className="combo-hosted-launch" href="https://phux.sh/embed" target="_blank" rel="noreferrer">Open the hosted demo <span>↗</span></a></div></div>
        {!view&&<div className="combo-scene-view"><div className="combo-scene-window"><Scene variant={1} settings={settings}/><div><span className="eyebrow">THE SAME RUNNING INSTRUMENT</span><h2>{formNames[runtime.state.shape]}</h2><span>PID {runtime.state.pid} / {runtime.state.ticks.toLocaleString()} updates</span></div></div></div>}
        <div className="combo-workspace-foot"><span>⌘ <b>studio</b> / a home for your running work</span><button onClick={()=>setView(v=>!v)}>{view?"Leave the workspace. See the scene.":"Return to the workspace."} <span>{view?"↗":"↙"}</span></button></div>
      </div>
      <div className="combo-world-floor"><span>ANY CLIENT.</span><span>ONE SHARED FABRIC.</span><span>EVERY POSSIBILITY.</span></div>
    </section>
    <section className="combo-intent" id="combo-intent"><div><span className="eyebrow">A DIFFERENT KIND OF DEMO</span><h2>What happens<br/><em>when you ask?</em></h2><p>A thought becomes intent. A running process turns it into light.<br/>Open another view. The world comes with you.</p><small>The product tour opens the existing hosted shell. The light instrument uses the isolated local native runtime.</small></div><IntentComposer runtime={runtime} compact/></section><FlowRail runtime={runtime}/><IntentReceipt runtime={runtime}/>
    <div className="combo-outro"><span className="eyebrow">BUILT FOR PEOPLE. OPEN TO AGENTS.</span><h2>Work. Play.<br/>Keep going.</h2><a href="https://phux.sh" target="_blank" rel="noreferrer">Explore phux ↗</a></div>
  </div>;
}
