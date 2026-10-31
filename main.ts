import { mkdir } from "node:fs/promises";
import { createFileServer } from "./server.ts";

const MEGABYTE = 1024 * 1024;
const MIN_TOKEN_LENGTH = 32;

const { FILES_DIR: dir, FILES_TOKEN: token, FILES_MAX_MB = "10", FILES_MIN_FREE_MB = "1024", PORT = "8090" } = process.env;
if (!dir) throw new Error("FILES_DIR tanımlı değil");
if (!token || token.length < MIN_TOKEN_LENGTH) throw new Error(`FILES_TOKEN en az ${MIN_TOKEN_LENGTH} karakter olmalı`);

await mkdir(dir, { recursive: true });
createFileServer({
  dir,
  token,
  maxBytes: Number(FILES_MAX_MB) * MEGABYTE,
  minFreeBytes: Number(FILES_MIN_FREE_MB) * MEGABYTE,
}).listen(Number(PORT), "127.0.0.1", () => console.log(`Dosya servisi 127.0.0.1:${PORT} üzerinde çalışıyor`));
