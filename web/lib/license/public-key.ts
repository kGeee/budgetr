/**
 * The Ed25519 PUBLIC key used to verify license signatures. Safe to ship — only
 * the matching PRIVATE key (held by the vendor, never in this repo) can mint keys.
 *
 * Regenerate the pair with `node scripts/license/generate-keypair.mjs`, which
 * rewrites this file and saves the private key to a gitignored path. Rotating the
 * key invalidates every previously issued license, so only do it deliberately.
 */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAlkwfyxX9p/PCtRWENwzbi3TF5NqDn/2Yz7+5LguRoZs=
-----END PUBLIC KEY-----
`;
