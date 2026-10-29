// sim.mjs の --jobs で使うワーカー。受け取った条件で simulateRuns を回して結果を返す
import { parentPort } from 'node:worker_threads';
import { simulateRuns } from '../dist/sim.js';

parentPort.on('message', ({ id, opts }) => parentPort.postMessage({ id, result: simulateRuns(opts) }));
