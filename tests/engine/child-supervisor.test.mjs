import assert from 'node:assert/strict';
import test from 'node:test';
import {lastJsonLine,superviseChild,verdictOf} from '../../scripts/supervise-child.mjs';

// Real child processes stand in for the benchmark and determinism children, so every way a child can end is exercised.
const node=(code,options={})=>superviseChild(process.execPath,['-e',code],{timeoutMs:20000,graceMs:5000,resultOf:lastJsonLine,...options});

test('a child that prints its result and exits is a plain success',async()=>{
  const run=await node('console.log(JSON.stringify({ok:1}))');
  assert.deepEqual(run.result,{ok:1});assert.equal(run.status,0);assert.equal(run.signal,null);
  assert.equal(run.exitHang,false);assert.equal(run.timedOut,false);
});

test('a child that prints its result and then never exits is killed after the grace and keeps its result',async()=>{
  const started=Date.now();
  const run=await node('console.log(JSON.stringify({ok:2}));setTimeout(()=>{},8000)',{graceMs:300});
  assert.deepEqual(run.result,{ok:2});assert.equal(run.exitHang,true);assert.equal(run.signal,'SIGKILL');assert.equal(run.timedOut,false);
  assert.ok(Date.now()-started<15000,'the grace, not the timeout, ended it');
});

test('a child that never prints a result is a timeout, not an exit hang',async()=>{
  const run=await node('setTimeout(()=>{},8000)',{timeoutMs:400});
  assert.equal(run.result,null);assert.equal(run.timedOut,true);assert.equal(run.exitHang,false);assert.equal(run.signal,'SIGKILL');
});

test('the timeout stops counting once the result is printed',async t=>{
  // The result arrives once the child has started; it then lives 2500 ms more, which runs past timeoutMs but stays
  // inside graceMs. It must end cleanly, not as a timeout.
  const run=await node('console.log(JSON.stringify({ok:3}));setTimeout(()=>{},2500)',{timeoutMs:1500,graceMs:10000});
  if(run.result===null&&run.timedOut)return t.skip('this host needed more than 1500 ms to start a child, so the premise cannot be tested');
  assert.deepEqual(run.result,{ok:3});assert.equal(run.status,0);assert.equal(run.timedOut,false);assert.equal(run.exitHang,false);
});

test('a child killed by a signal before it prints is reported with the signal',async()=>{
  const run=await node('process.kill(process.pid,"SIGKILL")');
  assert.equal(run.result,null);assert.equal(run.signal,'SIGKILL');assert.equal(run.status,null);
  assert.equal(run.timedOut,false);assert.equal(run.exitHang,false);
});

test('a failing exit after a printed result is still a failing exit',async()=>{
  const run=await node('console.log(JSON.stringify({ok:5}));process.exitCode=3');
  assert.deepEqual(run.result,{ok:5});assert.equal(run.status,3);assert.equal(run.exitHang,false);assert.equal(run.timedOut,false);
});

test('a result written in two pieces is used only once its line is complete',async()=>{
  const run=await node('process.stdout.write(\'{"ok":\');setTimeout(()=>process.stdout.write("6}\\n"),200)',{graceMs:5000});
  assert.deepEqual(run.result,{ok:6});assert.equal(run.status,0);
});

test('stdout is forwarded as it arrives and the stderr tail is kept',async()=>{
  const chunks=[];
  const run=await node('console.error("diagnostic");console.log("progress");console.log(JSON.stringify({ok:7}))',{forward:(chunk)=>chunks.push(chunk)});
  assert.equal(chunks.join(''),'progress\n{"ok":7}\n');assert.match(run.stderr,/diagnostic/);
});

test('a command that cannot start is reported, not thrown',async()=>{
  const run=await superviseChild('/nonexistent/box3d-test-command',[],{timeoutMs:5000,graceMs:5000,resultOf:lastJsonLine});
  assert.equal(run.result,null);assert.match(String(run.signal),/spawn failed/);
});

test('lastJsonLine takes the last complete JSON object line and never a partial one',()=>{
  assert.deepEqual(lastJsonLine('{"a":1}\n'),{a:1});
  assert.equal(lastJsonLine('{"a":1}'),null);
  assert.deepEqual(lastJsonLine('log\n{"a":1}\nmore\n'),{a:1});
  assert.deepEqual(lastJsonLine('{"a":1}\n{"a":2}\n'),{a:2});
  assert.deepEqual(lastJsonLine('{bad}\n{"a":3}\n'),{a:3});
  assert.equal(lastJsonLine('{bad}\n'),null);
  assert.equal(lastJsonLine(''),null);
});

test('verdictOf matches only a complete verdict line for its own label',()=>{
  const verdict=verdictOf('THREADED_DETERMINISM_VERDICT');
  assert.equal(verdict('{}\nTHREADED_DETERMINISM_VERDICT passed\n'),'passed');
  assert.equal(verdict('THREADED_DETERMINISM_VERDICT failed\n'),'failed');
  assert.equal(verdict('THREADED_DETERMINISM_VERDICT passed'),null);
  assert.equal(verdict('the THREADED_DETERMINISM_VERDICT passed\n'),null);
  assert.equal(verdict('OTHER_VERDICT passed\n'),null);
  assert.equal(verdictOf('a.b')('a.b passed\n'),'passed');
  assert.equal(verdictOf('a.b')('axb passed\n'),null);
});
