# Contributing

## Development setup

Requirements:

- Node.js 20 or newer;
- pnpm compatible with the checked-in lockfile;
- a Windows x64 environment for the pinned `@esbuild/win32-x64` package, or an intentional dependency adjustment for another platform.

```powershell
pnpm install --frozen-lockfile
pnpm run build:client
pnpm test
```

The default test suite is offline. It uses fixtures, fake credentials, and temporary directories; it must not read real credentials or modify the installed pi-ai catalog.

## Change checklist

1. Keep discovery sources independent: one source failing must not erase another source's evidence.
2. Do not infer protocol, context capacity, output capacity, chat capability, or authoritative absence from a model ID alone.
3. Preserve existing native catalog metadata unless an explicit authoritative field is available.
4. Keep catalog changes journaled and ownership-aware; never delete by ID-only historical ownership.
5. Hold the Host state lease until queued writes settle. Stale lock recovery must remain fail-closed unless the recorded PID is provably dead.
6. Add a regression test for every lifecycle, recovery, parser, or planner fix.
7. Run `pnpm run build:client` and `pnpm test` before submitting.
8. Update `CHANGELOG.md` and user-facing documentation when behavior changes.

## Pull requests

Keep each pull request focused. Include:

- problem statement and risk;
- changed files and compatibility impact;
- exact verification commands and results;
- migration or rollback notes;
- any behavior not verified against a real Cordis Loader composition.

Never commit real state files, credentials, private provider responses, installation packages, or generated archives.
