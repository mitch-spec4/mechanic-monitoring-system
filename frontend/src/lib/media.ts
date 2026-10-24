import { confirmUpload, requestUpload, sendUpload } from "../services/api";
import type { Job } from "../services/types";
import { offlineState } from "../offline";
import { queueMedia } from "../offline/changes";
import { t } from "../i18n";

export type Limits = { photo_mb: number; video_mb: number; video_seconds: number };

/** Shrink a photo on the phone before upload: at most 1600 px on the long side, as JPEG. */
export async function compressImage(file: File, maxPx = 1600, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(t("This photo format can't be read here. Take a new photo or choose a JPEG."));
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error(t("Couldn't prepare the photo. Please try again."));
  return blob;
}

/** A video's length in seconds, read from the file on the phone. */
export function videoSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("This video can't be read here. Record it again or choose an MP4.")));
    };
    video.src = url;
  });
}

// Room kept free on the phone besides a photo or video waiting to upload.
const SPARE_BYTES = 20 * 1024 * 1024;

/** Before keeping a file on the phone to upload later: is there room for it? */
async function checkSpace(size: number) {
  if (!offlineState().active) return;
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < size + SPARE_BYTES) {
    throw new Error(t("This phone is out of space for photos and videos waiting to upload. Connect to the internet so the waiting ones can upload, or free up space."));
  }
}

/**
 * Check limits and compress photos on the phone, then reserve → upload → confirm. For a technician
 * it's kept on the phone first and uploads on a good connection: returns the updated job once it's
 * on the server, or nothing while it waits.
 */
export async function uploadMedia(job: Pick<Job, "id" | "title" | "status">, kind: string, file: File, limits: Limits) {
  let body: Blob = file;
  let contentType = file.type || "application/octet-stream";
  let name = file.name || "upload";
  if (kind === "video") {
    if (file.size > limits.video_mb * 1024 * 1024) throw new Error(t("Videos can be at most {size} MB.", { size: limits.video_mb }));
    const seconds = await videoSeconds(file);
    if (seconds > limits.video_seconds + 0.5) throw new Error(t("Videos can be at most {count} seconds long.", { count: limits.video_seconds }));
  } else {
    body = await compressImage(file);
    contentType = "image/jpeg";
    name = name.replace(/\.[^.]+$/, "") + ".jpg";
  }
  await checkSpace(body.size);
  return queueMedia(job, { kind, contentType, size: body.size, name }, body, async () => {
    const reserved = await requestUpload(job.id, { kind, content_type: contentType, size: body.size, name });
    await sendUpload(reserved.upload, body);
    return confirmUpload(reserved.file_id);
  });
}
