import { useLayoutEffect, useRef, type RefObject } from "react";

export type Point = {x:number;y:number};
export type LightLink = [Point,Point,Point,Point];
export type GlassLayout = {rects:[number,number,number,number][]};

/** Read layout only when it changes; both optical layers share the same measured geometry. */
export function useLiquidLayout(stage:RefObject<HTMLElement|null>, identity:string, expanded:boolean) {
  const glass = useRef<GlassLayout>({rects:[]});
  const links = useRef<LightLink[]>([]);
  useLayoutEffect(()=>{
    const root=stage.current;
    if(!root)return;
    const measure=()=>{
      const base=root.getBoundingClientRect();
      if(!base.width||!base.height)return;
      const panels=Array.from(root.querySelectorAll(expanded?".live-terminal-dialog[open]":".live-glass"));
      glass.current.rects=panels.slice(0,4).map(node=>{
        const box=node.getBoundingClientRect();
        return [(box.x-base.x+box.width/2)/base.width,(box.y-base.y+box.height/2)/base.height,box.width/base.width,box.height/base.height];
      });
      if(expanded){links.current=[];return;}
      const main=root.querySelector(".live-primary")?.getBoundingClientRect();
      if(!main)return;
      const stacked=base.width<1000;
      links.current=Array.from(root.querySelectorAll(".live-secondary")).map(node=>{
        const box=node.getBoundingClientRect();
        const a=stacked?{x:main.x-base.x+main.width*.58,y:main.bottom-base.y-14}:{x:main.right-base.x-14,y:main.y-base.y+main.height*.58};
        const b=stacked?{x:box.x-base.x+box.width*.46,y:box.y-base.y+14}:{x:box.x-base.x+14,y:box.y-base.y+box.height*.48};
        const bend=Math.max(30,(stacked?b.y-a.y:b.x-a.x)*.65);
        return stacked?[a,{x:a.x,y:a.y+bend},{x:b.x,y:b.y-bend},b]:[a,{x:a.x+bend,y:a.y},{x:b.x-bend,y:b.y},b];
      });
    };
    const observer=new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll(".live-glass,.live-terminal-dialog").forEach(node=>observer.observe(node));
    window.addEventListener("resize",measure);
    window.addEventListener("scroll",measure,{passive:true,capture:true});
    // Follow the short attachment transition, then stop all layout reads until an event.
    let raf=0,start=performance.now();
    const settle=(now:number)=>{measure();if(now-start<750)raf=requestAnimationFrame(settle);};
    raf=requestAnimationFrame(settle);measure();
    return()=>{cancelAnimationFrame(raf);observer.disconnect();window.removeEventListener("resize",measure);window.removeEventListener("scroll",measure,true);};
  },[identity,expanded,stage]);
  return {glass,links};
}
