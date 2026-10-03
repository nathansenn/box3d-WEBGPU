// Runs a child process to its end and reports how it ended. The child is judged by the result it printed, not by
// how it exited, because Node 26.0.0 was seen stalling in its own platform shutdown after a child had finished
// and printed everything (docs/THREADED_ENGINE.md, hazard B). Four ends are told apart:
//   - a result and a clean exit:              result set, status 0
//   - a result and then no exit in graceMs:   result set, exitHang true, killed (the measurement or verdict stands)
//   - no result within timeoutMs:             result null, timedOut true, killed (a real hang, e.g. a worker barrier)
//   - death or a failing exit:                status or signal set, result null or present as printed
// resultOf(stdout) receives everything the child has written so far and returns the parsed result, or null while
// there is none yet. It is called again after every chunk until it returns something.
import { spawn } from 'node:child_process';

export function superviseChild(command, args, {
  timeoutMs, graceMs, resultOf, forward = null, stdin = 'ignore', stderr = 'pipe',
}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: [stdin, 'pipe', stderr] });
    let out = '';
    let err = '';
    let result = null;
    let exitHang = false;
    let timedOut = false;
    let grace = null;
    let ended = false;
    const deadline = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (forward) forward(chunk);
      if (result !== null) return;
      out += chunk;
      result = resultOf(out);
      if (result === null) return;
      clearTimeout(deadline);
      grace = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) return; // it ended just as the grace ran out
        exitHang = true;
        child.kill('SIGKILL');
      }, graceMs);
    });
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-2000); });
    }
    const finish = (status, signal) => {
      if (ended) return;
      ended = true;
      clearTimeout(deadline);
      clearTimeout(grace);
      resolve({ result, status, signal, exitHang, timedOut, stderr: err.trim().slice(-300) });
    };
    child.on('error', (error) => finish(null, `spawn failed: ${error.message}`));
    child.on('close', finish);
  });
}

// The last complete line of stdout that parses as a JSON object, or null. A partial last line is never used.
export function lastJsonLine(out) {
  const complete = out.split('\n').slice(0, -1);
  for (let i = complete.length - 1; i >= 0; i--) {
    if (!complete[i].startsWith('{')) continue;
    try { return JSON.parse(complete[i]); } catch { /* an object-shaped log line, not the result */ }
  }
  return null;
}

// A result predicate for a child that ends with a line "<label> passed" or "<label> failed": the word, or null.
export const verdictOf = (label) => {
  const line = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (passed|failed)\n`, 'm');
  return (out) => out.match(line)?.[1] ?? null;
};
