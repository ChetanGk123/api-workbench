import { createRequestContext, mockBody, type Pipeline } from './pipeline';

export function fetchAdapter(captured: typeof fetch, pipeline: Pipeline): typeof fetch {
  return function (input, init) {
    if (!pipeline.active) return captured.call(window, input, init);
    // Do not coerce arbitrary objects or consume bodies on the pass-through path.
    let url: string;
    try {
      if (!(typeof input === 'string' || input instanceof URL || input instanceof Request))
        return captured.call(window, input, init);
      url = new URL(input instanceof Request ? input.url : input, document.baseURI).href;
    } catch { return captured.call(window, input, init); }
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const signal = input instanceof Request ? input.signal : init?.signal ?? undefined;
    const requestContext = createRequestContext({
      kind: 'fetch',
      method,
      url,
      headers: input instanceof Request ? input.headers : new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal,
    });
    const lifecycle = pipeline.beginRequest(requestContext, 'fetch');
    const decision = lifecycle.decision;
    if (!decision) return captured.call(window, input, init);
    if (signal?.aborted) {
      lifecycle.settle('abort', String(signal.reason ?? 'cancelled'));
      return Promise.reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    }
    // Native Request validates options/precedence, only for a selected mock.
    let nativeRequest: Request;
    try { nativeRequest = new Request(input, init); } catch (error) { return Promise.reject(error); }
    return new Promise<Response>((resolve, reject) => {
      const requestSignal = nativeRequest.signal;
      let timer: ReturnType<typeof setTimeout>;
      let release = () => {};
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        release();
        requestSignal.removeEventListener('abort', finish);
        if (requestSignal.aborted) {
          lifecycle.settle('abort', String(requestSignal.reason ?? 'cancelled'));
          reject(requestSignal.reason);
        } else {
          lifecycle.settle('response', 'synthetic mock response');
          resolve(new Response(mockBody, { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
      };
      release = pipeline.own(finish);
      requestSignal.addEventListener('abort', finish, { once: true });
      if (requestSignal.aborted) finish();
      else timer = setTimeout(finish, decision.delay);
    });
  };
}
