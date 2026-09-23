// fixtureSpec is supplied by the server in this same script, including on CSP pages.
const $ = selector => document.querySelector(selector);
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};
const details = {
  echo: ['Echo request', 'Request methods', 'Reflect the request method, headers, repeated query parameters, and body.'],
  items: ['List items', 'Items & CRUD', 'Create, read, replace, update, and delete in-memory items. Item 1 is ready to use.'],
  login: ['Create session', 'Authentication', 'Set a local HttpOnly cookie and return a test bearer token. No credentials needed.'],
  session: ['Session cookie', 'Authentication', 'Check the session created by POST /api/test/login. Returns 401 until you log in.'],
  auth: ['Bearer token', 'Authentication', 'Check the supplied dummy bearer token. Remove the Authorization header to try a 401.'],
  status: ['HTTP status', 'Errors & timing', 'Return your chosen HTTP status (200–599). Try 204, 401, 429, or 503.'],
  delay: ['Delayed response', 'Errors & timing', 'Wait for the requested delay (up to 30 seconds). Try a timeout or cancel the request.'],
  disconnect: ['Network failure', 'Errors & timing', 'Close the connection without a response. A network error here is intentional.'],
  redirect: ['Redirect', 'Errors & timing', 'Follow a 302 redirect to the echo endpoint. The response shows the final URL.'],
  text: ['Plain text', 'Response formats', 'A plain-text response with Unicode characters.'],
  xml: ['XML document', 'Response formats', 'A small XML document for response and transform experiments.'],
  'invalid-json': ['Malformed JSON', 'Response formats', 'Intentionally invalid JSON, shown as raw text without hiding the parse error.'],
  bytes: ['Binary data', 'Response formats', 'Return up to 1 MiB of binary data. The response preview shows hexadecimal bytes.'],
  'large-json': ['Large JSON', 'Response formats', 'Return a large JSON string to exercise Workbench capture and body limits.'],
  stream: ['NDJSON stream', 'Response formats', 'Send a finite stream of JSON lines, one chunk per interval. Try cancellation while it streams.'],
  'cors-denied': ['Denied CORS', 'Utilities', 'Switch the destination port to see a browser CORS error. Same-origin access works normally.'],
  stats: ['Request counters', 'Utilities', 'Inspect server hits by method and path. Reading these counters does not increment them.'],
  reset: ['Reset test data', 'Utilities', 'Restore item 1 and clear counters for the selected port. Other fixture state is unchanged.'],
};
const endpoints = [];
for (const [path, operations] of Object.entries(fixtureSpec.paths)) {
  for (const [verb, operation] of Object.entries(operations)) {
    let requestPath = path;
    const query = new URLSearchParams(), headers = {};
    for (const parameter of operation.parameters || []) {
      if (parameter.in === 'path') requestPath = requestPath.replace(`{${parameter.name}}`, encodeURIComponent(parameter.example));
      if (parameter.in === 'query') query.set(parameter.name, parameter.example);
      if (parameter.in === 'header') headers[parameter.name] = String(parameter.example);
    }
    if (query.size) requestPath += `?${query}`;
    const example = operation.requestBody?.content?.['application/json']?.example;
    if (example !== undefined) headers['Content-Type'] = 'application/json';
    const [name, group, description] = details[path.split('/')[3]] || [operation.summary, 'Other', operation.summary];
    endpoints.push({ method: verb.toUpperCase(), path: requestPath, headers,
      body: example === undefined ? '' : JSON.stringify(example, null, 2),
      name: path.includes('/items/{id}') ? ({ get: 'Read item', put: 'Replace item', patch: 'Update item', delete: 'Delete item' })[verb]
        : path.includes('/items') ? operation.summary : name, group, description });
  }
}
for (const [method, path, name] of [
  ['GET', '/api/session', 'Original session'], ['GET', '/api/mock-target', 'Mock target'],
  ['GET', '/api/slow', 'Slow response'], ['GET', '/api/error', 'Service unavailable'],
  ['GET', '/api/stats', 'Original counters'], ['POST', '/api/echo', 'Original echo'],
  ['POST', '/api/echo-headers', 'Original headers'], ['GET', '/login', 'Original login'],
  ['GET', 'http://127.0.0.1:4174/api/cors-allowed', 'Allowed CORS'],
  ['GET', 'http://127.0.0.1:4174/api/cors-denied', 'Denied CORS'],
]) endpoints.push({ method, path, name, group: 'Original fixtures', headers: {}, body: '',
  description: 'Original browser compatibility fixture. Existing session, counter, and CORS behavior is preserved.' });

let selected = endpoints[0], active = null, view = 'body', result = null, sent = 0;
const previewLimit = 64 * 1024, captureLimit = 1024 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const notice = message => { $('#request-notice').textContent = message; $('#request-notice').hidden = !message; };
$('#endpoint-count').textContent = endpoints.length;
$('#request-origin').value = location.origin;

function renderEndpoints() {
  const search = $('#endpoint-search').value.trim().toLowerCase();
  const groups = new Map();
  for (const endpoint of endpoints) {
    if (!`${endpoint.method} ${endpoint.path} ${endpoint.name} ${endpoint.group}`.toLowerCase().includes(search)) continue;
    if (!groups.has(endpoint.group)) groups.set(endpoint.group, []);
    groups.get(endpoint.group).push(endpoint);
  }
  const fragment = document.createDocumentFragment();
  for (const [name, members] of groups) {
    const section = node('div', 'endpoint-group', '');
    const heading = node('h3', 'group-heading', name);
    heading.append(node('span', '', String(members.length)));
    section.append(heading);
    for (const endpoint of members) {
      const button = node('button', 'endpoint-button', '');
      button.dataset.method = endpoint.method;
      button.setAttribute('aria-current', String(endpoint === selected));
      button.title = `${endpoint.method} ${endpoint.path}`;
      button.append(node('span', 'method', endpoint.method), node('span', 'endpoint-name', endpoint.name));
      button.onclick = () => selectEndpoint(endpoint);
      section.append(button);
    }
    fragment.append(section);
  }
  $('#endpoint-list').replaceChildren(fragment);
  $('#search-empty').hidden = groups.size > 0;
}
function updateMethod() {
  const method = $('#request-method').value;
  $('#request-method').dataset.method = method;
  $('#request-body').disabled = ['GET', 'HEAD'].includes(method);
  $('#request-body').placeholder = $('#request-body').disabled ? 'GET and HEAD requests have no body.' : 'Enter a request body…';
  $('#body-format').textContent = $('#request-body').disabled ? 'NO BODY' : 'RAW';
}
function selectEndpoint(endpoint) {
  selected = endpoint;
  $('#request-method').value = endpoint.method;
  $('#endpoint').value = endpoint.path;
  $('#request-headers').value = JSON.stringify(endpoint.headers, null, 2);
  $('#request-body').value = endpoint.body;
  $('#preset-title').textContent = `${endpoint.name} · ${endpoint.method}`;
  $('#request-description').textContent = endpoint.description;
  notice(''); updateMethod();
  for (const button of document.querySelectorAll('.endpoint-button'))
    button.setAttribute('aria-current', String(button.title === `${endpoint.method} ${endpoint.path}`));
}
function requestOptions(transport) {
  const url = new URL($('#endpoint').value, $('#request-origin').value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS request URL.');
  const method = $('#request-method').value;
  let input;
  try { input = JSON.parse($('#request-headers').value || '{}'); }
  catch { throw new Error('Request headers must be a valid JSON object.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.values(input).some(value => typeof value !== 'string'))
    throw new Error('Use a JSON object with string header values, such as {"Content-Type":"application/json"}.');
  const headers = new Headers(input);
  const timeout = Number($('#timeout').value);
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 120000) throw new Error('Timeout must be an integer from 0 to 120000 ms.');
  const credentials = $('#request-credentials').value;
  if (transport === 'XHR' && credentials === 'omit') throw new Error('XHR cannot omit same-origin cookies. Choose Fetch for credentials: omit.');
  const body = ['GET', 'HEAD'].includes(method) ? undefined : $('#request-body').value || undefined;
  return { url: url.href, method, headers, credentials, body, timeout };
}
function busy(value) {
  for (const id of ['fetch', 'xhr', 'login']) $(`#${id}`).disabled = value;
  $('#abort').disabled = !value;
}
function setStatus(text, tone) {
  $('#response-status').textContent = text;
  $('#response-status').dataset.tone = tone;
}
function showResponse() {
  if (!result) return;
  $('#response-empty').hidden = true; $('#outcome').hidden = false;
  let text = result[view] || (view === 'body' ? '(Empty response body)' : '(None)');
  const bytes = encoder.encode(text);
  if (bytes.length > previewLimit) text = decoder.decode(bytes.subarray(0, previewLimit)) + '\n\n… Preview truncated at 64 KiB.';
  const output = $('#outcome');
  output.replaceChildren();
  // Color JSON tokens with text nodes only; response data never becomes HTML.
  if (view === 'body' && result.json) {
    let end = 0;
    for (const token of text.matchAll(/"(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null|-?\d+(?:\.\d+)?)\b/g)) {
      output.append(document.createTextNode(text.slice(end, token.index)));
      output.append(node('span', token[0].endsWith(':') ? 'json-key' : token[0].startsWith('"') ? 'json-string' : 'json-literal', token[0]));
      end = token.index + token[0].length;
    }
    output.append(document.createTextNode(text.slice(end)));
  } else output.textContent = text;
}
function selectView(button) {
  view = button.dataset.view;
  for (const tab of document.querySelectorAll('[data-view]')) {
    const on = tab === button;
    tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
  }
  $('#response-content').setAttribute('aria-labelledby', button.id);
  showResponse();
}
function complete({ status, statusText, headers, bytes, url, events, started, error, limited = false }) {
  const elapsed = Math.round(performance.now() - started);
  const contentType = headers.get('content-type') || '';
  let body = decoder.decode(bytes), json = false;
  if (/json/.test(contentType) && body) {
    try { body = JSON.stringify(JSON.parse(body), null, 2); json = true; }
    catch { events.push('Body is not a complete JSON document; showing raw text.'); }
  } else if (/application\/octet-stream/.test(contentType)) {
    const lines = [];
    for (let i = 0; i < Math.min(bytes.length, 256); i += 16)
      lines.push(`${i.toString(16).padStart(4, '0')}  ${[...bytes.subarray(i, i + 16)].map(byte => byte.toString(16).padStart(2, '0')).join(' ')}`);
    body = `Binary response · ${bytes.length.toLocaleString()} bytes\nHex preview (first 256 bytes)\n\n${lines.join('\n')}`;
  }
  if (limited) events.push('Fetch capture stopped at 1 MiB; remaining stream cancelled.');
  if (error) { body = `${error}\n\nInspect the Events tab or browser console for details.`; json = false; }
  result = { body, json, headers: [...headers].map(([key, value]) => `${key}: ${value}`).join('\n'), events: events.join('\n') };
  $('#header-count').textContent = [...headers].length;
  $('#response-type').textContent = contentType.split(';')[0] || (error ? 'Request failed' : 'No content type');
  $('#response-time').textContent = `${elapsed.toLocaleString()} ms`;
  $('#response-size').textContent = `${limited ? '≥ ' : ''}${bytes.length < 1024 ? `${bytes.length} B` : `${(bytes.length / 1024).toFixed(1)} KiB`}`;
  setStatus(error ? 'Failed' : `${status} ${statusText}`.trim(), error || status >= 400 ? 'error' : 'success');
  $('#response-summary').textContent = `${sent} request${sent === 1 ? '' : 's'} sent · ${url}`;
  $('#copy-response').disabled = false;
  showResponse();
}
async function send(transport) {
  if (active) return;
  let request;
  try { request = requestOptions(transport); } catch (error) { notice(error.message); return; }
  notice(''); busy(true); sent++;
  const started = performance.now(), events = [`${transport} · ${request.method} ${request.url}`];
  const completion = { status: 0, statusText: '', headers: new Headers(), bytes: new Uint8Array(), url: request.url, events, started };
  setStatus('Sending…', 'pending');
  $('#response-summary').textContent = `${request.method} ${request.url} · In progress`;
  const pending = { cancel: () => {} };
  active = pending;
  let timer;
  try {
    if (transport === 'Fetch') {
      const controller = new AbortController();
      pending.cancel = () => controller.abort(new DOMException('Request cancelled', 'AbortError'));
      if (request.timeout) timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), request.timeout);
      const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, credentials: request.credentials, signal: controller.signal });
      Object.assign(completion, { status: response.status, statusText: response.statusText, headers: response.headers, url: response.url || request.url });
      events.push(`Headers received · ${response.status}${response.redirected ? ' · Redirect followed' : ''}`);
      const reader = response.body?.getReader(), chunks = [];
      let size = 0;
      if (reader) {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const kept = value.subarray(0, captureLimit - size);
            chunks.push(kept); size += kept.length;
            if (size === captureLimit) { completion.limited = true; await reader.cancel(); break; }
          }
        } finally { reader.releaseLock(); }
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      completion.bytes = bytes;
      events.push(`Body received · ${chunks.length} chunk(s) · ${size} bytes`);
    } else {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        pending.cancel = () => xhr.abort();
        let failure = '';
        for (const type of ['readystatechange', 'loadstart', 'progress', 'load', 'error', 'abort', 'timeout', 'loadend'])
          xhr.addEventListener(type, () => {
            if (events.length < 100) events.push(`${type}:${xhr.readyState}`);
            if (['error', 'abort', 'timeout'].includes(type)) failure = type === 'error' ? 'Network error (connection or browser policy)' : `Request ${type === 'abort' ? 'cancelled' : 'timed out'}`;
            if (type === 'loadend') {
              const headers = new Headers();
              for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
                const colon = line.indexOf(':');
                if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
              }
              Object.assign(completion, { status: xhr.status, statusText: xhr.statusText, headers,
                bytes: new Uint8Array(xhr.response || new ArrayBuffer(0)), url: xhr.responseURL || request.url });
              if (failure) reject(new Error(failure)); else resolve();
            }
          });
        xhr.open(request.method, request.url);
        xhr.responseType = 'arraybuffer'; xhr.timeout = request.timeout;
        xhr.withCredentials = request.credentials === 'include';
        for (const [name, value] of request.headers) xhr.setRequestHeader(name, value);
        xhr.send(request.body);
      });
    }
  } catch (error) { completion.error = `${error.name}: ${error.message}`; events.push(completion.error); }
  finally {
    clearTimeout(timer); active = null; busy(false);
    events.push(`Finished · ${Math.round(performance.now() - started)} ms`);
    complete(completion);
  }
}
$('#endpoint-search').oninput = renderEndpoints;
$('#request-method').onchange = updateMethod;
$('#fetch').onclick = () => send('Fetch');
$('#xhr').onclick = () => send('XHR');
$('#abort').onclick = () => active?.cancel();
$('#login').onclick = () => { selectEndpoint(endpoints.find(endpoint => endpoint.path === '/login')); send('Fetch'); };
$('#copy-response').onclick = async () => {
  try { await navigator.clipboard.writeText($('#outcome').textContent); notice('Response preview copied to clipboard.'); }
  catch { notice('Clipboard unavailable. Select the response text and copy it manually.'); }
};
const tabs = [...document.querySelectorAll('[data-view]')];
for (const [index, tab] of tabs.entries()) {
  tab.onclick = () => selectView(tab);
  tab.onkeydown = event => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); selectView(tabs[next]); tabs[next].focus(); }
  };
}
document.addEventListener('keydown', event => {
  if (event.composedPath().some(element => element.id === 'api-workbench')) return;
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); send('Fetch'); }
  if (event.key === '/' && !event.target.matches('input,textarea,select,[contenteditable]')) { event.preventDefault(); $('#endpoint-search').focus(); }
});
window.addEventListener('pagehide', () => active?.cancel());
selectEndpoint(selected);
renderEndpoints();
