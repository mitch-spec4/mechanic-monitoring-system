"""Where uploaded files live. Two interchangeable backends, chosen by STORAGE_BACKEND:

- local: files on disk (development, or a single server). Uploads are sent to this app.
- s3: any S3-compatible bucket. The phone uploads straight to the bucket with a short-lived
  signed PUT link, so large videos never pass through the app (and its request-size limits).
  PUT links work on AWS S3, Cloudflare R2 and Backblaze B2 alike (R2 and B2 don't support
  signed POST forms).

Both give the phone the same thing to do: PUT the file to a URL with the given headers.

Either way the app only hands out files after checking company and role (routes/media.py).
"""
import os
import re
from pathlib import Path

from flask import current_app
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

UPLOAD_SECONDS = 15 * 60
DOWNLOAD_SECONDS = 5 * 60


class StorageError(Exception):
    pass


class LocalStorage:
    def __init__(self, root):
        self.root = Path(root).resolve()

    def _path(self, key):
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise StorageError("Invalid storage key")
        return path

    def upload_target(self, key, content_type, size, max_bytes, file_id):
        token = _serializer().dumps({"file": file_id, "key": key, "max": max_bytes})
        return {"method": "PUT", "url": f"/api/files/upload/{token}", "headers": {"Content-Type": content_type}}

    def save_stream(self, key, stream, max_bytes):
        """Write an upload to disk, refusing anything over max_bytes. Returns the size."""
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        with open(path, "wb") as out:
            while chunk := stream.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    out.close()
                    path.unlink(missing_ok=True)
                    raise StorageError("File is too large")
                out.write(chunk)
        return size

    def put(self, key, data, content_type):
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def size(self, key):
        path = self._path(key)
        return path.stat().st_size if path.exists() else None

    def read(self, key):
        return self._path(key).read_bytes()

    def delete(self, key):
        self._path(key).unlink(missing_ok=True)

    def download_url(self, key, filename, content_type, attachment):
        return None  # served by the app itself

    def local_path(self, key):
        return self._path(key)


class S3Storage:
    def __init__(self, config):
        import boto3
        from botocore.config import Config

        self.bucket = config["S3_BUCKET"]
        self.client = boto3.client(
            "s3",
            endpoint_url=config["S3_ENDPOINT_URL"] or None,
            region_name=config["S3_REGION"] or None,
            aws_access_key_id=config["S3_ACCESS_KEY_ID"],
            aws_secret_access_key=config["S3_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4"),
        )

    def upload_target(self, key, content_type, size, max_bytes, file_id):
        # The declared size and type are signed into the link; the confirm step checks the
        # stored size again in case a provider doesn't enforce them.
        url = self.client.generate_presigned_url(
            "put_object",
            Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type, "ContentLength": size},
            ExpiresIn=UPLOAD_SECONDS,
        )
        return {"method": "PUT", "url": url, "headers": {"Content-Type": content_type}}

    def put(self, key, data, content_type):
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def size(self, key):
        from botocore.exceptions import ClientError

        try:
            return self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"]
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise

    def read(self, key):
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def download_url(self, key, filename, content_type, attachment):
        disposition = f'{"attachment" if attachment else "inline"}; filename="{header_filename(filename)}"'
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key, "ResponseContentType": content_type, "ResponseContentDisposition": disposition},
            ExpiresIn=DOWNLOAD_SECONDS,
        )


def header_filename(name):
    """The uploader's file name, reduced to characters that are safe inside a response header."""
    return re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip(" .")[:100] or "file"


def init_storage(app):
    backend = app.config["STORAGE_BACKEND"]
    if backend == "local":
        root = app.config["STORAGE_LOCAL_DIR"] or os.path.join(app.instance_path, "uploads")
        app.extensions["storage"] = LocalStorage(root)
    elif backend == "s3":
        missing = [name for name in ("S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY") if not app.config[name]]
        if missing:
            raise RuntimeError("STORAGE_BACKEND=s3 needs " + ", ".join(missing))
        app.extensions["storage"] = S3Storage(app.config)
    else:
        raise RuntimeError("STORAGE_BACKEND must be 'local' or 's3'")


def storage():
    return current_app.extensions["storage"]


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="local-upload")


def read_upload_token(token):
    try:
        return _serializer().loads(token, max_age=UPLOAD_SECONDS)
    except (BadSignature, SignatureExpired):
        raise StorageError("This upload link is invalid or has expired") from None
