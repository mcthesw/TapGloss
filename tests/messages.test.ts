import { afterEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ id: 'test-extension', connect: vi.fn(), lastError: undefined }));
vi.mock('wxt/browser', () => ({ browser: { runtime } }));
import { subscribeChanges, send } from '../src/messages';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  runtime.connect.mockReset();
});
it('stops reconnecting when an extension reload invalidates the old context', () => {
  vi.useFakeTimers();
  const document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', document);
  let disconnect = () => {};
  runtime.connect.mockReturnValueOnce({
    onMessage: { addListener: vi.fn() },
    onDisconnect: {
      addListener: (fn: () => void) => {
        disconnect = fn;
      },
    },
    disconnect: vi.fn(),
  });
  const stop = subscribeChanges(vi.fn());
  runtime.connect.mockImplementation(() => {
    throw new Error('Extension context invalidated.');
  });
  disconnect();
  expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(10000);
  expect(runtime.connect).toHaveBeenCalledTimes(2);
  stop();
});

it('settles cancelled requests even when disconnect throws after a reload', async () => {
  const port = {
    onMessage: { addListener: vi.fn() },
    onDisconnect: { addListener: vi.fn() },
    postMessage: vi.fn(),
    disconnect: () => {
      throw new Error('Extension context invalidated.');
    },
  };
  runtime.connect.mockReturnValue(port);
  const controller = new AbortController();
  const request = send({ type: 'readingSettings' }, controller.signal);
  const result = expect(request).rejects.toThrow();
  controller.abort();
  await result;
});
it('invalidates the owner when runtime getters fail on disconnection', () => {
  const document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', document);
  let disconnect = () => {};
  runtime.connect.mockReturnValue({
    onMessage: { addListener: vi.fn() },
    onDisconnect: {
      addListener: (fn: () => void) => {
        disconnect = fn;
      },
    },
    disconnect: () => {
      throw new Error('invalidated');
    },
  });
  const invalidated = vi.fn();
  const stop = subscribeChanges(vi.fn(), invalidated);
  const id = Object.getOwnPropertyDescriptor(runtime, 'id')!;
  const lastError = Object.getOwnPropertyDescriptor(runtime, 'lastError')!;
  try {
    Object.defineProperty(runtime, 'id', {
      configurable: true,
      get: () => {
        throw new Error('invalidated');
      },
    });
    Object.defineProperty(runtime, 'lastError', {
      configurable: true,
      get: () => {
        throw new Error('invalidated');
      },
    });
    expect(disconnect).not.toThrow();
    expect(stop).not.toThrow();
    expect(invalidated).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(runtime, 'id', id);
    Object.defineProperty(runtime, 'lastError', lastError);
  }
});
