// package.json carries `"overrides": { "postcss": "$postcss" }`, which is load
// bearing and deliberate. Please do not remove it as tidying.
//
// Next 15.5.29 pins its OWN postcss at exactly 8.4.31, and four advisories
// apply to that version, two of them high: arbitrary file read and path
// traversal via an attacker-controlled sourceMappingURL, an XSS in the CSS
// stringifier, and the incomplete-fix follow-up. None has a fix inside 8.4.x.
// npm reports the only fix as next@16.4.6, a further major, because its
// resolver follows Next's pin rather than looking for a patched postcss.
//
// A patched postcss does exist in the same major line, so the override points
// every copy at the one this project declares. The plain form,
// `"postcss": "8.5.32"`, is rejected with EOVERRIDE because postcss is also a
// direct dependency; `$postcss` is the form that defers to that declaration.
//
// This is a deliberate deviation from the dependency set Next ships and tests,
// so it was checked rather than assumed: the production build succeeds and the
// emitted CSS is BYTE-IDENTICAL to the stock build, same sha256 and same 40173
// bytes. If you bump the direct postcss dependency, the override follows it
// automatically; re-run the build and compare the emitted CSS again.
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
