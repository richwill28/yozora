export interface PdfFileAccess {
  stat(): PromiseLike<{ size: number }>;
  read(): PromiseLike<Uint8Array>;
}

export async function readPdf(file: PdfFileAccess, maxBytes: number): Promise<ArrayBuffer> {
  const stat = await file.stat();
  if (stat.size > maxBytes) {
    throw new Error(
      `This PDF exceeds the ${Math.round(maxBytes / 1024 / 1024)} MiB limit. Increase yozora.maxFileSizeMiB in Settings to open it.`,
    );
  }

  const bytes = await file.read();
  if (bytes.byteLength > maxBytes) {
    throw new Error('The PDF grew beyond the configured size limit.');
  }
  if (!bytes.byteLength) {
    throw new Error('This PDF is empty.');
  }

  // A new buffer avoids leaking bytes outside a pooled Uint8Array's slice.
  return new Uint8Array(bytes).buffer;
}
