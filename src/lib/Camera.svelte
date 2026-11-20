<script>
  import { onMount, onDestroy } from "svelte";

  export let options = { video: true, audio: false };

  let video;
  let stream = null;
  let error = null;
  let isReady = false;

  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia(options);
      
      if (video) {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          isReady = true;
        };
      }
    } catch (err) {
      console.error("Camera error:", err);
      error = err.message || "Failed to access camera";
    }
  });

  onDestroy(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  });

  // This is the snap() method your parent component is calling
  export function snap() {
    if (!video || !isReady) {
      console.error("Video not ready");
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    // Return base64 data URL
    return canvas.toDataURL("image/png");
  }
</script>

{#if error}
  <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded text-center">
    <strong>Camera Error:</strong> {error}
  </div>
{:else}
  <video 
    bind:this={video} 
    autoplay 
    playsinline
    muted
    class="w-full h-auto"
  ></video>
{/if}