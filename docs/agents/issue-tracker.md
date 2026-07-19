# Issue tracker: Local Markdown

Issues and PRDs live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- PRD: `.scratch/<feature-slug>/PRD.md`
- Issues: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- Record triage state using a `Status:` line near the top
- Append discussion under a `## Comments` heading

## Publishing and fetching

When a skill publishes to the issue tracker, create a file under
`.scratch/<feature-slug>/`, creating the directory when needed.

When a skill fetches a ticket, read the referenced Markdown file. The user will
normally provide its path or issue number.
