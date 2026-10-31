// Test-only (phone-sim PORTRAITCAM=1): the phone camera films portrait, 720 x 1280, like a phone
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
      g.fillStyle = '#000';
      g.fillRect(0, 0, 720, 1280);
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(360, 640, 150, 0, 2 * Math.PI);
      g.fill();
    };
    draw();
    setInterval(draw, 1000 / 30);
    const stream = canvas.captureStream(30);
    if (c.audio)
      for (const t of (await gum({ audio: c.audio })).getAudioTracks()) stream.addTrack(t);
    return stream;
  };
})();
