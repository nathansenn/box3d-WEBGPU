import { PerspectiveCamera, Vector3 } from 'three/webgpu';

export const BRIDGE_FRAME_POINTS=[[-21,14.35,-1.9],[-21,14.35,1.9],[-23.1,.1,3.65],[-18.9,.1,-3.65],[21,14.35,-1.9],[23.1,1.1,3.65]];
export const BRIDGE_APPROACH_FRAME_POINTS=[[-34,4.88,-3.3],[-34,4.88,3.3],[-21,14.35,-1.9],[-21,14.35,1.9],[21,14.35,-1.9],[21,14.35,1.9],[32,4.88,0]];
export interface FrameRect {left:number;right:number;top:number;bottom:number}

/** Fit real structural anchors into available screen space, then center that
 * projected envelope. UI panels cannot crop the tower or force an arbitrary zoom.
 */
export function frameBridge(camera:PerspectiveCamera,target:Vector3,width:number,height:number,rect:FrameRect,points=BRIDGE_FRAME_POINTS):void {
  const delta=camera.position.clone().sub(target),point=new Vector3();
  camera.clearViewOffset();camera.aspect=width/height;
  for(let step=0;step<120;step++){
    camera.position.copy(target).addScaledVector(delta,1+step*.025);camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    const xs:number[]=[],ys:number[]=[];
    for(const p of points){point.fromArray(p).project(camera);xs.push((point.x+1)*width/2);ys.push((1-point.y)*height/2);}
    const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    if(right-left<=rect.right-rect.left&&bottom-top<=rect.bottom-rect.top){
      camera.setViewOffset(width,height,(left+right-rect.left-rect.right)/2,(top+bottom-rect.top-rect.bottom)/2,width,height);break;
    }
  }
  camera.updateProjectionMatrix();camera.updateMatrixWorld();
}
