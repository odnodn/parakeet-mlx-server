export async function getMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

export function createAudioContext(): AudioContext {
  return new AudioContext();
}

export function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.addEventListener('loadedmetadata', () => {
      if (audio.duration === Infinity) {
        audio.currentTime = 1e101;
        audio.addEventListener('timeupdate', function handler() {
          audio.removeEventListener('timeupdate', handler);
          resolve(audio.duration);
          audio.currentTime = 0;
        });
      } else {
        resolve(audio.duration);
      }
    });
    audio.addEventListener('error', reject);
    audio.src = URL.createObjectURL(blob);
  });
}

export function drawWaveform(
  canvas: HTMLCanvasElement,
  audioBuffer: AudioBuffer,
  options: {
    color?: string;
    backgroundColor?: string;
    trimStart?: number;
    trimEnd?: number;
    currentTime?: number;
  } = {}
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const {
    color = '#1a1a2e',
    backgroundColor = '#f8f9fa',
    trimStart = 0,
    trimEnd = audioBuffer.duration,
    currentTime,
  } = options;

  const width = canvas.width;
  const height = canvas.height;
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / width);

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const trimStartPx = (trimStart / audioBuffer.duration) * width;
  const trimEndPx = (trimEnd / audioBuffer.duration) * width;

  for (let i = 0; i < width; i++) {
    let min = 1.0;
    let max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = data[i * step + j];
      if (datum !== undefined) {
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
    }

    const isInTrim = i >= trimStartPx && i <= trimEndPx;
    ctx.fillStyle = isInTrim ? color : '#d1d5db';

    const barHeight = Math.max(1, ((max - min) / 2) * height);
    ctx.fillRect(i, (height - barHeight) / 2, 1, barHeight);
  }

  if (currentTime !== undefined) {
    const x = (currentTime / audioBuffer.duration) * width;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}
