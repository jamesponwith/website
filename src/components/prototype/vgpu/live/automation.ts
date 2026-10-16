type Shape = {phase:string;pending:boolean;panes:unknown[]};
/** Automation is allowed only in the untouched showcase, never in someone's active terminal. */
export function canAutoGrow(state:Shape,interacted:boolean) {
  return state.phase === "live" && !state.pending && state.panes.length === 2 && !interacted;
}
