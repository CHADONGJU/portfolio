// Keep the deadline until the entire response body has been read.
export const fetchBufferedResponse = async (url, options = {}, timeoutMs = 7000) => {
  const controller = new AbortController();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = () => {
    controller.abort();
    rejectAbort(new DOMException('요청 시간이 초과되었거나 취소되었습니다.', 'AbortError'));
  };
  const timer = setTimeout(abort, timeoutMs);
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal?.aborted) abort();
    const request = async () => {
      if (controller.signal.aborted) throw new DOMException('취소된 요청입니다.', 'AbortError');
      const response = await fetch(url, { ...options, signal: controller.signal });
      const body = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    };
    return await Promise.race([request(), aborted]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
};
