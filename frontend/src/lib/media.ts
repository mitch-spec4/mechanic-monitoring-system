import { confirmUpload, requestUpload, sendUpload } from "../services/api";

export type Limits = { photo_mb: number; video_mb: number; video_seconds: number };

/** Shrink a photo on the phone before upload: at most 1600 px on the long side, as JPEG. */
export async function compressImage(file: File, maxPx = 1600, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("This photo format can't be read here. Take a new photo or choose a JPEG.");
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Couldn't prepare the photo. Please try again.");
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
      reject(new Error("This video can't be read here. Record it again or choose an MP4."));
    };
    video.src = url;
  });
}

/** Check limits, compress photos, then reserve → upload → confirm. Returns the updated job. */
export async function uploadMedia(jobId: number, kind: string, file: File, limits: Limits) {
  let body: Blob = file;
  let contentType = file.type || "application/octet-stream";
  let name = file.name || "upload";
  if (kind === "video") {
    if (file.size > limits.video_mb * 1024 * 1024) throw new Error(`Videos can be at most ${limits.video_mb} MB.`);
    const seconds = await videoSeconds(file);
    if (seconds > limits.video_seconds + 0.5) throw new Error(`Videos can be at most ${limits.video_seconds} seconds long.`);
  } else {
    body = await compressImage(file);
    contentType = "image/jpeg";
    name = name.replace(/\.[^.]+$/, "") + ".jpg";
  }
  const reserved = await requestUpload(jobId, { kind, content_type: contentType, size: body.size, name });
  await sendUpload(reserved.upload, body);
  return (await confirmUpload(reserved.file_id)).job;
}
