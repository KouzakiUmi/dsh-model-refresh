// The former network smoke wrote artifacts into the real user output directory.
// Use the isolated Host harness instead: fake catalog, temporary state, injected fetch,
// full completion/dispose checks, and no real install/profile/network mutation.
await import('./test-host.mjs');
console.log('ISOLATED SMOKE PASSED');
