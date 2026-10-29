# Security Policy

## Supported version

Security fixes are maintained on the latest release only. Reproduce a report against the current `main` branch or latest tagged release when possible.

## Reporting a vulnerability

Do **not** include API keys, credential values, private model listings, local state files, or installation paths containing personal information in a public issue.

Use GitHub's private vulnerability reporting for this repository when available. If that channel is unavailable, open a minimal public issue asking for a private contact channel without disclosing exploit details.

A useful report includes:

- affected version and DSH core version;
- operating system and Node.js version;
- minimal reproduction using fake credentials and a temporary directory;
- expected and observed behavior;
- impact assessment;
- whether state, catalog, journal, lock, HTTP origin validation, credential resolution, or proxy handling is involved.

## Security boundaries

- Credential **names** may be stored in configuration; credential values must remain in environment variables or the DSH credentials service.
- Non-loopback official endpoints carrying credentials must use HTTPS. Redirects are disabled for credentialed listing requests.
- The local mutation API requires exact same-origin loopback requests and bounded JSON bodies.
- The production mirror Host never writes the installed catalog or source provider profiles. It owns only independent `refresh-*` registrations and its state/cache; old catalog ledgers and journals are preserved with a warning, not automatically restored.
- Remote npm packages are read as data, not executed. Integrity and file hashes detect mismatches; they do not authenticate a compromised publisher or prove an endpoint safe. Explicit source endpoints and installed protocol endpoints take priority over upstream data.
- Upstream arbitrary headers are excluded. Trusted source connection headers stay in memory, and API-key values are resolved only on the request path; public status and persisted model history must not contain them.
- Mirrors retain a separate registry identity but restore the installed provider's native identity at wire dispatch, preserving provider-specific request and replay behavior. OAuth grants are not copied to the mirror; mirror credential storage is read-only and rejects writes.
- State writes use atomic replacement and lifecycle leases. Retained legacy recovery tools can write catalogs only when explicitly invoked; their ownership checks and conflict handling remain required.
