// A small direct solver shared by the frame runtime's direct path (frame-runtime.ts) and the suspension
// bridge's statics (si-suspension.ts).

/** Symmetric positive definite matrix in dense storage of which only the lower envelope is used:
 * row i holds columns first[i]..i. Fill-in of the Cholesky factor stays inside the envelope, so a
 * node ordering along the bridge keeps the work to n b^2 for a band b. */
export class EnvelopeMatrix {
  readonly n:number;readonly first:Int32Array;readonly a:Float64Array;
  constructor(n:number,first:Int32Array){this.n=n;this.first=first;this.a=new Float64Array(n*n);}
  add(i:number,j:number,value:number):void {if(j>i){const t=i;i=j;j=t;}this.a[i*this.n+j]+=value;}
  copyFrom(other:EnvelopeMatrix):void {this.a.set(other.a);}
  /** In-place Cholesky factor (lower triangle within the envelope). */
  factor():void {
    const {n,first,a}=this;
    for(let i=0;i<n;i++){
      const fi=first[i],ri=i*n;
      for(let j=fi;j<=i;j++){
        const rj=j*n,start=Math.max(fi,first[j]);let s=a[ri+j];
        for(let k=start;k<j;k++)s-=a[ri+k]*a[rj+k];
        if(j<i)a[ri+j]=s/a[rj+j];
        else{if(!(s>0))throw new Error('The structure is a mechanism or has lost its stiffness (the tangent matrix is not positive definite).');a[ri+i]=Math.sqrt(s);}
      }
    }
  }
  solve(x:Float64Array):void {
    const {n,first,a}=this;
    for(let i=0;i<n;i++){let s=x[i];const r=i*n;for(let k=first[i];k<i;k++)s-=a[r+k]*x[k];x[i]=s/a[r+i];}
    for(let i=n-1;i>=0;i--){const r=i*n;x[i]/=a[r+i];const v=x[i];for(let k=first[i];k<i;k++)x[k]-=a[r+k]*v;}
  }
  /** y = A x for the symmetric matrix (not factored). */
  multiply(x:Float64Array,y:Float64Array):void {
    const {n,first,a}=this;y.fill(0);
    for(let i=0;i<n;i++){const r=i*n;let s=a[r+i]*x[i];const xi=x[i];for(let k=first[i];k<i;k++){s+=a[r+k]*x[k];y[k]+=a[r+k]*xi;}y[i]+=s;}
  }
}
