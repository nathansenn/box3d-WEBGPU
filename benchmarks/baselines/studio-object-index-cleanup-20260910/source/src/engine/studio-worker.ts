import { createStudioWorkerDispatcher } from './studio-dispatcher.ts';

const scope = globalThis as unknown as {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
};
const dispatcher = createStudioWorkerDispatcher((message, transfer) => scope.postMessage(message, transfer));
scope.addEventListener('message', event => dispatcher.handle(event.data));
