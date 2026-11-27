// Share links: the document is deflate-compressed into the URL fragment (#z=…).
// Fragments are never sent to the server, so shared data stays between the two browsers.

export const MAX_SHARE_CHARS = 1_500_000;

function toB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeShare(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toB64url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function decodeShare(s) {
  const stream = new Blob([fromB64url(s)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
