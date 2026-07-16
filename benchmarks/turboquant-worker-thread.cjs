'use strict';
const { parentPort, workerData } = require('worker_threads');
const { TurboQuantDeltaStream } = require(workerData.modulePath);
let decoder = null;
let options = null;
let length = 0;

function sparseChecksum(values) {
  let hash = 2166136261 >>> 0;
  const stride = Math.max(1, Math.floor(values.length / 256));
  for (let i = 0; i < values.length; i += stride) {
    const q = Math.trunc(values[i] * 1000) | 0;
    hash ^= q & 255;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

parentPort.on('message', message => {
  if (message.kind === 'reset') {
    options = message.options;
    length = message.length;
    decoder = new TurboQuantDeltaStream(length, options);
    parentPort.postMessage({ ok: true });
    return;
  }
  if (message.kind === 'raw') {
    const values = new Float32Array(message.buffer);
    parentPort.postMessage({ hash: sparseChecksum(values) });
    return;
  }
  if (message.kind === 'compressed') {
    if (!decoder) throw new Error('decoder not initialized');
    const packet = {
      length,
      blockSize: options.blockSize,
      bits: options.bits,
      rotation: options.rotation,
      seed: options.seed >>> 0,
      centered: !!options.centered,
      codes: new Uint8Array(message.codes),
      norms: new Float32Array(message.norms),
      means: new Float32Array(message.means),
    };
    const output = decoder.decodeFrame(packet);
    parentPort.postMessage({ hash: sparseChecksum(output) });
  }
});
