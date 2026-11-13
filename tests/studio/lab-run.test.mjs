// The material labs' free run (src/studio/material-labs/lab-run.ts): the worker steps fixed DT ticks toward wall time,
// records the history itself and publishes its newest frame; the result is the same as stepping DT by DT.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {LabRunLoop,LabRunChannel,LAB_RUN_MAX_UNACKED}=await import('../../src/studio/material-labs/lab-run.ts');
const {labWorkerState}=await import('../../src/studio/material-labs/lab-worker-protocol.ts');
const {labRunRouter}=await import('../../src/studio/material-labs/lab-run-host.ts');
const {createModel,GlassModel,DT}=await import('../../src/studio/material-labs/models.ts');
const {LABS}=await import('../../src/studio/material-labs/catalog.ts');

/** A host with a manual clock: schedule() queues, run() advances time and drains. */
function manualHost(){
  let now=0;const queue=[],posted=[];let failure;
  return {posted,get failure(){return failure;},
    host:{now:()=>now,schedule(task,delay){const entry={at:now+delay,task};queue.push(entry);return()=>{const i=queue.indexOf(entry);if(i>=0)queue.splice(i,1);};},post:(message)=>posted.push(message),fail:m=>{failure=m;}},
    advance(ms){const end=now+ms;for(;;){queue.sort((a,b)=>a.at-b.at);const next=queue[0];if(!next||next.at>end)break;queue.shift();now=Math.max(now,next.at);next.task();}now=end;},
  };
}
const frames=(posted,ack)=>{for(const m of posted)ack?.(m.run.sequence);return posted;};

test('a free run to the end equals stepping DT by DT, with the history cadence and every sample',()=>{
  for(const [lab,settings,end] of [['granular',{size:16,fill:40},.5],['concrete',LABS.concrete.defaults,.4]]){
    const model=createModel(lab,settings),direct=createModel(lab,settings),h=manualHost();
    const loop=new LabRunLoop(model,{type:'run',generation:0,request:1,speed:16,end,maxLag:10,release:true,sampleEvery:.06,nextSample:0},h.host);
    for(let i=0;i<4000&&loop.active;i++){h.advance(5);for(const m of h.posted.splice(0))(h.all??=[]).push(m),loop.ack(m.run.sequence);}
    assert.equal(h.failure,undefined);assert.equal(loop.active,false);
    const all=h.all,last=all.at(-1);
    assert.equal(last.run.running,false);assert.equal(last.run.stopReason,'end');
    direct.release();const times=[];let next=0;
    while(direct.frame.time<end-DT*1e-6){direct.step(DT);const t=direct.frame.time;if(t>=next||t>=end-DT*1e-6){times.push(t);next=t+.06;}}
    assert.deepEqual(last.frame,direct.snapshot());
    assert.deepEqual(all.flatMap(m=>m.history.map(f=>f.time)),times);
  }
});

test('the run never runs ahead of wall time and drops (and reports) a backlog beyond the lag bound',()=>{
  const model=new GlassModel({size:24,load:25,rate:.4}),h=manualHost();
  const loop=new LabRunLoop(model,{type:'run',generation:0,request:1,speed:1,end:60,maxLag:.25,release:false,sampleEvery:.06,nextSample:0},h.host);
  h.advance(500);for(const m of h.posted.splice(0))loop.ack(m.run.sequence);
  assert.ok(model.frame.time<=.5+1e-9,`ran ahead: ${model.frame.time}`);assert.ok(model.frame.time>=.5-DT-1e-9);
  loop.pause(2);h.advance(1);const final=h.posted.at(-1);assert.equal(final.request,2);assert.equal(final.run.stopReason,'pause');assert.equal(loop.active,false);
});

test('unacknowledged frames hold publication but not the history; acknowledgements release it',()=>{
  const model=createModel('granular',{size:16,fill:40}),h=manualHost();
  const loop=new LabRunLoop(model,{type:'run',generation:0,request:1,speed:2,end:2,maxLag:10,release:true,sampleEvery:.06,nextSample:0},h.host);
  h.advance(400);
  assert.equal(h.posted.length,LAB_RUN_MAX_UNACKED,'publication waits for acknowledgements');
  for(let i=0;i<4000&&loop.active;i++){for(const m of h.posted.slice(-1))loop.ack(m.run.sequence);h.advance(5);}
  const times=h.posted.flatMap(m=>m.history.map(f=>f.time));
  for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=.06-1e-9||times[i]>=2-1e-6,'cadence kept');
  assert.ok(Math.abs(times.at(-1)-2)<DT,'the last sample is the end');
});

test('the worker router: a pause without a run answers with the current frame; a step during a run ends it',()=>{
  const posted=[],route=labRunRouter(labWorkerState(),(m,t)=>posted.push(m),()=>[]);
  route({type:'reset',generation:0,lab:'concrete',settings:LABS.concrete.defaults});assert.equal(posted.at(-1).type,'frame');
  route({type:'pause',generation:0,request:5});assert.equal(posted.at(-1).run.stopReason,'pause');assert.equal(posted.at(-1).request,5);
  route({type:'run',generation:0,request:6,speed:1,end:10,maxLag:.25,release:false,sampleEvery:.06,nextSample:0});
  route({type:'step',generation:0,request:7,ticks:1,release:false});assert.equal(posted.at(-1).type,'frame');assert.equal(posted.at(-1).request,7);
});

test('the page channel acknowledges running frames and ends on the final one',()=>{
  const sent=[],channel=new LabRunChannel(m=>sent.push(m)),got=[];
  channel.start(3,{speed:1,end:5,maxLag:.25,sampleEvery:.06,nextSample:0},true);
  assert.equal(sent[0].type,'run');assert.equal(sent[0].release,true);assert.equal(channel.running,true);
  const frame=(request,running,sequence)=>({type:'frame',generation:0,request,frame:{time:sequence/10},cpuMs:5,history:[],run:{running,stopReason:running?null:'pause',lagSeconds:0,overloads:0,sequence,nextSample:0,ticks:12*sequence}});
  assert.equal(channel.owns(frame(3,true,1)),true);channel.accept(frame(3,true,1),f=>got.push(f));assert.deepEqual(sent.at(-1),{type:'ack',generation:0,sequence:1});
  channel.pause(4);assert.equal(sent.at(-1).type,'pause');assert.equal(channel.owns(frame(4,false,2)),true);
  channel.accept(frame(4,false,2),f=>got.push(f));assert.equal(channel.running,false);assert.equal(got.length,2);assert.equal(channel.release(),false);
});
