import { useLayoutEffect, useRef, type RefObject, type MutableRefObject } from "react";
import { advanceRect, advanceSpring, buddingRect, distanceToRect, easeBetween, type LiquidRect, type RectSpring, type Spring } from "./living";

export type Point = {x:number;y:number};
export type LightLink = [Point,Point,Point,Point] & {strength?:number};
export type GlassLayout = {rects:[number,number,number,number][];pulse?:number};
type Attention = {x:number;y:number;active:number};
type Pane = {id:string;node:HTMLElement;rest:LiquidRect;slot:RectSpring;parent?:string;spring:Spring};
const normalize=(rect:LiquidRect,width:number,height:number):[number,number,number,number]=>[(rect.x+rect.width/2)/width,(rect.y+rect.height/2)/height,rect.width/width,rect.height/height];
const localRect=(rect:DOMRect,base:DOMRect):LiquidRect=>({x:rect.x-base.x,y:rect.y-base.y,width:rect.width,height:rect.height});

function connection(parent:LiquidRect,child:LiquidRect,strength:number):LightLink {
  const vertical=child.y>parent.y+parent.height*.75;
  const a=vertical?{x:parent.x+parent.width*.58,y:parent.y+parent.height-12}:{x:parent.x+parent.width-12,y:parent.y+parent.height*.58};
  const b=vertical?{x:child.x+child.width*.46,y:child.y+12}:{x:child.x+12,y:child.y+child.height*.48};
  const bend=Math.max(24,(vertical?b.y-a.y:b.x-a.x)*.65);
  const link:LightLink=vertical?[a,{x:a.x,y:a.y+bend},{x:b.x,y:b.y-bend},b]:[a,{x:a.x+bend,y:a.y},{x:b.x-bend,y:b.y},b];
  link.strength=strength;return link;
}
function presentPane(pane:Pane,rect:LiquidRect,amount:number) {
  const opacity=easeBetween(.20,.72,amount);
  const dx=rect.x+rect.width/2-pane.rest.x-pane.rest.width/2;
  const dy=rect.y+rect.height/2-pane.rest.y-pane.rest.height/2;
  pane.node.style.transform=`translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px) scale(${(rect.width/pane.rest.width).toFixed(4)},${(rect.height/pane.rest.height).toFixed(4)})`;
  pane.node.style.opacity=opacity.toFixed(3);
  pane.node.style.pointerEvents=amount>.78?"auto":"none";
  pane.node.inert=amount<.78;
}
function advanceSlot(pane:Pane,dt:number,reduced:boolean) {
  pane.slot=reduced?{rect:pane.rest,velocity:{x:0,y:0,width:0,height:0}}:advanceRect(pane.slot,pane.rest,dt);
  const keys=["x","y","width","height"] as const;
  return keys.every(key=>Math.abs(pane.slot.rect[key]-pane.rest[key])<.05&&Math.abs(pane.slot.velocity[key])<.1);
}
function advancePane(pane:Pane,target:number,dt:number,reduced:boolean) {
  pane.spring=reduced?{position:target,velocity:0}:advanceSpring(pane.spring,target,dt);
  const amountReady=Math.abs(pane.spring.position-target)<.0003&&Math.abs(pane.spring.velocity)<.001;
  const slotReady=advanceSlot(pane,dt,reduced);
  return amountReady&&slotReady;
}
function presentLayout(list:Pane[],width:number,height:number) {
  const primary=list[0];
  if(!primary)return {rects:[] as GlassLayout["rects"],links:[] as LightLink[]};
  const displayed=new Map<string,LiquidRect>([[primary.id,primary.slot.rect]]);
  const rects=[normalize(primary.slot.rect,width,height)],links:LightLink[]=[];
  presentPane(primary,primary.slot.rect,1);
  list.slice(1).forEach((pane,index)=>{
    const parent=displayed.get(pane.parent||"")||primary.slot.rect;
    const p=Math.max(0,Math.min(1,pane.spring.position));
    const rect=buddingRect(pane.slot.rect,parent,p,index);
    presentPane(pane,rect,p);displayed.set(pane.id,rect);
    if(p>.015)rects.push(normalize(rect,width,height));
    if(p>.22)links.push(connection(parent,rect,easeBetween(.22,.85,p)));
  });
  return {rects,links};
}

/** One spring loop owns DOM transforms, optical geometry and particle attachment. */
export function useLiquidLayout(stage:RefObject<HTMLElement|null>,identity:string,expanded:boolean,attention:MutableRefObject<Attention>) {
  const glass=useRef<GlassLayout>({rects:[]}),links=useRef<LightLink[]>([]);
  const panes=useRef(new Map<string,Pane>());
  const engaged=useRef(false);
  const pulse=()=>{glass.current.pulse=performance.now();};
  useLayoutEffect(()=>{
    const root=stage.current;if(!root)return;
    let base=root.getBoundingClientRect(),width=base.width,height=base.height,dirty=true,settled=false,visible=true,raf=0,last=performance.now(),previousEngaged=false,lastDialogPulse=-1;
    const reduced=matchMedia("(prefers-reduced-motion: reduce)");
    const nodes=Array.from(root.querySelectorAll<HTMLElement>(".live-glass"));
    const measure=()=>{
      base=root.getBoundingClientRect();width=base.width;height=base.height;
      nodes.forEach(node=>{node.style.transform="none";});
      const next=new Map<string,Pane>();
      nodes.forEach((node,index)=>{
        const id=node.dataset.paneId||"primary",old=panes.current.get(id);
        // The real multiplexer publishes a split as [source, daughter].
        const parent=index===0?undefined:old?.parent||nodes[index-1].dataset.paneId;
        const rest=localRect(node.getBoundingClientRect(),base);
        const slot=old?.slot||{rect:rest,velocity:{x:0,y:0,width:0,height:0}};
        next.set(id,{id,node,parent,rest,slot,spring:old?.spring||{position:0,velocity:0}});
      });
      panes.current=next;dirty=false;settled=false;lastDialogPulse=-1;
      // Compensate the new DOM grid before paint, including the parent surface.
      const layout=presentLayout(Array.from(next.values()),width,height);
      if(!expanded){glass.current.rects=layout.rects;links.current=layout.links;}
    };
    const hero=(now:number,dt:number)=>{
      const list=Array.from(panes.current.values()),primary=list[0];if(!primary)return;
      const input=attention.current,x=(input.x+1)*width/2,y=(1-input.y)*height/2;
      const near=list.some(p=>distanceToRect(x,y,p.rest)<95);
      const awake=Boolean(input.active&&near);
      engaged.current=awake;
      if(awake===previousEngaged&&settled)return;
      if(awake!==previousEngaged){glass.current.pulse=now;previousEngaged=awake;}
      let complete=advanceSlot(primary,dt,reduced.matches);
      list.slice(1).forEach(pane=>{
        const parentPane=panes.current.get(pane.parent||"");
        const readiness=parentPane===primary?1:easeBetween(.18,.72,parentPane?.spring.position??1);
        const target=awake?readiness:0;
        if(!advancePane(pane,target,dt,reduced.matches))complete=false;
      });
      const layout=presentLayout(list,width,height);
      glass.current.rects=layout.rects;links.current=layout.links;
      settled=complete;
      root.dataset.liquidState=complete?(awake?"open":"folded"):(awake?"unfolding":"merging");
    };
    const dialog=(now:number)=>{
      const pulse=glass.current.pulse??0;
      if(lastDialogPulse===pulse&&now-pulse>800)return;
      const node=root.querySelector<HTMLDialogElement>(".live-terminal-dialog[open]");
      if(!node)return;
      glass.current.rects=[normalize(localRect(node.getBoundingClientRect(),base),width,height)];
      links.current=[];root.dataset.liquidState="focused";lastDialogPulse=pulse;
    };
    const tick=(now:number)=>{
      raf=requestAnimationFrame(tick);
      const dt=Math.min((now-last)/1000,.05);last=now;
      if(document.hidden||!visible)return;
      if(dirty)measure();
      if(!width||!height)return;
      if(expanded)dialog(now);else hero(now,dt);
    };
    const invalidate=()=>{dirty=true;};
    const observer=new ResizeObserver(invalidate);observer.observe(root);nodes.forEach(node=>observer.observe(node));
    const visibility=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;});visibility.observe(root);
    root.querySelectorAll(".live-terminal-dialog").forEach(node=>observer.observe(node));
    window.addEventListener("resize",invalidate);window.addEventListener("scroll",invalidate,{passive:true,capture:true});
    measure();raf=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(raf);observer.disconnect();visibility.disconnect();window.removeEventListener("resize",invalidate);window.removeEventListener("scroll",invalidate,true);};
  },[identity,expanded,stage,attention]);
  return {glass,links,pulse,engaged};
}
