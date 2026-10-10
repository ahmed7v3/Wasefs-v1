// pnpm install hooks. See https://pnpm.io/pnpmfile

// (Baileys, for the WhatsApp bridge, declares sharp/jimp/audio-decode/link-preview-js as optional
// peers for media handling, which the bridge never touches; they are dropped the same way.)
// Better Auth declares ~18 framework/database adapters as *optional* peer dependencies (next, react,
// vitest, prisma, mongodb, drizzle-kit, ...). With `auto-install-peers=true` pnpm resolves those from
// whatever else exists in the workspace, which pulled Next.js, React, Vite and TypeScript into the
// API's production dependencies (the image grew from 214 MB to 678 MB). The API uses only the
// Drizzle adapter, so every peer except `drizzle-orm` (which the adapter imports at runtime and must
// be the same copy we use) is dropped. Re-check this list when upgrading better-auth.
const KEPT_BETTER_AUTH_PEERS = new Set(["drizzle-orm"]);
const DROP_ALL_PEERS = new Set(["@whiskeysockets/baileys"]);

function readPackage(pkg) {
  if (DROP_ALL_PEERS.has(pkg.name)) {
    delete pkg.peerDependencies;
    delete pkg.peerDependenciesMeta;
  }
  if (pkg.name === "better-auth" || pkg.name.startsWith("@better-auth/")) {
    for (const peer of Object.keys(pkg.peerDependencies ?? {})) {
      if (KEPT_BETTER_AUTH_PEERS.has(peer)) continue;
      delete pkg.peerDependencies[peer];
      if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[peer];
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
