export class ServiceFailure extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export function httpFailure(service: string, status: number) {
  return new ServiceFailure(
    `${service}请求失败（${status}）`,
    status === 408 || status === 429 || status >= 500,
  );
}
export async function fetchService(url: string, init: RequestInit, offline: string) {
  try {
    return await fetch(url, init);
  } catch {
    if (init.signal?.aborted && init.signal.reason?.name === 'AbortError') throw init.signal.reason;
    throw new ServiceFailure(offline, true);
  }
}
