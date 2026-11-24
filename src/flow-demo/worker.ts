/** Runs one demo study (studies.ts) off the main thread and posts its progress and its result document. */
import {createFlowStudy} from '../engine/flow-study.ts';
import {DEMO_STUDIES} from './studies.ts';

self.onmessage = (event: MessageEvent<{id: string}>) => {
  const demo = DEMO_STUDIES.find(s => s.id === event.data.id);
  if (!demo) { self.postMessage({type: 'error', message: `no study "${event.data.id}"`}); return; }
  try {
    const started = performance.now(), run = createFlowStudy(demo.study, {now: () => performance.now()});
    const g = run.setup.grid;
    self.postMessage({type: 'setup', cells: (g.nx + 2) * (g.ny + 2) * (g.nz + 2), fluidCells: run.flow.fluidCells, cell: g.cell, reynolds: run.setup.reynolds, maxSteps: run.setup.run.maxSteps});
    let last = 0;
    while (!run.done) {
      const p = run.advance();
      if (p && performance.now() - last > 250) { last = performance.now(); self.postMessage({type: 'progress', step: p.step, maxSteps: p.maxSteps, fraction: p.fraction, phase: p.phase, coefficients: p.coefficients, massBalance: p.massBalance, seconds: (performance.now() - started) / 1000}); }
    }
    self.postMessage({type: 'result', result: run.result()});
  } catch (error) {
    self.postMessage({type: 'error', message: error instanceof Error ? error.message : String(error)});
  }
};
