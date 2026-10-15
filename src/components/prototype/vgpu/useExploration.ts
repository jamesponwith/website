import { useEffect, useRef, useState } from "react";
import type { FabricControl, FabricSession } from "./LiveFabric";
import type { Place } from "./fabric-layout";

function family(id:string,sessions:FabricSession[]):string[]{
 const parent=sessions.find(s=>s.id===id)?.parentSessionId;
 return parent&&parent!=='scene'?[...family(parent,sessions),id]:[id];
}

function revealFamily(current:Set<string>,id:string,all:FabricSession[]){
 const required=new Set(family(id,all));
 if(required.size>5)return current;
 const next=[...current,...required].filter((key,i,keys)=>keys.indexOf(key)===i);
 while(next.length>5){
  const removable=next.findIndex(key=>!required.has(key)&&!all.some(s=>s.parentSessionId===key&&next.includes(s.id)));
  if(removable<0)break;
  next.splice(removable,1);
 }
 return new Set(next);
}

// Motion changes refs; only a new attachment changes React state. Native actions are bounded.
export function useExploration(fabric:FabricControl,enabled=true,places:Map<string,Place>=new Map()){
 const stage=useRef<HTMLElement>(null),pointer=useRef({x:0,y:0,active:0});
 const latest=useRef(fabric);latest.current=fabric;
 const [revealed,setRevealed]=useState<Set<string>>(new Set()),[engaged,setEngaged]=useState(false);
 const visible=useRef(revealed);visible.current=revealed;
 const waitingParent=useRef<string|null>(null),waitingHost=useRef<Set<string>|null>(null),started=useRef(false);
 const [retry,setRetry]=useState(0);
 const sessions=fabric.state.sessions.filter(s=>s.id!=='scene');
 const identities=sessions.map(s=>s.id).join('|');
 const available=fabric.state.hosts.some(h=>h.status==='active');
 const geometry=useRef(places);geometry.current=places;
 const show=(id:string)=>{
  const all=latest.current.state.sessions;
  setRevealed(current=>{
   if(current.has(id))return current;
   return revealFamily(current,id,all);
  });
 };
 useEffect(()=>{
  if(!enabled||!available||sessions.length||document.hidden||started.current)return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>;
  started.current=true;
  void latest.current.activate().then(ok=>{started.current=false;if(!ok&&!cancelled)timer=setTimeout(()=>{if(!document.hidden)setRetry(n=>n+1);},2000);});
  return()=>{cancelled=true;clearTimeout(timer);};
 },[enabled,available,sessions.length,retry]);
 useEffect(()=>{
  const child=sessions.find(s=>s.parentSessionId===waitingParent.current);
  if(waitingParent.current&&child){show(child.id);waitingParent.current=null;}
  const arrival=waitingHost.current&&sessions.find(s=>!waitingHost.current!.has(s.id));
  if(arrival){show(arrival.id);waitingHost.current=null;}
 },[identities]);
 useEffect(()=>{
  const element=stage.current;if(!element||!enabled)return;
  const aura=element.querySelector<HTMLElement>('.exploration-aura');
  let revealTimer:ReturnType<typeof setTimeout>,branchTimer:ReturnType<typeof setTimeout>,leaveTimer:ReturnType<typeof setTimeout>;
  let candidate='',lastMove=0,lastPulse=0,lastBranch=0;
  const cancelDwell=()=>{candidate='';clearTimeout(revealTimer);clearTimeout(branchTimer);};
  const blocked=()=>document.hidden||Boolean(element.querySelector('[role="dialog"],.glass-controls,.fabric-world[data-arranging]'));
  const unfold=(session:FabricSession)=>{
   if(blocked())return;
   show(session.id);
   const now=performance.now(),control=latest.current;
   if(control.pending||session.paused||now-lastPulse<2200)return;
   lastPulse=now;void control.command(session.id,'pulse');
  };
  const branch=(session:FabricSession)=>{
   if(blocked())return;
   const control=latest.current,all=control.state.sessions;
   if(control.pending||performance.now()-lastBranch<3500)return;
   const child=all.find(s=>s.parentSessionId===session.id);
   if(child){show(child.id);return;}
   if(all.length>=7||family(session.id,all).length>=4)return;
   if((control.state.hosts.length===1||session.kind==='render')&&control.state.hosts.length<3&&pointer.current.x>.5){
    lastBranch=performance.now();waitingHost.current=new Set(all.map(s=>s.id));void control.addHost(session.hostId);return;
   }
   lastBranch=performance.now();waitingParent.current=session.id;
   void control.addSession(session.hostId,session.id);
  };
  const move=(event:PointerEvent)=>{
   if(blocked()||(event.target as Element).closest('input,.glass-controls,[role="dialog"]')){cancelDwell();return;}
   clearTimeout(leaveTimer);
   const box=element.getBoundingClientRect();
   const x=(event.clientX-box.left)/box.width,y=(event.clientY-box.top)/box.height;
   pointer.current.x=x*2-1;pointer.current.y=1-y*2;pointer.current.active=1;
   if(aura){aura.style.transform=`translate3d(${event.clientX-box.left-140}px,${event.clientY-box.top-140}px,0)`;aura.style.opacity='.55';}
   const now=performance.now();if(now-lastMove<120)return;lastMove=now;setEngaged(true);
   const all=latest.current.state.sessions.filter(s=>s.id!=='scene'&&geometry.current.has(s.id)).slice(0,7);
   const nearest=all.map(session=>{const place=geometry.current.get(session.id)!;return{session,distance:Math.hypot(x-(place.x+place.w/2)/100,y-(place.y+place.h/2)/100)};}).sort((a,b)=>a.distance-b.distance)[0];
   if(!nearest||nearest.distance>.46){candidate='';clearTimeout(revealTimer);clearTimeout(branchTimer);return;}
   if(candidate===nearest.session.id)return;
   candidate=nearest.session.id;clearTimeout(revealTimer);clearTimeout(branchTimer);
   revealTimer=setTimeout(()=>unfold(nearest.session),220);
   branchTimer=setTimeout(()=>branch(nearest.session),950);
  };
  const leave=()=>{
   pointer.current.active=0;if(aura)aura.style.opacity='0';candidate='';
   clearTimeout(revealTimer);clearTimeout(branchTimer);
   leaveTimer=setTimeout(()=>{setRevealed(new Set());setEngaged(false);},1800);
  };
  const visibility=()=>{cancelDwell();pointer.current.active=0;if(!document.hidden)setRetry(n=>n+1);};
  const focus=(event:FocusEvent)=>{if((event.target as Element).closest('input,textarea,select,[role="dialog"],.glass-controls'))cancelDwell();};
  const keyboard=(event:KeyboardEvent)=>{if(event.target!==element)return;if(event.key==='ArrowRight'){event.preventDefault();const next=latest.current.state.sessions.find(s=>s.id!=='scene'&&!visible.current.has(s.id));if(next){setEngaged(true);unfold(next);}}};
  element.addEventListener('pointermove',move,{passive:true});element.addEventListener('pointerdown',move,{passive:true});element.addEventListener('pointerleave',leave);element.addEventListener('keydown',keyboard);
  document.addEventListener('visibilitychange',visibility);
  element.addEventListener('focusin',focus);
  return()=>{cancelDwell();clearTimeout(leaveTimer);element.removeEventListener('pointermove',move);element.removeEventListener('pointerdown',move);element.removeEventListener('pointerleave',leave);element.removeEventListener('keydown',keyboard);element.removeEventListener('focusin',focus);document.removeEventListener('visibilitychange',visibility);};
 },[enabled]);
 return{stage,pointer,revealed,engaged,places};
}
