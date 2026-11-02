// Reading a proxy string (docs/06-proxies.md). Shared so the Windows app can say which line
// of the proxy tester's input isn't a proxy before it sends anything.

import { PROXY_TYPES, type ProxyInput, type ProxySpec, type ProxyType } from './proxy.js';

/** A proxy that isn't in a form Enclave reads. The message is for the person. */
export class ProxyFormatError extends Error {}

const SCHEME_TYPES: Record<string, ProxyType> = {
  socks5: 'socks5',
  socks5h: 'socks5',
  http: 'http',
  https: 'https',
};

/**
 * Accepts `socks5://user:pass@host:port`, `http://user:pass@host:port` (also https://),
 * `host:port:user:pass` (assumed http, the common provider format) and `host:port`, or a
 * structured object.
 */
export function parseProxySpec(spec: ProxySpec): ProxyInput {
  if (typeof spec !== 'string') return validate({ ...spec });
  const text = spec.trim();
  if (!text) throw new ProxyFormatError('The proxy is empty.');

  const scheme = /^([a-z0-9]+):\/\//i.exec(text);
  if (scheme) {
    const type = SCHEME_TYPES[scheme[1]!.toLowerCase()];
    if (!type)
      throw new ProxyFormatError(
        `Proxy type "${scheme[1]}" is not supported. Use socks5, http or https.`,
      );
    let url: URL;
    try {
      url = new URL(`http://${text.slice(scheme[0].length)}`);
    } catch {
      throw new ProxyFormatError('The proxy address is not valid.');
    }
    return validate({
      type,
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: Number(url.port),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    });
  }

  const parts = text.split(':');
  if (parts.length !== 2 && parts.length !== 4) {
    throw new ProxyFormatError(
      'Use socks5://user:pass@host:port, http://user:pass@host:port or host:port:user:pass.',
    );
  }
  const [host, port, username, password] = parts;
  return validate({
    type: 'http',
    host: host!,
    port: Number(port),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  });
}

function validate(p: ProxyInput): ProxyInput {
  if (!(PROXY_TYPES as readonly string[]).includes(p.type)) {
    throw new ProxyFormatError(
      `Proxy type "${p.type}" is not supported. Use socks5, http or https.`,
    );
  }
  if (!p.host || /[\s/@]/.test(p.host))
    throw new ProxyFormatError('The proxy host is missing or not valid.');
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) {
    throw new ProxyFormatError('The proxy port must be a number from 1 to 65535.');
  }
  return p;
}
