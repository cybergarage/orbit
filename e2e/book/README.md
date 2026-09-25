# English book workflow evaluation

The vendored MIT-licensed starter and templates come from
[ai-coding-book-starter at 4e9af157884ec4cfb64e464987dc8fd8e4d1007f](https://github.com/cybergarage/ai-coding-book-starter/tree/4e9af157884ec4cfb64e464987dc8fd8e4d1007f/en).
`fixture/` contains the application starting point. `templates/` contains the
English common documents and Codex prompts/instructions. `LICENSE` preserves
the upstream license. `source.json` records the exact paths and SHA-256 hashes.
No completed solutions or book manuscript text are included.

The workflow follows the English book's shared Vibe, specification-driven, and
autonomous practice chapters and the Codex specification-review adoption example.
These are Orbit adaptations, not reproductions of the books' measured Codex runs.
See [the operating guide](../../docs/e2e-evaluation.md#english-book-workflows).

The grader uses a separately locked Playwright installation. Only the `grader`
Docker target contains the browser checks. The `agent` target contains the
starter dependencies and Orbit. Do not select the grader image as the solver.
