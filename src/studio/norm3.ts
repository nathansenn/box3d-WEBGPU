/** Scaled, compensated three-component norm, with a host fallback for special values.
 * Arithmetic follows the three-argument FastMathHypot algorithm described in
 * https://raw.githubusercontent.com/v8/v8/main/src/builtins/math.tq .
 * Equivalence to any installed runtime must be tested; it is not an ECMAScript guarantee.
 */
export function scaledNorm3(x:number,y:number,z:number):number {
  const a=Math.abs(x),b=Math.abs(y),c=Math.abs(z),scale=Math.max(Math.max(a,b),c);
  if(!(scale>0&&scale<Infinity))return Math.hypot(x,y,z);
  const u=a/scale,v=b/scale,w=c/scale;
  const p=u*u,q=v*v,sum=p+q,compensation=(sum-p)-q;
  return Math.sqrt(sum+(w*w-compensation))*scale;
}
