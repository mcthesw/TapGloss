import { afterEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ id: 'test-extension', connect: vi.fn(), lastError: undefined }));
vi.mock('wxt/browser', () => ({ browser: { runtime } }));
import { subscribeChanges } from '../src/messages';
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
