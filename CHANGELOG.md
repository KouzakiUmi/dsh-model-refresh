# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow semantic versioning.

## [Unreleased]

## [0.6.2] - 2026-10-03

### Fixed

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

[Unreleased]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/v0.6.2...HEAD
[0.6.2]: https://github.com/KouzakiUmi/dsh-model-refresh/compare/ac1ba92...v0.6.2
[0.6.1]: https://github.com/KouzakiUmi/dsh-model-refresh/commit/ac1ba92
[0.6.0]: https://github.com/KouzakiUmi/dsh-model-refresh/commit/ce77159
