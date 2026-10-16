import { useEffect, useRef, type MutableRefObject } from "react";
import type { LightLink, Point } from "./useLiquidLayout";

function along([a,b,c,d]:LightLink,t:number):Point {
  const s=1-t;
  return {x:s*s*s*a.x+3*s*s*t*b.x+3*s*t*t*c.x+t*t*t*d.x,y:s*s*s*a.y+3*s*s*t*b.y+3*s*t*t*c.y+t*t*t*d.y};
}
function fleck(ctx:CanvasRenderingContext2D,link:LightLink,t:number,lane:number,phase:number,alpha:number) {
  const p=along(link,t),q=along(link,Math.min(1,t+.008));
  const angle=Math.atan2(q.y-p.y,q.x-p.x),spread=Math.sin(t*Math.PI)*lane;
  const x=p.x-Math.sin(angle)*spread,y=p.y+Math.cos(angle)*spread;
  ctx.globalAlpha=alpha*.12;
  ctx.beginPath();ctx.ellipse(x,y,3.8,2.1,angle,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=alpha;
  ctx.beginPath();ctx.ellipse(x,y,.65+phase*.4,.5,angle,0,Math.PI*2);ctx.fill();
}
function paintLinks(ctx:CanvasRenderingContext2D,links:LightLink[],now:number,signal:number) {
  const energy=Math.exp(-Math.max(0,now-signal)/1500);
  ctx.globalCompositeOperation="lighter";
  links.forEach((link,index)=>{
    for(let i=0;i<28;i++){
      const seed=i*.61803398875+index*.19;
      const phase=seed%1,t=(now*.000105+seed)%1;
      const envelope=Math.pow(Math.sin(t*Math.PI),.7);
      const lane=Math.sin(seed*17+now*.0004)*(2+phase*13);
      ctx.fillStyle=i%5===0?"#d2bfb0":"#c2eaf1";
      fleck(ctx,link,t,lane,phase,envelope*(.45+energy*.4));
      if(i%3===0)fleck(ctx,link,Math.max(0,t-.025),lane,phase,envelope*.22);
    }
  });
  ctx.globalAlpha=1;ctx.globalCompositeOperation="source-over";
}

/** Bounded decorative dust; terminal paint events add energy without inventing workload telemetry. */
export function ParticleLinks({links,signal}:{links:MutableRefObject<LightLink[]>;signal:MutableRefObject<number>}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const element=canvas.current!,ctx=element.getContext("2d",{alpha:true});
    if(!ctx)return;
    let width=0,height=0,visible=true,raf=0,last=0,dirty=true;
    const reduced=matchMedia("(prefers-reduced-motion: reduce)");
    const invalidate=()=>{dirty=true;};
    const resize=new ResizeObserver(invalidate);resize.observe(element);
    window.addEventListener("resize",invalidate);reduced.addEventListener("change",invalidate);
    const intersection=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;});intersection.observe(element);
    const fit=()=>{
      width=element.clientWidth;height=element.clientHeight;
      const dpr=Math.min(devicePixelRatio||1,1.5);
      element.width=Math.round(width*dpr);element.height=Math.round(height*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);dirty=false;
    };
    const render=(now:number)=>{
      raf=requestAnimationFrame(render);
      if(document.hidden||!visible||now-last<1000/30)return;
      if(reduced.matches&&!dirty)return;
      last=now;if(dirty)fit();
      ctx.clearRect(0,0,width,height);
      if(reduced.matches)return;
      paintLinks(ctx,links.current,now,signal.current);
    };
    raf=requestAnimationFrame(render);
    return()=>{cancelAnimationFrame(raf);resize.disconnect();intersection.disconnect();window.removeEventListener("resize",invalidate);reduced.removeEventListener("change",invalidate);};
  },[links,signal]);
  return <canvas ref={canvas} className="live-particle-links" aria-hidden="true"/>;
}
