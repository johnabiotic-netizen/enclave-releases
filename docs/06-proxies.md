# Proxies

## Rules

- One proxy per profile. Never share a proxy between profiles.
- Static IPs only (static residential or ISP proxies). Rotating proxies break the "same environment" promise.
- Supported types: HTTP, HTTPS, SOCKS5 (with remote DNS). SOCKS5 preferred.
- The proxy belongs to the profile, not the device. PC and phone access both use the same proxy because the browser runs in one place.

## Proxy string formats to accept

```
socks5://user:pass@host:port
http://user:pass@host:port
host:port:user:pass        (common provider format, assume http unless told)
```
Parse all three; store normalized fields (type, host, port, username, secret reference).

## Safety check (runs at create and every start)

1. TCP connect to proxy host and port, timeout 5 s.
2. Through the proxy, fetch the exit IP from two independent IP echo services. Both must agree.
3. Look up the exit IP's country, city, timezone (use a free GeoIP database bundled in the image, such as one compatible with Camoufox's `geoip` extra, or an IP API through the proxy).
4. Compare with the profile's saved location. If different: block start and show a clear warning with options "Update location" (changes timezone and locale only, keeps all other fingerprint values) or "Cancel".
5. Confirm the real IP of the PC is not the exit IP.
6. Record result and latency in the profile's status.

## Built in test proxy

For first run demos only. In development, allow a `TEST_PROXY` value in `.env`. Clearly label profiles using it as "Test proxy, not for real accounts". Never ship real credentials in the app.

## Failure behavior

If the proxy dies while a profile runs, the egress lock means pages stop loading. The agent detects proxy failure (periodic check every 60 s) and shows "Proxy unreachable" on PC and phone. It never removes the lock.
