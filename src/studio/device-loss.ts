import type * as T from 'three/webgpu';

interface LostDevice {lost:Promise<{message?:string}>;popErrorScope():Promise<unknown>;}

/**
 * Reports the loss of a renderer's WebGPU device, whatever its reason. Three.js stays silent when
 * the reason is "destroyed", yet Chromium gives that reason when it destroys a device whose canvas
 * it cannot present, and the renderer would go on using the dead device. Does nothing on WebGL.
 */
export function watchDeviceLoss(renderer:T.WebGPURenderer,onLost:(message:string)=>void):void {
  const device=(renderer.backend as unknown as {device?:LostDevice|null}).device;
  if(!device)return;
  const lost=device.lost.then(info=>info.message||'device destroyed');
  void lost.then(onLost);
  // WebGPU resolves popErrorScope with null on a lost device. Chromium rejects the scopes that were
  // open when it dropped the device, and three.js leaves those rejections unhandled.
  const pop=device.popErrorScope.bind(device);
  device.popErrorScope=()=>pop().catch(error=>Promise.race([lost.then(()=>null),new Promise<never>((_,reject)=>setTimeout(()=>reject(error),1000))]));
}

/**
 * Resolves when the frames drawn so far have reached the GPU. A device the browser cannot present
 * is lost by its first frame, so a loss reported by then means WebGPU cannot be used on this page.
 */
export async function framesSettled(renderer:T.WebGPURenderer):Promise<void> {
  const device=(renderer.backend as unknown as {device?:{queue:{onSubmittedWorkDone():Promise<unknown>}}|null}).device;
  if(!device)return;
  await device.queue.onSubmittedWorkDone().catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,0));
}

/**
 * Creates and initializes a WebGL renderer. After a device loss the browser can refuse new
 * contexts for a moment while it restarts its GPU channel, so a refusal is retried briefly.
 */
export async function initWebGL(create:()=>T.WebGPURenderer):Promise<T.WebGPURenderer> {
  for(let attempt=1;;attempt++){
    const renderer=create();
    try{await renderer.init();return renderer;}
    catch(error){renderer.domElement.remove();if(attempt===5)throw error;await new Promise(resolve=>setTimeout(resolve,400));}
  }
}
