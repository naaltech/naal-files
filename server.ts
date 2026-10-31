// NAAL dosya servisi: sertifika PDF'leri ve Instagram görselleri diskte durur.
//
// Okuma herkese açıktır, yazma ve silme FILES_TOKEN ister. Yalnızca PDF ve WebP kabul edilir ve içerik dosya imzasıyla
// doğrulanır; böylece anahtar sızsa bile buradan çalışan bir sayfa ya da betik yayınlanamaz.

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

export interface FileServerConfig {
  dir: string;
  token: string;
  maxBytes: number;
  minFreeBytes: number;
}

const FILE_ROUTE = "/files/";
const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(pdf|webp)$/;
const CONTENT_TYPES: Record<string, string> = { pdf: "application/pdf", webp: "image/webp" };

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

function authorized(req: IncomingMessage, token: string) {
  return timingSafeEqual(sha256(req.headers.authorization ?? ""), sha256(`Bearer ${token}`));
}

function hasSignature(extension: string, body: Buffer) {
  if (extension === "pdf") return body.subarray(0, 5).toString("latin1") === "%PDF-";
  return body.subarray(0, 4).toString("latin1") === "RIFF" && body.subarray(8, 12).toString("latin1") === "WEBP";
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, maxBytes: number) {
  if (Number(req.headers["content-length"] ?? 0) > maxBytes) throw new HttpError(413, "Dosya çok büyük");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "Dosya çok büyük");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function freeBytes(dir: string) {
  const disk = await statfs(dir);
  return disk.bavail * disk.bsize;
}

async function putFile(req: IncomingMessage, res: ServerResponse, config: FileServerConfig, key: string, extension: string) {
  const body = await readBody(req, config.maxBytes);
  if (!hasSignature(extension, body)) throw new HttpError(415, "Dosya içeriği uzantısıyla uyuşmuyor");
  if ((await freeBytes(config.dir)) - body.length < config.minFreeBytes) throw new HttpError(507, "Disk dolu");

  const path = join(config.dir, key);
  await mkdir(dirname(path), { recursive: true });
  // Yarım kalan yazma var olan dosyayı bozmasın diye önce geçici dosyaya yazılır.
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, body);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  json(res, 201, { key });
}

async function getFile(req: IncomingMessage, res: ServerResponse, config: FileServerConfig, key: string, extension: string) {
  const path = join(config.dir, key);
  const file = await stat(path).catch(() => null);
  if (!file?.isFile()) throw new HttpError(404, "Dosya bulunamadı");

  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extension],
    "Content-Length": file.size,
    // Anahtar her dosya için yenidir, içerik değişmez.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  await pipeline(createReadStream(path), res);
}

async function handle(req: IncomingMessage, res: ServerResponse, config: FileServerConfig) {
  // URL ayrıştırıcı "..", "%2e%2e" gibi yolları burada çözer; kalan yüzde işaretlerini anahtar kalıbı reddeder.
  const { pathname } = new URL(req.url ?? "/", "http://files.local");

  if (pathname === "/healthz") {
    const healthy = (await freeBytes(config.dir)) >= config.minFreeBytes;
    json(res, healthy ? 200 : 503, { ok: healthy });
    return;
  }
  if (!pathname.startsWith(FILE_ROUTE)) throw new HttpError(404, "Bulunamadı");

  const key = pathname.slice(FILE_ROUTE.length);
  const extension = KEY_PATTERN.exec(key)?.[1];
  if (!extension) throw new HttpError(400, "Geçersiz dosya adı");

  if (req.method === "GET" || req.method === "HEAD") return getFile(req, res, config, key, extension);
  if (req.method !== "PUT" && req.method !== "DELETE") throw new HttpError(405, "Desteklenmeyen istek");

  if (!authorized(req, config.token)) throw new HttpError(401, "Yetkisiz");
  if (req.method === "PUT") return putFile(req, res, config, key, extension);
  await rm(join(config.dir, key), { force: true });
  res.writeHead(204).end();
}

export function createFileServer(config: FileServerConfig) {
  const server = createServer((req, res) => {
    handle(req, res, config).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      json(res, status, { error: e instanceof HttpError ? e.message : "Sunucu hatası" });
    });
  });
  server.requestTimeout = 60_000;
  return server;
}
