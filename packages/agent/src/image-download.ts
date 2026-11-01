// The browser image's one-time download (Stage 7), for PCs that can't build it: the app's
// setup screen starts it and shows its progress.

import type { ImageDownload } from '@enclave/shared';
import type { DockerRuntime, PullEvent } from './docker/runtime.js';

export class ImageDownloader {
  private status: ImageDownload = idle();
  private running: Promise<void> | null = null;

  constructor(private readonly runtime: DockerRuntime) {}

  get(): ImageDownload {
    return this.status;
  }

  /** Starts the download unless it is running or the image is there already. */
  async start(): Promise<ImageDownload> {
    if (this.running) return this.status;
    if (await this.runtime.imageExists()) {
      this.status = { ...idle(), state: 'done' };
      return this.status;
    }
    const layers = new Map<string, { current: number; total: number; done: boolean }>();
    this.status = { ...idle(), state: 'downloading' };
    const update = (e: PullEvent) => {
      if (!e.id || e.id.includes(':')) return; // the reference itself, not a layer
      const layer = layers.get(e.id) ?? { current: 0, total: 0, done: false };
      if (e.status === 'Downloading' && e.progressDetail?.total) {
        layer.current = e.progressDetail.current ?? 0;
        layer.total = e.progressDetail.total;
      } else if (e.status === 'Download complete' || e.status === 'Verifying Checksum') {
        layer.current = layer.total;
      } else if (e.status === 'Pull complete' || e.status === 'Already exists') {
        layer.current = layer.total;
        layer.done = true;
      }
      layers.set(e.id, layer);
      let downloaded = 0;
      let total = 0;
      let done = 0;
      for (const l of layers.values()) {
        downloaded += l.current;
        total += l.total;
        if (l.done) done++;
      }
      this.status = {
        state: 'downloading',
        downloadedBytes: downloaded,
        totalBytes: total,
        layersDone: done,
        layers: layers.size,
      };
    };
    this.running = this.runtime
      .pullImage(update)
      .then(() => {
        this.status = { ...this.status, state: 'done', layersDone: this.status.layers };
      })
      .catch((e: unknown) => {
        this.status = {
          ...this.status,
          state: 'failed',
          error:
            'The download stopped: ' +
            (e instanceof Error ? e.message : String(e)) +
            ' Check the internet connection and try again; it continues where it stopped.',
        };
      })
      .finally(() => {
        this.running = null;
      });
    return this.status;
  }
}

function idle(): ImageDownload {
  return { state: 'idle', downloadedBytes: 0, totalBytes: 0, layersDone: 0, layers: 0 };
}
