# API Workbench implementation instructions

Read `docs/API_WORKBENCH_BUILD_PLAN.md` and the current assigned task before editing. The user's latest instruction takes precedence. Inspect existing code and preserve unrelated work.

## Product decisions

- Fully self-contained bookmarklet for desktop Chrome and Edge.
- No runtime packages, external assets, hosted loader, backend or extension requirement.
- Development tools and browser-test dependencies are allowed.
- Reuse the supplied zinc theme. Build runtime UI with native DOM and a shadow root.
- Use a single shared interception layer with separate fetch and XHR adapters.
- Keep browser-owned request behavior intact unless an explicit active rule changes it.
- Keep capture/body storage bounded and honor cancellation and cleanup.
- Every format and control specified in `Import.html` belongs in v1.
- All planned features remain in v1; the current task's milestone limits the work in that task.

## Working approach

1. Inspect the repository and summarize relevant existing constraints.
2. Implement the assigned milestone in small coherent changes.
3. Verify behavior using controlled local fixtures and meaningful assertions.
4. Record actual results, browser/tool versions and unresolved limitations.
5. Update `docs/WORK_LOG.md`; do not mark a milestone complete while a required gate is untested or failing.

For this packet, the first assigned task is `docs/FIRST_TASK_M0.md`. Complete M0 only; later milestones are separate tasks.

Do not change the distribution model to make a test pass. Do not treat console injection as proof of saved-bookmark behavior. Do not create placeholder success handlers or claim an import adapter works merely because it detects a format. Do not execute imported snippets or use `eval`/`new Function` for variables.

Create useful documentation when a decision is made. Do not prefill the repository with empty documentation or pretend generated scaffolding implements the product.

At the end of a task, report changed files, exact commands run, outcomes, checks not run, material limitations and the next milestone. Distinguish measured evidence from proposed behavior.
