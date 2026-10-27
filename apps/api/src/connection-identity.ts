import { createECDH, createHash, createPrivateKey, createPublicKey, hkdfSync, sign } from 'node:crypto';

/** A domain-separated key pins this installation across address changes; no patient data is advertised. */
export function connectionIdentity(secret: string) {
  if (secret.length < 48) throw Error('A configured signing secret is required.');
  const ec = createECDH('prime256v1');
  ec.setPrivateKey(Buffer.from(hkdfSync('sha256', secret, 'CareSlot', 'local-discovery-signing-v1', 32)));
  const point = ec.getPublicKey();
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url'), d: ec.getPrivateKey().toString('base64url') } });
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
  const serverId = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex');
  return { serverId, proof(nonce: string, name: string) {
    if (!/^[a-f0-9]{32}$/.test(nonce)) throw Error('Invalid discovery challenge.');
    const label = name.trim().slice(0, 80) || 'CareSlot Clinic';
    const message = `CareSlot/1\n${nonce}\n${serverId}\n${label}`;
    return { service: 'CareSlot API', protocol: 1, serverId, name: label, publicKey, nonce, signature: sign('sha256', Buffer.from(message), key).toString('base64') };
  } };
}
