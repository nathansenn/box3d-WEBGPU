import type {LabFrame} from './models';

export type ExportedLabFrame=Omit<LabFrame,'positions'|'rotations'|'damage'> & {
  positions:number[];rotations:number[];damage:number[];
};

function exportFrame(frame:LabFrame):ExportedLabFrame {
  return {...frame,positions:Array.from(frame.positions),rotations:Array.from(frame.rotations),damage:Array.from(frame.damage),metrics:[...frame.metrics],
    ...(frame.collisions?{collisions:{...frame.collisions}}:{}),...(frame.hydraulics?{hydraulics:{...frame.hydraulics}}:{})};
}

/** History is sampled less often than the solver. Include the current received
 * endpoint even when export happens between samples or while viewing replay. */
export function exportRunFrames(history:readonly LabFrame[],current:LabFrame):ExportedLabFrame[] {
  const frames=history.map(exportFrame),endpoint=exportFrame(current);
  if(frames.at(-1)?.time===current.time)frames[frames.length-1]=endpoint;
  else frames.push(endpoint);
  return frames;
}
