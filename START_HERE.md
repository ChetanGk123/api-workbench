# Start developing API Workbench

For the current local API playground, run `npm run server` and follow
[the test server guide](docs/TEST_SERVER.md). The original development handoff follows.

This is a development handoff containing the current plan, original UI references and the first implementation task. It contains no implemented bookmarklet and no completed browser tests.

## 1. Open the project

Extract the archive and open the `api-workbench` folder in your editor. If you already have a repository, merge `docs/` and `design/` into it; keep existing code and merge relevant instructions rather than overwriting an existing `AGENTS.md`.

For a new project, initialize version control:

```sh
git init
```

The coding agent will set up the development toolchain in the first task. Runtime dependencies must remain zero; development dependencies are allowed. Select and record compatible tool versions when implementing, and commit the resulting lockfile.

## 2. Give the coding agent the first task

Use this instruction in Codex or Claude with this folder open:

> Read `AGENTS.md`, `docs/API_WORKBENCH_BUILD_PLAN.md`, and `docs/FIRST_TASK_M0.md`. Inspect the existing repository, then implement the M0 feasibility task. Use `design/reference/aw-theme.css` and the HTML screens under `design/reference/screens/` as references. Complete the code and available verification, record any checks you could not run, and stop after reporting the M0 result. Do not implement later milestones in this task.

The detailed task includes expected outputs, fixture behavior and pass/fail gates. You do not need to manually create empty source files first.

## 3. Try the actual bookmark

Ask the agent for the exact local fixture startup command and generated installer path. Start that fixture, install the produced bookmark, then click it on the fixture page in Chrome and Edge.

Check that you can:

1. Open the panel and click the bookmark again without creating another panel.
2. Make a normal authenticated fixture request.
3. Enable the sample mock and see a fake response without a server request.
4. Repeat using both fetch and asynchronous XHR.
5. Cancel a delayed request and see it settle correctly.
6. Close the panel and make normal requests again.

Record browser versions and results in `docs/M0_REPORT.md`, which the implementation task creates. A test marked NOT RUN is still outstanding. Automation that injects JavaScript into a page does not prove that a saved bookmark installs and works.

## 4. Continue one milestone at a time

Once M0 passes, use:

> Read the build plan, `docs/M0_REPORT.md`, and `docs/WORK_LOG.md`. Implement M1 only. Preserve the verified M0 transport behavior, complete the panel foundation and lifecycle, run the relevant checks, then update the work log with changed files, evidence and remaining limitations.

The development sequence is:

| Milestone | Build |
|---|---|
| M0 | Prove bookmark execution, fetch/XHR mocking and cleanup. |
| M1 | Build tooling, themed panel, navigation, drag/resize/minimize. |
| M2 | Shared networking pipeline and deterministic rule matching. |
| M3 | Endpoints, profiles, storage and direct API testing. |
| M4 | Recorder and endpoint promotion. |
| M5 | Mocking, sequences, chaos and bounded replay. |
| M6 | Interception, transformations and routing. |
| M7 | Request/response breakpoints. |
| M8 | Flow/Independent execution, variables and repeated tests. |
| M9 | Every Import screen format and workflow. |
| M10 | Full integration, compatibility and release packaging. |

All designed features remain in the first public release. Internal milestone builds make implementation and review manageable.

## Reference layout

| Path | Contents |
|---|---|
| `docs/API_WORKBENCH_BUILD_PLAN.md` | Complete current specification, including all Import screen requirements. |
| `docs/FIRST_TASK_M0.md` | Detailed first coding task and acceptance gates. |
| `docs/WORK_LOG.md` | Initial status and a format for recording completed work. |
| `design/reference/screens/index.html` | Open locally to browse the 16 original HTML references. |
| `design/reference/aw-theme.css` | Original shared theme; the HTML relative stylesheet links resolve to it. |

The reference screens still contain their original Google Fonts links. Runtime implementation must bundle the CSS and use system font fallbacks without external font requests. Keep original reference files intact and build runtime components separately.
