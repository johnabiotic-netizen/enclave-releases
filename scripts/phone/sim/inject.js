/* global window */
(() => {
  const P = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = function (...a) {
    const pc = new P(...a);
    window.__pcs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = P.prototype;
  // phone-sim.mjs puts true or false in place of the flag below before this runs.
  // eslint-disable-next-line no-undef
  if (__NO_TWCC__) {
    const srd = P.prototype.setRemoteDescription;
    P.prototype.setRemoteDescription = function (d) {
      if (d && d.sdp) {
        d = {
          type: d.type,
          sdp: d.sdp
            .split('\r\n')
            .filter((l) => !/transport-cc|transport-wide-cc/.test(l))
            .join('\r\n'),
        };
      }
      return srd.call(this, d);
    };
  }
})();
