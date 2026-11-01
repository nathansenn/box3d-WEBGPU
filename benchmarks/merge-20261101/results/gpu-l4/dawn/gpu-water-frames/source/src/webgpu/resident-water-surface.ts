import type {GpuLinearWater} from './linear-water.ts';

export interface ResidentWaterOptions { baseY?:number; renderStride?:number }

/** Owns presentation resources and borrows a solver's fields on the same device. */
export class ResidentWaterSurface {
  readonly indexBuffer:GPUBuffer;
  readonly indexCount:number;
  readonly renderVertexCount:number;
  readonly renderStride:number;
  private readonly params:GPUBuffer;
  private readonly bindings=new Map<GPUBuffer,GPUBindGroup>();
  private disposed=false;
  constructor(privateOwner:GpuLinearWater,device:GPUDevice,layout:GPUBindGroupLayout,options:ResidentWaterOptions={}) {
    this.owner=privateOwner;this.device=device;this.layout=layout;
    if(!this.owner.alive||this.owner.device!==device)throw new Error('Resident water requires a live solver on this renderer device.');
    const {cols,rows,dx,dz}=this.owner.config,baseY=options.baseY??0,stride=options.renderStride??1;
    if(!Number.isFinite(baseY)||!Number.isFinite(Math.fround(baseY))||!Number.isSafeInteger(stride)||stride<1||stride>Math.max(cols,rows))throw new RangeError('Invalid resident water presentation settings.');
    const axis=(size:number)=>{const ids=[];for(let id=0;id<size-1;id+=stride)ids.push(id);ids.push(size-1);return ids;};
    const xs=axis(cols),zs=axis(rows);
    this.renderVertexCount=xs.length*zs.length;this.renderStride=stride;
    if(this.renderVertexCount>16384)throw new RangeError('Resident water rendering is limited to 16384 mesh vertices; explicitly increase renderStride. The solver grid is unchanged.');
    const indices=new Uint32Array((xs.length-1)*(zs.length-1)*6);let offset=0;
    for(let z=0;z<zs.length-1;z++)for(let x=0;x<xs.length-1;x++){
      const a=zs[z]*cols+xs[x],b=zs[z]*cols+xs[x+1],c=zs[z+1]*cols+xs[x],d=zs[z+1]*cols+xs[x+1];
      indices.set([a,c,b,b,c,d],offset);offset+=6;
    }
    this.indexCount=indices.length;
    const allocated:GPUBuffer[]=[];
    try {
      this.indexBuffer=device.createBuffer({label:'Resident GPU water mesh indices',size:indices.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});allocated.push(this.indexBuffer);
      this.params=device.createBuffer({label:'Resident GPU water presentation parameters',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});allocated.push(this.params);
      const data=new ArrayBuffer(32);new Uint32Array(data).set([cols,rows,cols*rows,this.owner.velocityLayout==='east-north-faces'?1:0]);new Float32Array(data).set([(cols-1)*dx,(rows-1)*dz,baseY,0],4);
      device.queue.writeBuffer(this.indexBuffer,0,indices.buffer);device.queue.writeBuffer(this.params,0,data);
      this.bindGroup();
    }catch(error){for(const buffer of allocated)buffer.destroy();throw error;}
  }
  readonly owner:GpuLinearWater;
  private readonly device:GPUDevice;
  private readonly layout:GPUBindGroupLayout;
  bindGroup():GPUBindGroup {
    if(this.disposed)throw new Error('Resident water presentation is disposed.');
    const fields=this.owner.getFields();let binding=this.bindings.get(fields.eta);
    if(!binding){
      binding=this.device.createBindGroup({label:'Resident water numerical field binding',layout:this.layout,
        entries:[fields.eta,fields.u,fields.v,this.params].map((buffer,binding)=>({binding,resource:{buffer}}))});
      this.bindings.set(fields.eta,binding);
    }
    return binding;
  }
  dispose():void {if(this.disposed)return;this.disposed=true;this.indexBuffer.destroy();this.params.destroy();this.bindings.clear();}
}
