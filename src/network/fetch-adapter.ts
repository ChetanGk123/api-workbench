import { mockBody, type Pipeline } from './pipeline';

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
    const decision = pipeline.decide(method, url, 'fetch');
    if (!decision) return captured.call(window, input, init);
    // Native Request validates options/precedence, only for a selected mock.
    let request: Request;
    try { request = new Request(input, init); } catch (error) { return Promise.reject(error); }
    return new Promise<Response>((resolve, reject) => {
      const signal = request.signal;
      let timer: ReturnType<typeof setTimeout>;
      let release = () => {};
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        release();
        signal.removeEventListener('abort', finish);
        if (signal.aborted) reject(signal.reason);
        else resolve(new Response(mockBody, { status: 200, headers: { 'Content-Type': 'application/json' } }));
      };
      release = pipeline.own(finish);
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
      else timer = setTimeout(finish, decision.delay);
    });
  };
}
