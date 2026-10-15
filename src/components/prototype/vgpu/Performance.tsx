import { useEffect, useRef, useState } from "react";

// Opt-in diagnostics. Kept outside the visual tree's animation/update loop.
export default function Performance() {
  const [run,setRun]=useState(0),[report,setReport]=useState("Warming up…");
  const output=useRef<HTMLOutputElement>(null);
  useEffect(()=>{
    if(output.current){for(const key of Object.keys(output.current.dataset))delete output.current.dataset[key];output.current.dataset.complete='false';output.current.dataset.run=String(run);}
    let raf=0,last=0,start=0,reported=0,done=false;
    const frames:number[]=[],tasks:number[]=[];
    const resources:PerformanceResourceTiming[]=[];
    const began=performance.now();
    const observers:PerformanceObserver[]=[];
    for(const type of ['longtask','resource']){
      if(!PerformanceObserver.supportedEntryTypes.includes(type))continue;
      const observer=new PerformanceObserver(list=>{
        for(const entry of list.getEntries()){
          if(!start||entry.startTime<start)continue;
          if(type==='longtask')tasks.push(entry.duration);
          else if(entry.name.includes('/__scene/'))resources.push(entry as PerformanceResourceTiming);
        }
      });
      observer.observe({type});observers.push(observer);
    }
    const summarize=(now:number)=>{
      const sorted=[...frames].sort((a,b)=>a-b);
      const percentile=(p:number)=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]||0;
      const canvases=Array.from(document.querySelectorAll<HTMLElement>('.vibe-stage .gpu-scene')).map(scene=>scene.querySelector<HTMLCanvasElement>(scene.dataset.renderer?.includes('WebGPU')?'canvas:not(.scene-fallback)':'canvas.scene-fallback')).filter((canvas):canvas is HTMLCanvasElement=>Boolean(canvas));
      const pixels=canvases.reduce((n,c)=>n+c.width*c.height,0);
      const elapsed=Math.max(.001,(now-start)/1000);
      const bytes=resources.reduce((n,r)=>n+r.encodedBodySize,0);
      const longtaskSupported=PerformanceObserver.supportedEntryTypes.includes('longtask');
      const renderers=canvases.filter(c=>c.dataset.renderFps);
      const rendererText=renderers.map(c=>`${Number(c.dataset.renderFps).toFixed(1)} fps${c.dataset.gpuMs?` / ${Number(c.dataset.gpuMs).toFixed(2)}ms GPU`:''}`).join(' · ');
      const text=`${done?'Captured':'Measuring'} · ${elapsed.toFixed(1)}s\n${(frames.length/elapsed).toFixed(1)} browser fps · p95 ${percentile(.95).toFixed(1)}ms\n${longtaskSupported?`${tasks.length} long tasks · ${tasks.reduce((a,b)=>a+b,0).toFixed(0)}ms`:'Long-task timing unavailable'}\n${rendererText?`Optics: ${rendererText}\n`:''}${canvases.length} views · ${(pixels/1e6).toFixed(2)}M backing pixels\n${resources.length} API requests · ${(bytes/1024/elapsed).toFixed(1)} KiB/s\n${Math.round(innerWidth)} × ${Math.round(innerHeight)}`;
      setReport(text);
      if(output.current){output.current.dataset.fps=(frames.length/elapsed).toFixed(2);output.current.dataset.p95=percentile(.95).toFixed(2);output.current.dataset.apiBytes=String(bytes);output.current.dataset.requests=String(resources.length);output.current.dataset.longTasks=String(tasks.length);output.current.dataset.pixels=String(pixels);output.current.dataset.complete=String(done);}
    };
    const sample=(now:number)=>{
      if(document.hidden){last=0;raf=requestAnimationFrame(sample);return;}
      if(now-began<2000){raf=requestAnimationFrame(sample);return;}
      if(!start&&document.querySelector('.vibe-stage .gpu-scene[data-ready="false"]')){
        if(now-reported>1000){reported=now;setReport('Waiting for optical renderers…');}
        raf=requestAnimationFrame(sample);return;
      }
      if(!start)start=now;
      if(last)frames.push(now-last);
      last=now;
      done=now-start>=10000;
      if(now-reported>1000||done){reported=now;summarize(now);}
      if(!done)raf=requestAnimationFrame(sample);else observers.forEach(o=>o.disconnect());
    };
    raf=requestAnimationFrame(sample);
    const invalidate=()=>{if(!done){cancelAnimationFrame(raf);observers.forEach(o=>o.disconnect());setReport('Visibility changed. Measure again.');if(output.current)output.current.dataset.complete='invalid';}};
    document.addEventListener('visibilitychange',invalidate);
    return()=>{cancelAnimationFrame(raf);observers.forEach(o=>o.disconnect());document.removeEventListener('visibilitychange',invalidate);};
  },[run]);
  return <aside className="performance-panel" aria-label="Measured performance"><output ref={output}>{report}</output><button onClick={()=>{if(output.current)output.current.dataset.complete='false';setReport('Warming up…');setRun(n=>n+1);}}>Measure again</button></aside>;
}
