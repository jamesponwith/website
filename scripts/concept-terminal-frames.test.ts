import { expect, test } from 'bun:test';
import { workloadFrame, snapshotFrame, sceneFrame, terminalText } from '../src/components/prototype/vgpu/terminal-frames';
import type { FabricSession } from '../src/components/prototype/vgpu/LiveFabric';
import type { RuntimeState } from '../src/components/prototype/vgpu/runtime';
const session:FabricSession={id:'live',hostId:'studio',name:'compute 1',kind:'compute',ticks:40,paused:false,connected:true,metrics:{totalIterations:1234567,escapedCells:584,bins:[0,7,14,21,28,35,42,48]}};
test('VT program frame reflects actual computed samples and actual lifecycle',()=>{
 const frame=workloadFrame(session);
 expect(frame).toContain('1,234,567'); expect(frame).toContain('584'); expect(frame).toContain('running · tick 40');
 expect(frame).toContain('▁ ▂ ▃ ▄ ▅ ▆ ▇ █'); expect(frame.split('\r\n')).toHaveLength(5);
 expect(workloadFrame({...session,paused:true})).toContain('paused');
 expect(workloadFrame({...session,connected:false})).toContain('offline');
 expect(workloadFrame({...session,metrics:{}})).toContain('awaiting samples');
 expect(workloadFrame({...session,metrics:{totalIterations:Infinity,bins:[NaN]}})).not.toMatch(/Infinity|NaN/);
});
test('terminal text does not let data fields inject cursor movement or extra rows',()=>{
 expect(terminalText('hello\x1b[2J\r\nworld')).toBe('hello  world');
 expect(terminalText('x'.repeat(500))).toHaveLength(160);
 const frame=snapshotFrame(['first','actual output']); expect(frame).toContain('first\r\nactual output');
});
test('scene frame reports the command and state that actually ran',()=>{
 const frame=sceneFrame({lastCommand:'color ice',color:'ice',speed:.3,sceneTime:14.2,paused:true} as RuntimeState);
 expect(frame).toContain('color ice'); expect(frame).toContain('ice / 0.3× / 14.2s / paused');
 expect(frame).not.toContain('$');
});
