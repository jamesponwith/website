export type LivePane = { id:string; x:number; y:number; cols:number; rows:number; cursorRow?:number };
export type LiveFrame = { cols:number; rows:number; panes:LivePane[] };

const integer = (value:unknown, min:number, max:number):value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const validIdentity = (id:unknown) => typeof id === "string" && id.length > 0 && id.length <= 128;
const validCursor = (p:LivePane) => p.cursorRow === undefined || integer(p.cursorRow,0,p.rows-1);
function fitsCanvas(p:LivePane,cols:number,rows:number) {
  return integer(p.x,0,cols-1) && integer(p.y,0,rows-1) && integer(p.cols,1,cols-p.x) && integer(p.rows,1,rows-p.y);
}
function validPane(value:unknown, cols:number, rows:number):value is LivePane {
  if (!value || typeof value !== "object") return false;
  const p = value as LivePane;
  return validIdentity(p.id) && fitsCanvas(p,cols,rows) && validCursor(p);
}
export function paneViewport(frame:LiveFrame,pane:LivePane,width:number,height:number,cell:{width:number;height:number}) {
  const cols = Math.floor(width/cell.width)*frame.cols/pane.cols;
  const rows = Math.floor(height/cell.height)*frame.rows/pane.rows;
  return {cols:Math.max(30,Math.min(480,Math.floor(cols))),rows:Math.max(8,Math.min(120,Math.floor(rows)))};
}
/** Presentation metadata comes from the validated PHUX client, never from a guessed layout. */
export function readLiveFrame(value:unknown):LiveFrame|null {
  if (!value || typeof value !== "object") return null;
  const frame = value as LiveFrame;
  if (!integer(frame.cols,1,1000) || !integer(frame.rows,1,1000) || !Array.isArray(frame.panes)) return null;
  if (frame.panes.length > 4 || !frame.panes.every(p=>validPane(p,frame.cols,frame.rows))) return null;
  if (new Set(frame.panes.map(p=>p.id)).size !== frame.panes.length) return null;
  return frame;
}
/** Follow the real terminal cursor; a preview shows useful rows instead of empty terminal height. */
export function paneCrop(frame:LiveFrame, pane:LivePane, width:number, height:number, visibleRows:number, visibleCols=pane.cols) {
  const rows = Math.min(pane.rows, visibleRows);
  const top = Math.max(0, Math.min(pane.rows-rows, (pane.cursorRow ?? 0)-rows+2));
  return { x:pane.x/frame.cols*width, y:(pane.y+top)/frame.rows*height, w:Math.min(pane.cols,visibleCols)/frame.cols*width, h:rows/frame.rows*height };
}
