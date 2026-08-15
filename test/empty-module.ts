// Stub for the "server-only" package during tests. Vitest runs in plain
// Node, not Next.js's "react-server" bundling condition, so the real
// "server-only" package would throw on import — see vitest.config.ts.
export {};
