/** Reuses an entire shadow map only while every caster and light transform is unchanged. */
export class ShadowPassCache {
  private dirty=true;
  private light=new Float32Array(16);
  private instances=-1;
  private surfaceCount=-1;
  private surfacePath:string|null=null;
  rendered=0;
  reused=0;
  invalidate():void {this.dirty=true;}
  needsRender(uniforms:ArrayLike<number>,instances:number,surfaceCount:number,surfacePath:string|null):boolean {
    if(this.dirty||this.instances!==instances||this.surfaceCount!==surfaceCount||this.surfacePath!==surfacePath)return true;
    for(let i=0;i<16;i++)if(this.light[i]!==uniforms[16+i])return true;
    this.reused++;return false;
  }
  /** Commit only after successful queue submission. A failed frame remains dirty. */
  submitted(uniforms:ArrayLike<number>,instances:number,surfaceCount:number,surfacePath:string|null):void {
    for(let i=0;i<16;i++)this.light[i]=uniforms[16+i];
    this.instances=instances;this.surfaceCount=surfaceCount;this.surfacePath=surfacePath;this.dirty=false;this.rendered++;
  }
}
