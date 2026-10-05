# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow semantic versioning.

## [Unreleased]

## [0.7.1] - 2026-10-05

### Changed

- Download and validate the latest published pi-ai npm provider catalog at runtime; show upstream version and cache status in settings.
- Make models.dev an opt-in fallback, disabled by default, and remove LiteLLM code and settings.

## [0.7.0] - 2026-10-04

### Added

- Add manual model creation and editing with explicit protocol, endpoint, capacity, input modalities, reasoning levels, and compatibility settings.
- Preview and apply manual declarations through DSH configEditor, preserving existing models and credentials; support ownership-aware rollback and durable commit recovery.
- Add offline regressions for manual workflows, client interactions, external edits, interrupted commits, source provenance, and simultaneous stale-lease reclamation.

### Fixed

- Merge exact-ID LiteLLM metadata into missing models.dev fields while retaining source provenance.
- Accept text chat models that do not support tool calls.
- Protect migrated legacy model IDs from stale deletion; share ownership-aware leases between Host and catalog transactions and serialize stale reclamation.
- Keep live preflight output in an isolated temporary directory; derive reported plugin version from package metadata.
- Reject stale settings and provider previews rather than overwriting concurrent edits.

## [0.6.2] - 2026-10-03

### Fixed

- Remove LiteLLM fetching, configuration, and the matching test suite.
- Reclaim a stale Host state lease only when the recorded PID is provably dead; archive the old lock before taking ownership.
- Add a synchronous process-exit cleanup fallback for an owned state lease.
- Keep the state lease until queued refresh and catalog work has fully settled during normal disposal, preventing a replacement Host from overlapping late state or catalog writes.
- Register status routes before bootstrap so initialization failures remain observable.

### Tests

- Add dead-owner, live-owner, malformed-lock, reclaim opt-out, idempotent-release, and stale-bootstrap lease coverage.
- Add a cross-instance shutdown regression in which a deliberately non-cooperative fetch ignores cancellation; the replacement lease remains blocked until the old queue settles.

## [0.6.1] - 2026-10-03

### Fixed

- Preserve the status endpoint when bootstrap fails so the settings UI reports the degraded state instead of returning 404.

## [0.6.0] - 2026-10-03

### Changed

- Reworked discovery around independent evidence sources, explicit protocol/capacity requirements, transactional catalog writes, ownership-aware rollback, and conservative stale removal.

[Unreleased]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/v0.6.10...v0.7.0
[0.6.2]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/ac1ba92...v0.6.2
[0.6.1]: https://github.com/KouzakiUmi/dsh-model-refresh/commit/ac1ba92
[0.6.0]: https://github.com/KouzakiUmi/dsh-model-refresh/commit/ce77159
