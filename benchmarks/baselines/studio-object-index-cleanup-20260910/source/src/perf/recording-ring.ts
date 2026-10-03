/** Keeps the initial state plus the most recent samples without shifting the history. */
export class RecordingRing<T> {
  private readonly values:(T|undefined)[];
  private first:T;
  private head=0;
  private count=0;
  readonly capacity:number;
  evicted=0;
  constructor(first:T,capacity=601){
    if(!Number.isSafeInteger(capacity)||capacity<2)throw new RangeError('Recording capacity must be at least two');
    this.capacity=capacity;this.first=first;this.values=new Array(capacity-1);
  }
  get length():number{return this.count+1;}
  push(value:T):void {
    if(this.count===this.values.length)this.evicted++;
    this.values[this.head]=value;this.head=(this.head+1)%this.values.length;this.count=Math.min(this.count+1,this.values.length);
  }
  at(index:number):T|undefined {
    if(index<0)index+=this.length;
    if(index===0)return this.first;
    if(!Number.isInteger(index)||index<0||index>this.count)return undefined;
    return this.values[(this.head-this.count+index-1+this.values.length)%this.values.length];
  }
  forEach(fn:(value:T,index:number)=>void):void {for(let i=0;i<this.length;i++)fn(this.at(i)!,i);}
  map<U>(fn:(value:T,index:number)=>U):U[]{const result:U[]=[];this.forEach((value,index)=>result.push(fn(value,index)));return result;}
}
