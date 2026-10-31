/* global document */
// Test-only (phone-sim CLOCKCAM=1): the phone camera shows the phone's clock as 24 full-height
// black/white columns (Date.now() mod 2^24, most significant bit first), so the delay through the
// profile can be measured on the phone's clock alone. Audio stays Chromium's fake device.
(() => {
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (!c || !c.video) return gum(c);
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const g = canvas.getContext('2d');
    const draw = () => {
      const t = Date.now() % 16777216;
      for (let i = 0; i < 24; i++) {
        g.fillStyle = (t >> (23 - i)) & 1 ? '#fff' : '#000';
        g.fillRect(Math.round((i * 1280) / 24), 0, Math.ceil(1280 / 24), 720);
      }
    };
    draw();
    setInterval(draw, 1000 / 60);
    const stream = canvas.captureStream(30);
    if (c.audio)
      for (const t of (await gum({ audio: c.audio })).getAudioTracks()) stream.addTrack(t);
    return stream;
  };
})();
