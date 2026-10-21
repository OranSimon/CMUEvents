import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { Agent } from 'undici';

const mappings = JSON.parse(readFileSync(new URL('../../config/tls-intermediates.json', import.meta.url), 'utf8'));
const dispatchers = new Map();

/**
 * Validate a missing intermediate against existing trusted public roots.
 * @param {string} pem Public PEM-encoded intermediate certificate.
 * @param {string} expectedFingerprint SHA-256 fingerprint from source review.
 * @param {Date} now Validation time, injectable for expiry tests.
 * @return {string} Validated PEM, without introducing a new independent trust root.
 */
export function verifiedIntermediate(pem, expectedFingerprint, now = new Date()) {
  const certificate = new X509Certificate(pem);
  const fingerprint = certificate.fingerprint256.replaceAll(':', '');
  if (fingerprint !== expectedFingerprint.replaceAll(':', '').toUpperCase()) throw new Error('Configured TLS intermediate fingerprint differs from reviewed certificate.');
  if (!certificate.ca || now < new Date(certificate.validFrom) || now > new Date(certificate.validTo)) throw new Error('Configured TLS intermediate is not a currently valid CA certificate.');
  const trustedIssuer = rootCertificates.some(root => {
    const issuer = new X509Certificate(root);
    return certificate.checkIssued(issuer) && certificate.verify(issuer.publicKey);
  });
  if (!trustedIssuer) throw new Error('Configured TLS intermediate is not signed by an existing trusted root.');
  return certificate.toString();
}

/**
 * Supply a reviewed missing intermediate only for its configured public host.
 * @param {string} hostname Validated destination hostname.
 * @return {Agent|undefined} Strictly validating host-specific TLS dispatcher.
 */
export function dispatcherFor(hostname) {
  const mapping = mappings[hostname];
  if (!mapping) return undefined;
  if (!dispatchers.has(hostname)) {
    const pem = readFileSync(new URL(`../../config/${mapping.file}`, import.meta.url), 'utf8');
    const intermediate = verifiedIntermediate(pem, mapping.sha256);
    dispatchers.set(hostname, new Agent({ connect: { ca: [...rootCertificates, intermediate], rejectUnauthorized: true } }));
  }
  return dispatchers.get(hostname);
}
