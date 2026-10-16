import { mountPhuxTerminal, terminalCellMetrics, type HostedEvent, type PhuxController, type SessionBackend } from "../../../terminal/core";
import { readLiveFrame, type LiveFrame, type LivePane, paneCrop, paneViewport, paneInsets } from "./frames";

export type WorkspaceState = {
  phase:"idle"|"connecting"|"live"|"closed"|"error";
  backend?:SessionBackend; panes:LivePane[]; parents:Record<string,string>; focused:string; pending:boolean; error:string;
};
const initialState:WorkspaceState = {phase:"idle",panes:[],parents:{},focused:"",pending:false,error:""};
let serial = 0;
type Projection = { canvas:HTMLCanvasElement; pane:string; rows:number; visible:boolean };
const paneStructure=(panes:LivePane[])=>JSON.stringify(panes.map(({cursorRow,...pane})=>pane));
function announcement(value:unknown) {
  if(!value||typeof value!=="object")return;
  const data=value as {focused?:unknown;pending?:unknown;error?:unknown};
  return {focused:typeof data.focused==="string"?data.focused:"",pending:data.pending===true,error:typeof data.error==="string"?data.error:""};
}

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
  private presentation?:{id:string;target:HTMLDivElement};
  private fitFrame = 0;
  private size?:{cols:number;rows:number};
  private wirePending = false;
  private awaitingPaint = false;
  private announcedFocus = "";
  private splitSource?:string;
  private connection?:MutationObserver;
  constructor(private mount:typeof mountPhuxTerminal = mountPhuxTerminal) {}
  getSnapshot = () => this.state;
  subscribe = (listener:()=>void) => { this.listeners.add(listener); return ()=>{this.listeners.delete(listener);}; };
  label = (id:string) => `shell ${String(this.labels.get(id) ?? 1).padStart(2,"0")}`;
  private update(patch:Partial<WorkspaceState>) {
    this.state = {...this.state,...patch};
    this.syncInput();
    this.listeners.forEach(listener=>listener());
  }
  async start(home:HTMLDivElement, wsUrl:string) {
    if (this.abort || this.disposed) return;
    if (!wsUrl) { this.update({phase:"error",error:"The hosted demo is not configured."}); return; }
    this.labels.clear(); this.frame = undefined; this.size=undefined;
    this.wirePending=false;this.awaitingPaint=false;this.announcedFocus="";this.splitSource=undefined;
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
      const client = await this.mount({wsUrl,canvasId:this.canvas.id,cols:120,rows:24,mode:"demo",appearance:"glass",signal:abort.signal,onEvent:this.lifecycle});
      if (abort.signal.aborted) { client.close(); return; }
      this.client = client;
      this.size={cols:120,rows:24};
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
    // Internal protocol/bootstrap failures can close before hosted callbacks run.
    this.connection=new MutationObserver(()=>{
      if(this.canvas?.dataset.phuxConnection==="disconnected"&&!signal.aborted)this.fail("The connection was interrupted. Start a fresh workspace.");
    });
    this.connection.observe(this.canvas!,{attributes:true,attributeFilter:["data-phux-connection"]});
    document.addEventListener("visibilitychange",()=>this.schedulePaint(),{signal});
    window.addEventListener("pagehide",event=>{if (!(event as PageTransitionEvent).persisted) this.dispose();},{signal});
  }
  private lifecycle = (event:HostedEvent) => {
    if (event.type === "phux.session.v1") { this.update({backend:event.backend}); return; }
    const message = event.type === "close" ? "This session has ended. Start a fresh workspace." : "The connection was interrupted. Try again.";
    this.fail(message);
  };
  private fail(error:string) {
    this.connection?.disconnect();this.connection=undefined;
    this.abort?.abort(); this.abort = undefined;
    this.client?.close(); this.client = undefined;
    this.awaitingPaint=false;this.wirePending=false;this.splitSource=undefined;
    this.update({phase:"closed",pending:false,error});
    cancelAnimationFrame(this.paint); this.paint = 0;
    cancelAnimationFrame(this.fitFrame);this.fitFrame=0;
  }
  private receivePanes(detail:unknown) {
    const value=announcement(detail);if(!value)return;
    this.announcedFocus=value.focused;
    this.wirePending=value.pending;
    if(this.wirePending){this.awaitingPaint=true;this.splitSource??=this.state.focused;}
    const wasPending=this.state.pending;
    const error=value.error;
    if(error){this.awaitingPaint=false;this.splitSource=undefined;}
    const pending=this.wirePending||this.awaitingPaint;
    const focused=pending?this.state.focused:this.paintedFocus(this.state.panes);
    this.update({focused,pending,error});
    if(wasPending&&!pending)this.scheduleFit();
  }
  private receiveFrame(detail:unknown) {
    const frame = readLiveFrame(detail);
    if (!frame) return;
    const resourcesChanged = frame.panes.map(p=>p.id).join("\0") !== this.frame?.panes.map(p=>p.id).join("\0");
    this.frame = frame;
    frame.panes.forEach(p=>{if(!this.labels.has(p.id))this.labels.set(p.id,this.labels.size+1);});
    const completed=this.awaitingPaint&&!this.wirePending;
    this.commitFrame(frame,completed);
    this.canvas!.dataset.renderer = "phux-web · live wire · libghostty";
    const focusChanged=this.alignPresentation();
    if(resourcesChanged||completed||focusChanged)this.scheduleFit();
    this.placePresentation();
    this.schedulePaint();
    if(completed)this.focusInput();
  }
  private paintedFocus(panes:LivePane[]) {
    if(panes.some(p=>p.id===this.announcedFocus))return this.announcedFocus;
    if(panes.some(p=>p.id===this.state.focused))return this.state.focused;
    return panes[0]?.id||"";
  }
  private commitFrame(frame:LiveFrame,completed:boolean) {
    const parents=this.parentsFor(frame.panes);
    if(completed){this.awaitingPaint=false;this.splitSource=undefined;}
    const focused=this.paintedFocus(frame.panes);
    if (paneStructure(frame.panes) !== paneStructure(this.state.panes)||completed||focused!==this.state.focused) {
      this.update({panes:frame.panes,parents,focused,pending:this.wirePending||this.awaitingPaint});
    }
  }
  private alignPresentation() {
    if(!this.presentation||this.presentation.id===this.state.focused)return false;
    this.presentation.id=this.state.focused;return true;
  }
  private parentsFor(panes:LivePane[]) {
    const parents={...this.state.parents};
    const existing=new Set(this.state.panes.map(p=>p.id));
    panes.forEach(p=>{if(!existing.has(p.id)&&this.splitSource&&p.id!==this.splitSource)parents[p.id]=this.splitSource;});
    return parents;
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
    // A living pane scales visually; its projection keeps a sharp, stable backing store.
    const box = {width:view.canvas.clientWidth,height:view.canvas.clientHeight};
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
    if(!this.canAct()||!this.state.panes.some(p=>p.id===id))return;
    this.client?.focusPane(id);
    if (!this.presentation) return;
    this.presentation.id = id;
    this.scheduleFit();
    this.placePresentation();
  }
  private canAct() { return this.state.phase==="live"&&!this.state.pending&&Boolean(this.client); }
  split() {
    if(!this.canAct()||this.state.panes.length>=4)return;
    this.splitSource=this.state.focused;
    this.awaitingPaint=true;
    this.update({pending:true,error:""});
    try {this.client!.splitPane("vertical");}
    catch(error){this.awaitingPaint=false;this.splitSource=undefined;this.update({pending:false});throw error;}
  }
  command(text:string) { if(this.canAct())this.client!.sendText(text+"\n"); }
  focusInput() { if(this.canAct()&&this.presentation)this.canvas?.focus({preventScroll:true}); }
  private syncInput() {
    if(!this.surface)return;
    this.surface.inert=!this.presentation||this.state.phase!=="live"||this.state.pending;
  }
  private scheduleFit() {
    if(this.fitFrame||this.disposed)return;
    this.fitFrame=requestAnimationFrame(()=>{
      this.fitFrame=0;
      if(!this.canAct())return;
      const size=this.presentation?this.presentationSize():{cols:120,rows:24};
      if(size&&(size.cols!==this.size?.cols||size.rows!==this.size?.rows)){
        this.size=size;this.client!.resize(size.cols,size.rows);
      }
      this.focusInput();
    });
  }
  private presentationSize() {
    const pane=this.frame?.panes.find(p=>p.id===this.presentation?.id);
    if(!pane||!this.frame||!this.canvas||!this.presentation)return;
    const target=this.presentation.target;
    return paneViewport(this.frame,pane,target.clientWidth,target.clientHeight,terminalCellMetrics(this.canvas.dataset));
  }
  present(id:string, target:HTMLDivElement) {
    if (!this.surface || !this.canvas || !this.client) return ()=>{};
    const surface = this.surface, canvas = this.canvas;
    target.replaceChildren(surface);
    this.presentation = {id,target};
    this.syncInput();
    this.focus(id);
    const observer = new ResizeObserver(()=>this.scheduleFit());observer.observe(target);
    this.scheduleFit();this.focusInput();
    return ()=>{
      observer.disconnect();
      if(this.presentation?.target!==target)return;
      this.presentation = undefined;
      surface.style.removeProperty("transform");
      surface.style.removeProperty("clip-path");
      surface.inert = true;
      this.home?.append(surface);
      this.scheduleFit();
    };
  }
  private placePresentation() {
    if (!this.presentation || !this.surface || !this.canvas || !this.frame) return;
    const pane = this.frame.panes.find(p=>p.id===this.presentation?.id);
    if (!pane) return;
    const cell = terminalCellMetrics(this.canvas.dataset);
    this.surface.style.transform = `translate(${-pane.x*cell.width}px,${-pane.y*cell.height}px)`;
    // Deep splits can hit the client's total-grid limit. Clip to this actual
    // resource even when it cannot fill the entire dialog; never reveal a neighbor.
    const inset=paneInsets(this.frame,pane,cell);
    this.surface.style.clipPath=`inset(${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px)`;
    this.surface.dataset.paneId=pane.id;
  }
  dispose() {
    this.disposed = true;
    this.connection?.disconnect();this.connection=undefined;
    this.abort?.abort(); this.abort = undefined;
    this.client?.close(); this.client = undefined;
    cancelAnimationFrame(this.paint);
    cancelAnimationFrame(this.fitFrame);
    this.surface?.remove();
    this.projections.clear(); this.listeners.clear();
  }
}
