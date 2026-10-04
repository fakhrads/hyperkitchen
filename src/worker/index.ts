// Entry point of the job runner utility process. All heavy work (spawning host
// binaries, hashing, copying ROM trees) happens here so the main process and
// the UI never block.
import type { MainToWorker, WorkerToMain } from '../shared/worker-protocol'
import { createHost } from './host'

const port = process.parentPort
const handle = createHost((msg: WorkerToMain) => port.postMessage(msg))
port.on('message', (e) => handle(e.data as MainToWorker))
