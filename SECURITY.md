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
- Catalog mutation is opt-in and may require filesystem privileges. The plugin does not elevate privileges or execute the displayed permission command.
- State and catalog transactions are crash-recoverable, but non-cooperating external writers must still be stopped during upgrades.
