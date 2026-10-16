import { mountPhuxTerminal, terminalCellMetrics, type HostedEvent, type PhuxController, type SessionBackend } from "../../../terminal/core";
import { readLiveFrame, type LiveFrame, type LivePane, paneCrop, paneViewport } from "./frames";

export type WorkspaceState = {
  phase:"idle"|"connecting"|"live"|"closed"|"error";
  backend?:SessionBackend; panes:LivePane[]; focused:string; pending:boolean; error:string;
};
const initialState:WorkspaceState = {phase:"idle",panes:[],focused:"",pending:false,error:""};
let serial = 0;
type Projection = { canvas:HTMLCanvasElement; pane:string; rows:number; visible:boolean };

/** One real hosted connection owns all terminals. Views never own their session. */
export class LiveWorkspace {
  private state = initialState;
  private listeners = new Set<()=>void>();
  private client?:PhuxController;
  private abort?:AbortController;
  private canvas?:HTMLCanvasElement;
  private home?:HTMLDivElement;
  private surface?:HTMLDivElement;
  private frame?:LiveFrame;
  private projections = new Set<Projection>();
  private paint = 0;
  private labels = new Map<string,number>();
  private disposed = false;
  private presentation?:{id:string;target:HTMLDivElement;fit:()=>void};
  getSnapshot = () => this.state;
  subscribe = (listener:()=>void) => { this.listeners.add(listener); return ()=>{this.listeners.delete(listener);}; };
  label = (id:string) => `shell ${String(this.labels.get(id) ?? 1).padStart(2,"0")}`;
  private update(patch:Partial<WorkspaceState>) {
    this.state = {...this.state,...patch};
    this.listeners.forEach(listener=>listener());
  }
  async start(home:HTMLDivElement, wsUrl:string) {
    if (this.abort || this.disposed) return;
    if (!wsUrl) { this.update({phase:"error",error:"The hosted demo is not configured."}); return; }
    this.labels.clear(); this.frame = undefined;
    this.update({...initialState,backend:undefined,phase:"connecting"});
    this.home = home;
    this.surface = document.createElement("div");
    this.surface.className = "live-source-surface";
    this.surface.inert = true;
    this.canvas = document.createElement("canvas");
    this.canvas.id = `phux-glass-${++serial}`;
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label","Live PHUX terminal. Type commands here.");
    this.surface.append(this.canvas);
    home.replaceChildren(this.surface);
    const abort = new AbortController();
    this.abort = abort;
    this.listen(abort.signal);
    this.update({phase:"connecting",error:""});
    try {
      const client = await mountPhuxTerminal({wsUrl,canvasId:this.canvas.id,cols:120,rows:24,mode:"demo",appearance:"glass",signal:abort.signal,onEvent:this.lifecycle});
      if (abort.signal.aborted) { client.close(); return; }
      this.client = client;
      // Establish presentation before the fresh terminal becomes interactive.
      if (this.state.backend==="edge") client.sendText("theme glass\n");
      this.update({phase:"live"});
      this.schedulePaint();
    } catch {
      if (!abort.signal.aborted) this.fail("Couldn’t connect to PHUX. Try again.");
    }
  }
  private listen(signal:AbortSignal) {
    this.canvas!.addEventListener("phux-render",event=>this.receiveFrame((event as CustomEvent).detail),{signal});
    this.canvas!.addEventListener("phux-panes",event=>this.receivePanes((event as CustomEvent).detail),{signal});
    document.addEventListener("visibilitychange",()=>this.schedulePaint(),{signal});
    window.addEventListener("pagehide",event=>{if (!(event as PageTransitionEvent).persisted) this.dispose();},{signal});
  }
  private lifecycle = (event:HostedEvent) => {
    if (event.type === "phux.session.v1") { this.update({backend:event.backend}); return; }
    const message = event.type === "close" ? "This session has ended. Start a fresh workspace." : "The connection was interrupted. Try again.";
    this.fail(message);
  };
  private fail(error:string) {
    this.update({phase:"closed",pending:false,error});
    this.client?.close(); this.client = undefined;
    this.abort?.abort(); this.abort = undefined;
    cancelAnimationFrame(this.paint); this.paint = 0;
  }
  private receivePanes(detail:unknown) {
    if (!detail || typeof detail !== "object") return;
    const value = detail as {focused?:unknown;pending?:unknown;error?:unknown};
    this.update({focused:typeof value.focused === "string" ? value.focused : "",pending:value.pending === true,error:typeof value.error === "string" ? value.error : ""});
  }
  private receiveFrame(detail:unknown) {
    const frame = readLiveFrame(detail);
    if (!frame) return;
    const resourcesChanged = frame.panes.map(p=>p.id).join("\0") !== this.frame?.panes.map(p=>p.id).join("\0");
    this.frame = frame;
    frame.panes.forEach(p=>{if(!this.labels.has(p.id))this.labels.set(p.id,this.labels.size+1);});
    const structural = (panes:LivePane[])=>JSON.stringify(panes.map(({cursorRow,...pane})=>pane));
    if (structural(frame.panes) !== structural(this.state.panes)) this.update({panes:frame.panes});
    this.canvas!.dataset.renderer = "phux-web · live wire · libghostty";
    // A split can focus its resource before its first painted geometry arrives.
    if (resourcesChanged) this.presentation?.fit();
    this.placePresentation();
    this.schedulePaint();
  }
  private schedulePaint() {
    if (this.paint || document.hidden || this.disposed) return;
    this.paint = requestAnimationFrame(()=>{
      this.paint = 0;
      this.projections.forEach(view=>this.draw(view));
    });
  }
  private draw(view:Projection) {
    if (!view.visible || !this.frame || !this.canvas) return;
    const pane = this.frame.panes.find(p=>p.id === view.pane);
    const ctx = view.canvas.getContext("2d",{alpha:true});
    if (!pane || !ctx) return;
    const box = view.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const rows = Math.min(view.rows,Math.max(3,Math.floor(box.height/16)));
    const crop = paneCrop(this.frame,pane,this.canvas.width,this.canvas.height,rows,Math.max(20,Math.floor(box.width/8)));
    const dpr = Math.min(2,window.devicePixelRatio || 1);
    const width = Math.ceil(box.width*dpr), height = Math.ceil(box.height*dpr);
    if (view.canvas.width!==width) view.canvas.width=width;
    if (view.canvas.height!==height) view.canvas.height=height;
    ctx.clearRect(0,0,view.canvas.width,view.canvas.height);
    const scale = Math.min(view.canvas.width/crop.w,view.canvas.height/crop.h);
    ctx.drawImage(this.canvas,crop.x,crop.y,crop.w,crop.h,0,0,crop.w*scale,crop.h*scale);
    view.canvas.dataset.renderer = "phux-web · live pane";
    view.canvas.dataset.resourceId = pane.id;
  }
  project(pane:string, canvas:HTMLCanvasElement, rows=10) {
    const view:Projection = {pane,canvas,rows,visible:false};
    this.projections.add(view);
    const observer = new IntersectionObserver(entries=>{view.visible=entries[0]?.isIntersecting ?? false;this.schedulePaint();});
    observer.observe(canvas);
    const resize = new ResizeObserver(()=>this.schedulePaint()); resize.observe(canvas);
    this.schedulePaint();
    return ()=>{observer.disconnect();resize.disconnect();this.projections.delete(view);};
  }
  focus(id:string) {
    this.client?.focusPane(id);
    if (!this.presentation) return;
    this.presentation.id = id;
    this.presentation.fit();
    this.placePresentation();
  }
  followFocus() {
    if (!this.presentation || !this.state.focused || this.presentation.id===this.state.focused) return;
    this.presentation.id=this.state.focused;
    this.presentation.fit(); this.placePresentation();
  }
  split() { this.client?.splitPane("vertical"); }
  command(text:string) { this.client?.sendText(text+"\n"); }
  focusInput() { this.canvas?.focus({preventScroll:true}); }
  present(id:string, target:HTMLDivElement) {
    if (!this.surface || !this.canvas || !this.client) return ()=>{};
    const surface = this.surface, canvas = this.canvas;
    surface.inert = false;
    target.replaceChildren(surface);
    const fit = () => {
      const cell = terminalCellMetrics(canvas.dataset);
      const pane = this.frame?.panes.find(p=>p.id===this.presentation?.id);
      if (!pane || !this.frame) return;
      // Resize the existing tree so the focused resource fills this viewport.
      const size = paneViewport(this.frame,pane,target.clientWidth,target.clientHeight,cell);
      this.client?.resize(size.cols,size.rows);
    };
    this.presentation = {id,target,fit};
    this.focus(id);
    const observer = new ResizeObserver(fit); observer.observe(target); fit();
    canvas.focus({preventScroll:true});
    return ()=>{
      observer.disconnect();
      this.presentation = undefined;
      surface.style.removeProperty("transform");
      surface.inert = true;
      this.home?.append(surface);
      this.client?.resize(120,24);
    };
  }
  private placePresentation() {
    if (!this.presentation || !this.surface || !this.canvas || !this.frame) return;
    const pane = this.frame.panes.find(p=>p.id===this.presentation?.id);
    if (!pane) return;
    const cell = terminalCellMetrics(this.canvas.dataset);
    this.surface.style.transform = `translate(${-pane.x*cell.width}px,${-pane.y*cell.height}px)`;
  }
  dispose() {
    this.disposed = true;
    this.abort?.abort(); this.abort = undefined;
    this.client?.close(); this.client = undefined;
    cancelAnimationFrame(this.paint);
    this.surface?.remove();
    this.projections.clear(); this.listeners.clear();
  }
}
