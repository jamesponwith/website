import { useEffect, useRef, useState } from "react";
import { initialSettings, type SceneSettings } from "./Scene";

export type IntentSource = "browser" | "phone" | "terminal";
export type IntentDecision = { id:string; text:string; shape:string; color:string; speed:number; confidence:number; model:string; latencyMs:number; commands:string[]; source:IntentSource; action?:string };
export type TraceEvent = { id:string; messageId:string; at:number; from:string; to:string; type:string; status:string; payload:unknown };
export type RuntimeState = { connected:boolean; ticks:number; speed:number; amplitude:number; shape:string; color:string; paused:boolean; burst:number; startedAt:number; lastCommand:string; pid:number; sceneTime?:number; serverTime?:number; jevAvailable:boolean; lastIntent?:IntentDecision; events:TraceEvent[] };
const empty:RuntimeState={connected:false,ticks:0,speed:1,amplitude:1,shape:"torus",color:"amber",paused:false,burst:0,startedAt:0,lastCommand:"scene start",pid:0,jevAvailable:false,events:[]};
export const palettes:Record<string,[number,number,number]>={amber:[1,.45,.19],violet:[.64,.43,1],cyan:[.24,.83,.85],rose:[1,.32,.47],ice:[.66,.85,1]};
export const forms=["torus","wave","sphere","galaxy","helix","lattice"];
export const formNames:Record<string,string>={torus:"Event horizon",wave:"Liquid memory",sphere:"The deep lens",galaxy:"Radiance field",helix:"Folded light",lattice:"Glass architecture"};
export function useRuntime(){
  const [state,setState]=useState<RuntimeState>(empty);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      try{const r=await fetch("/__scene/state",{signal:abort.signal});if(!r.ok)throw Error();const value=await r.json();if(!abort.signal.aborted)setState({...empty,...value});}
      catch{if(!abort.signal.aborted)setState(s=>({...s,connected:false}));}
      if(!abort.signal.aborted)timer=setTimeout(poll,250);
    }
    void poll();return()=>{abort.abort();clearTimeout(timer);};
  },[]);
  async function post(path:string,body:unknown){const response=await fetch(`/__scene/${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||"The scene could not receive this request.");return result;}
  async function command(text:string){await post("command",{command:text});}
  async function interpret(text:string,source:IntentSource="browser"){
    if(pending)return;
    setPending(true);setError("");
    try{const result=await post("intent",{text,source});const decision=result.decision||result;if(decision.action==="no_match")throw new Error("That thought needs a different kind of worker. Try liquid glass, a gravitational horizon, a color, or a change in motion.");setState(s=>({...s,lastIntent:decision}));return decision as IntentDecision;}
    catch(e){setError(e instanceof Error?e.message:"Jev is unavailable.");throw e;}
    finally{setPending(false);}
  }
  return{state,pending,error,interpret,command};
}
export type RuntimeControl=ReturnType<typeof useRuntime>;
export function useLiveScene(state:RuntimeState){
  const settings=useRef<SceneSettings>({...initialSettings,color:palettes.amber});
  const next:SceneSettings&{sceneTime?:number}={speed:state.speed,amplitude:state.amplitude,shape:Math.max(0,forms.indexOf(state.shape)),color:palettes[state.color]||palettes.amber,paused:state.paused,burst:state.burst,sceneTime:state.sceneTime};
  settings.current=next;return settings;
}
export function elapsed(state:RuntimeState){const seconds=state.startedAt?Math.max(0,Math.floor(((state.connected?Date.now():state.serverTime||state.startedAt)-state.startedAt)/1000)):0;return `${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;}
