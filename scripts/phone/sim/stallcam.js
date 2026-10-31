// Test-only (phone-sim STALLCAM=1): portraitcam.js, but the camera sends nothing for 3 s of every 10.
// held upright: a white circle of diameter 300 in the middle of black, so squashing shows.
(() => {
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (!c || !c.video) return gum(c);
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    const g = canvas.getContext('2d');
    const draw = () => {
      if (Date.now() % 10000 < 3000) return;
      g.fillStyle = '#000';
      g.fillRect(0, 0, 720, 1280);
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(360, 640, 150, 0, 2 * Math.PI);
      g.fill();
    };
    draw();
    setInterval(draw, 1000 / 30);
    const stream = canvas.captureStream();
    if (c.audio)
      for (const t of (await gum({ audio: c.audio })).getAudioTracks()) stream.addTrack(t);
    return stream;
  };
})();
