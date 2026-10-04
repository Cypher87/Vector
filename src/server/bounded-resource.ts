import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { gunzip } from 'node:zlib';

export class ResourceError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

const inside = (root: string, file: string) => {
  const rel = relative(root, file);
  return !!rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
};

/** Root is administrator-owned config. No symlinks or special files below it. */
export async function readBoundedFile(root: string, resource: string, maximumBytes: number, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  if (!resource || resource.includes('\\') || resource.includes('\0') || isAbsolute(resource)
    || resource.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new ResourceError('Invalid local resource', 400);
  }
  let handle;
  try {
    const directory = await realpath(root);
    let file = directory;
    const parts = resource.split('/');
    for (let index = 0; index < parts.length; index++) {
      file = join(file, parts[index]);
      const info = await lstat(file);
      if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) {
        throw new ResourceError('Local resource must be a regular file without symlinks', 403);
      }
    }
    if (!inside(directory, await realpath(file))) throw new ResourceError('Local resource escaped its directory', 403);
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const info = await handle.stat();
    if (!info.isFile()) throw new ResourceError('Local resource is not a regular file', 403);
    // Recheck the opened descriptor in case an ancestor changed between lookup and open.
    if (process.platform === 'linux' && !inside(directory, await realpath(`/proc/self/fd/${handle.fd}`))) {
      throw new ResourceError('Local resource escaped its directory', 403);
    }
    if (info.size > maximumBytes) throw new ResourceError('Resource is too large', 413);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      signal?.throwIfAborted();
      const chunk = Buffer.alloc(Math.min(64 * 1024, maximumBytes - total + 1));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maximumBytes) throw new ResourceError('Resource is too large', 413);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof ResourceError || signal?.aborted) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new ResourceError('Resource is not available', 404);
    if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') throw new ResourceError('Resource is not readable by Vector', 403);
    throw new ResourceError('Unable to read local resource');
  } finally { await handle?.close(); }
}

export async function readBoundedResponse(response: Response, maximumBytes: number, signal?: AbortSignal): Promise<Buffer> {
  const reader = response.body?.getReader();
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    if (response.status >= 300 && response.status < 400) throw new ResourceError('Upstream redirects are not allowed');
    if (!response.ok) throw new ResourceError(response.status === 404 ? 'Resource is not available' : 'Upstream request failed', response.status === 404 ? 404 : 502);
    if (Number(response.headers.get('content-length')) > maximumBytes) throw new ResourceError('Resource is too large', 413);
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new ResourceError('Resource is too large', 413);
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}

export async function decompressResource(body: Buffer, maximumBytes: number, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  if (body[0] !== 0x1f || body[1] !== 0x8b) {
    if (body.length > maximumBytes) throw new ResourceError('Resource is too large', 413);
    return body;
  }
  const decoded = await new Promise<Buffer>((resolve, reject) => {
    gunzip(body, { maxOutputLength: maximumBytes }, (error, output) => {
      if (error) reject(new ResourceError('Invalid or oversized compressed resource'));
      else resolve(output);
    });
  });
  signal?.throwIfAborted();
  return decoded;
}
