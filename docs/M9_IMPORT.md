# M9 — Import: supported formats, dialects and limits

This file states exactly what the Import screen reads, what it refuses, and what it reports
instead of translating. It is the reference for the "Supported formats" list in the panel: a format
is listed there only if an adapter in `src/import/` implements it.

## The shared pipeline

`src/import/parse.ts` is the single entry point: detect → adapter → normalize → review → commit.

1. **Detect** (`detect.ts`) reads the content, never the file extension: a `curl` command prefix, a
   `fetch(` call, the native `profile` + `endpoints` pair, `openapi: "3.x"`, `swagger: "2.0"`,
   `log.entries` (HAR), or a Postman `info.schema` / `info._postman_id` with an `item` array. A JSON
   document that merely contains a field named `request` is *not* identified; the screen says so and
   offers a manual format override.
2. **Adapters** turn their format into `SourceRequest` values. No adapter calls a browser networking
   API, and no adapter evaluates source text.
3. **Normalize** (`candidate.ts`) validates each request into an `Endpoint` candidate: method check,
   URL split, host key and base URL, alias generation with collision resolution, unresolved
   `{{name}}` collection, sensitive-field marking and forbidden-header removal.
4. **Review and commit** (`commit.ts`) resolve conflicts and compute the next configuration. The
   commit is one durable write; on failure nothing is saved and the review survives.

## What each adapter supports

| Format | Read | Reported, not translated |
|---|---|---|
| Native (schema 1) | Profile, endpoints, rules, plan, environments, global headers. Older schema migrates; a newer schema is refused without touching storage. | — |
| Swagger 2.0 (JSON) | `schemes`/`host`/`basePath`, path/query/header/body/formData parameters, examples, local `$ref`, `operationId` as alias. | Remote `$ref`, security schemes (named as configuration hints), schema-only bodies. |
| OpenAPI 3.0 (JSON) | First server URL with variable defaults, parameters, request-body examples per media type (selectable in the review), 2xx response examples, local `$ref`. | Remote `$ref`, server variables without a default (kept as `{{name}}`), schema-only bodies, security requirements. |
| HAR 1.2 | Method, URL, headers, query, `postData` text and params, response status/headers/body, base64 content, timings as metadata. | Restricted browser headers, multipart file parts, entries with no completed response, non-importable methods. |
| Postman v2.1 | Nested folders, enabled headers and query parameters, raw/urlencoded/formdata/graphql bodies, collection variables, bearer/basic/API-key-in-header auth, deterministic request → item → folder → collection auth inheritance. | Scripts (never run), other auth types, API key not in a header, file bodies, multipart files, environment files (a separate format). |
| cURL | `-X`, `-H`, `-d`/`--data*`, `-F`, `-u`, `--url`, `-I`, and the no-argument flags Chrome and Edge emit. | Unsupported flags with their character position, `@file` references, shell substitutions (kept as literal text), `-b`/`Cookie` (translated to `credentials: include`), `-A`/`-e`/`-k` (browser-controlled). |
| fetch() | Literal URL string and a literal options object: `method`, `headers`, string `body`, `credentials`. | `mode`, `referrer`, `referrerPolicy`, `cache`, `redirect`, `integrity`, `keepalive`, `signal`, `priority`; any option that depends on code is refused with its character position. |
| Recorder | This frame's fetch/XHR calls captured after recording starts, through the same review. | Whole-tab capture (that needs an extension, which this product is not). |

### cURL dialects

Accepted: the DevTools **Copy as cURL (bash)** form — single quotes with the `'\''` escape, `\`
line continuations — and **Copy as cURL (cmd)** — double quotes with `""` and `\"` escapes and `^`
line continuations. Several commands in one paste are split on a line-leading `curl`.

Never accepted: a shell is never started. `$(…)` and backticks are kept as literal text and
reported; a `@file` argument is reported and the file is not read.

### fetch() snippets

The URL literal is read with a string-literal scanner (`\n`, `\t`, `\uXXXX`, `\xXX` escapes) and the
options object is read with `JSON.parse` over the balanced `{ … }` span. A template literal with
`${…}`, a variable, or a call such as `JSON.stringify(x)` is refused with the character position.
`eval` and `new Function` are not used anywhere in the product.

## Bounds

| Limit | Value |
|---|---|
| Source size (paste or file) | 10 MiB |
| OpenAPI/Swagger operations | 500 |
| HAR entries | 1000 |
| Postman requests | 500 |
| Postman folder depth | 16 |
| `$ref` chain depth | 8 |

## Conflicts and committing

A conflict is a candidate whose method, host key and query-less path match an existing endpoint, or
whose alias matches one. A display name alone is never a match.

- **Keep both** adds the candidate with a free alias.
- **Replace existing** overwrites the endpoint's request but keeps its id and alias, so linked
  rules and plan references survive. The review names those rules before the commit.
- **Skip** leaves the existing record alone.

Native imports have their own three modes: **new stored profile** (ids remapped as one coherent
set, not activated — §8.11), **merge** into the current profile (duplicates skipped), and
**replace** the current profile (the only mode that discards existing records; the review states
what it would discard).

The commit is a single durable write. It reports saved items only after the write succeeds; a
failed write saves nothing, keeps the draft and the review, and offers Export draft.

## Unresolved values

A value the source does not supply stays visible as `{{name}}`: OpenAPI path parameters, required
query parameters with no example, unresolved Postman variables and server variables without a
default. The review lists them per candidate ("needs petId"). The tester blocks such a request with
`No value for {{petId}} yet` rather than sending an invented one.
