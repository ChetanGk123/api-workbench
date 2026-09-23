# Local API test server

Run from the repository root:

```sh
npm run server
```

Uses Node's HTTP server with no extra dependencies or build step. Both
`http://127.0.0.1:4173` and `http://127.0.0.1:4174` serve the API, with independent
in-memory items and counters. Stop with Ctrl+C. Restarting resets the data.
`npm run fixture` starts the same server; run only one copy at a time.

Open <http://127.0.0.1:4173/fixture> and launch your Workbench bookmark there.
The playground includes a searchable sidebar with all 29 OpenAPI operations plus
10 original compatibility fixtures. Selecting a request fills its method, URL,
headers and example body. Edit any field, choose the destination port, and send
with Fetch or native XHR. Body, Headers and Events tabs show the result, with status,
duration and received byte count. Use Cancel or set a timeout for slow requests.
`Cmd/Ctrl+Enter` sends with Fetch; `/` focuses endpoint search. The OpenAPI JSON
link downloads the current server definition directly.

Response previews are capped at 64 KiB. Fetch captures up to 1 MiB and then cancels
the remaining stream; XHR uses its native arraybuffer response and only bounds the
displayed preview. Browser policy pages deliberately continue to block styles
under `style-src 'none'`; the collection is embedded in the same-origin script so
it does not need a separate fetch that would fail under `connect-src 'none'`.

If you need to generate the installer first, run `npm run build`, then open
<http://127.0.0.1:4173/install.html>.

Save <http://127.0.0.1:4173/openapi.json> and import the saved file through
Workbench's Import screen (or paste its JSON). It includes methods, request
body examples, a test bearer token and concrete parameter examples. To save it
from a terminal:

```sh
curl http://127.0.0.1:4173/openapi.json -o /tmp/workbench-test-openapi.json
```

All paths below start with `/api/test`. Original fixture endpoints, CORS
behavior and CSP pages remain available unchanged.

| Method | Path | Behavior |
| --- | --- | --- |
| GET, HEAD, POST, PUT, PATCH, DELETE | `/echo?tag=a&tag=b` | Echo method, URL, headers, repeated query values, raw body, parsed JSON, byte count and base64. |
| OPTIONS | Any test path | 204, `Allow` and eligible CORS preflight headers. |
| GET, HEAD | `/items` | List items; initially contains item 1. |
| POST | `/items` | Create a JSON object with a nonempty `name`; returns 201 and `Location`. |
| GET, HEAD | `/items/1` | Read one item. |
| PUT | `/items/1` | Replace the object; `name` required; server preserves its ID. |
| PATCH | `/items/1` | Merge a JSON object into the item; server preserves its ID. |
| DELETE | `/items/1` | Delete it; returns empty 204. Missing items return 404. |
| POST | `/login` | Set a local HttpOnly session cookie; return `token` and `user`. No credentials required. |
| GET, HEAD | `/session` | 200 with eligible session cookie, otherwise 401. |
| GET, HEAD | `/auth` | Requires `Authorization: Bearer workbench-test-token`; otherwise 401. |
| GET | `/status?code=503` | Chosen status, 200–599. 204/205/304 have no body; 429/503 include `Retry-After`. |
| GET | `/delay?ms=1500` | Delay 0–30,000 ms for latency, timeout, cancel and breakpoint exercises. |
| GET | `/redirect` | 302 to the echo endpoint. |
| GET | `/text`, `/xml`, `/invalid-json` | Text with Unicode, XML, or intentionally malformed JSON. |
| GET | `/bytes?size=65536` | Binary response, 0–1 MiB. |
| GET | `/large-json?size=262144` | JSON with a string of the requested length, up to 1 MiB plus JSON framing. |
| GET | `/stream?chunks=5&ms=100` | Finite NDJSON stream; 1–100 chunks, 10–1000 ms apart. |
| GET | `/disconnect` | Close the socket without an HTTP response to exercise network errors. |
| GET | `/cors-denied` | Echo with no CORS permission; readable same-origin, blocked cross-origin. |
| GET, HEAD | `/stats` | Hit counts by method/path and current item count; excludes stats reads and OPTIONS. |
| POST | `/reset` | Reset test items and counters for this port. |

HEAD responses have no body. Echo accepts URL-encoded, multipart and binary
bodies as raw bytes; only JSON is parsed. Browser fetch/XHR do not allow TRACE
or CONNECT; this server is not a CONNECT proxy.

Example requests:

```sh
curl -X POST http://127.0.0.1:4173/api/test/items \
  -H 'Content-Type: application/json' -d '{"name":"Test item","done":false}'
curl -X PUT http://127.0.0.1:4173/api/test/items/1 \
  -H 'Content-Type: application/json' -d '{"name":"Replaced item"}'
curl -X PATCH http://127.0.0.1:4173/api/test/items/1 \
  -H 'Content-Type: application/json' -d '{"done":true}'
curl -i -X DELETE http://127.0.0.1:4173/api/test/items/1
curl -i -X OPTIONS http://127.0.0.1:4173/api/test/echo
```

Use the API across Workbench features:

- **Endpoints and checks:** import the spec, send each method, assert JSON values,
  status, headers and duration. Configure expected error statuses explicitly;
  the imported failure examples should not all pass default 2xx checks.
- **Flow and variables:** create an item, then use its returned `id` in a later
  read/update/delete URL. Login returns a token suitable for a later auth header.
  The spec's item ID 1 is a concrete starting example, not an automatic dependency.
- **Load and Independent runs:** use echo or list; reset restores mutable data.
- **Mock and sequences:** mock echo and compare `/stats` before/after; a synthetic
  response should add no server hit. Inspect stats with Direct mode.
- **Intercept and breakpoints:** edit headers or JSON on echo to inspect the
  received values; pause before dispatch or before response delivery.
- **Route and environments:** change the destination from port 4173 to 4174.
  `X-Test-Origin` identifies the responding origin. Both origins permit each
  other's test API requests, including preflight and credentials, except
  `/cors-denied`. Other page origins are intentionally not allowed.
- **Chaos and replay:** use echo and counters to see duplicate dispatches;
  use delay, status and disconnect for real server failures.
- **Recorder and fetch/XHR:** the existing fixture buttons exercise page traffic.
  To record a new endpoint, issue a fetch/XHR from the fixture page after starting
  recording, or use a tester request with the appropriate recording settings.
- **Body handling:** text, XML, malformed JSON, binary, large JSON and streaming
  responses exercise different formats and body limits.
- **Profiles and imports:** save/export/reimport a configured profile; the server
  supplies OpenAPI input. Other import formats and persistence are Workbench
  behavior, not implemented by this server.

This is loopback-only development infrastructure, not a product runtime dependency.
Authentication is deliberately fake and echo exposes the headers you send it;
use only dummy credentials. Requests are limited to 1 MiB and stored items to
1000 per origin. Delayed/streaming response timers stop when their connections
close. Cookies are host-scoped, so the two ports share eligible cookies even
though their item data is separate. No HTTPS or arbitrary external-origin CORS
support is configured. Server startup is checked; endpoint and browser tests
were skipped at the user's request. The later fixture-page redesign was visually
reviewed in Chrome with a manual GET Fetch and POST XHR interaction; this is not
full endpoint or Workbench verification.
