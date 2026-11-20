<script>
  import { onMount, onDestroy } from "svelte";

  let videoElement;
  let canvasElement;
  let context;
  let stream;
  let scanning = false;
  let onResult = null;

  export let facingMode = "environment"; // or "user"

  export function start(callback) {
    onResult = callback;
    startCamera();
  }

  export async function stop() {
    scanning = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode }
      });
      videoElement.srcObject = stream;
      videoElement.setAttribute("playsinline", true);
      await videoElement.play();

      scanning = true;
      scanFrame();
    } catch (err) {
      console.error("Camera error:", err);
    }
  }

  function scanFrame() {
    if (!scanning) return;

    requestAnimationFrame(scanFrame);

    if (videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA) return;

    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;

    context.drawImage(videoElement, 0, 0);

    const imageData = context.getImageData(
      0,
      0,
      canvasElement.width,
      canvasElement.height
    );

    const qr = jsQR(imageData.data, imageData.width, imageData.height);

    if (qr) {
      scanning = false;
      if (onResult) onResult(qr.data);
    }
  }

  onMount(() => {
    context = canvasElement.getContext("2d");
  });

  onDestroy(stop);
</script>

<style>
  video {
    width: 100%;
    border-radius: 12px;
  }
  canvas {
    display: none;
  }
</style>

<video bind:this={videoElement}></video>
<canvas bind:this={canvasElement}></canvas>
