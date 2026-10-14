# Forensic sync and YouTube tests

These scripts execute the cases from `lab/YOUTUBE-CW-RESEARCH.md` against
the current application modules. They do not call a live account, clear
storage, or change production sync or trailer code.

```bash
node lab/forensic/run-all.mjs
```

That runs the sync suite and the YouTube suite twice and writes
`RESULTS.md`. A second run whose verdicts differ exits non-zero.

- `run-sync-forensics.mjs` puts each install in a worker with its own
  `localStorage` and module state. The parent is a mock Supabase.
- `run-youtube-forensics.mjs` evaluates `docs/youtube-proxy.html` and the
  Home/Details trailer methods with a fake `YT.Player`. It does not prove a
  composited TV frame.

`tests/` is gitignored and is not in this checkout, so `npm test` is not
the runner for this work.
