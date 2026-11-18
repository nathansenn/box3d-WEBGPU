import {parentPort} from 'node:worker_threads';
import {serveWorld} from 'box3d-webgpu-kit/worker';
serveWorld(parentPort);
