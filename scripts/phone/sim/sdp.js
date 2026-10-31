/* global window */
(() => {
  const pc = (window.__pcs || []).at(-1);
  if (!pc) return 'none';
  const keep =
    /^(m=|a=rtcp-fb|a=extmap|a=rtpmap:(96|111)|a=mid|a=sendrecv|a=sendonly|a=recvonly|a=inactive|b=)/;
  const f = (d) =>
    d
      ? d.type +
        '\n' +
        d.sdp
          .split('\r\n')
          .filter((l) => keep.test(l))
          .join('\n')
      : '-';
  return 'LOCAL ' + f(pc.localDescription) + '\nREMOTE ' + f(pc.remoteDescription);
})();
