import type {Snapshot} from './physics';

/** Copies a loan into owned presentation storage before transfer buffers are recycled. */
export function copySnapshotInto(target:Snapshot,source:Snapshot):Snapshot {
  if(target.study!==source.study||target.positions.length!==source.positions.length||target.broken.length!==source.broken.length)throw new RangeError('Incompatible snapshot storage');
  target.positions.set(source.positions);target.broken.set(source.broken);target.strains.set(source.strains);
  target.topologyIdentity=source.topologyIdentity;target.topologyVersion=source.topologyVersion;target.punchY=source.punchY;
  Object.assign(target.response,source.response);
  if(source.press){if(!target.press)target.press={...source.press,settings:{...source.press.settings}};else{const settings=target.press.settings;Object.assign(target.press,source.press);target.press.settings=settings;Object.assign(settings,source.press.settings);}}
  else target.press=undefined;
  return target;
}

/** Presentation only; never alters authoritative solver positions or recorded samples. */
export function interpolateSnapshotInto(target:Snapshot,previous:Snapshot,current:Snapshot,alpha:number):Snapshot {
  copySnapshotInto(target,current);
  if(previous.study!==current.study||previous.topologyIdentity!==current.topologyIdentity||previous.response.time>=current.response.time)return target;
  const t=Math.max(0,Math.min(1,Number.isFinite(alpha)?alpha:1));
  for(let i=0;i<target.positions.length;i++)target.positions[i]=previous.positions[i]+(current.positions[i]-previous.positions[i])*t;
  target.punchY=previous.punchY+(current.punchY-previous.punchY)*t;
  return target;
}
