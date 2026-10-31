import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createFileServer } from "../server.ts";

const TOKEN = "t".repeat(32);
const PDF = Buffer.from("%PDF-1.7 deneme");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
const auth = { Authorization: `Bearer ${TOKEN}` };

let dir: string;
let base: string;
const server = () => createFileServer({ dir, token: TOKEN, maxBytes: 1024, minFreeBytes: 0 });
let running: ReturnType<typeof server>;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "naal-files-"));
  running = server();
  await new Promise<void>((resolve) => running.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(running.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => running.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

const put = (key: string, body: Uint8Array, headers: Record<string, string> = auth) =>
  fetch(`${base}/files/${key}`, { method: "PUT", body, headers });

test("yüklenen PDF herkese açık okunur, silinince kaybolur", async () => {
  assert.equal((await put("certificates/a.pdf", PDF)).status, 201);

  const read = await fetch(`${base}/files/certificates/a.pdf`);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("content-type"), "application/pdf");
  assert.equal(read.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), PDF);

  const head = await fetch(`${base}/files/certificates/a.pdf`, { method: "HEAD" });
  assert.equal(head.headers.get("content-length"), String(PDF.length));

  const removed = await fetch(`${base}/files/certificates/a.pdf`, { method: "DELETE", headers: auth });
  assert.equal(removed.status, 204);
  assert.equal((await fetch(`${base}/files/certificates/a.pdf`)).status, 404);
});

test("Instagram anahtarı biçimindeki WebP kabul edilir, aynı anahtar üzerine yazılır", async () => {
  const key = "instagram/tech/1789_1.webp";
  assert.equal((await put(key, WEBP)).status, 201);
  assert.equal((await put(key, WEBP)).status, 201);
  assert.equal((await fetch(`${base}/files/${key}`)).headers.get("content-type"), "image/webp");
  assert.deepEqual(await readdir(join(dir, "instagram/tech")), ["1789_1.webp"]);
});

test("anahtar olmadan yazılamaz ve silinemez", async () => {
  await put("korunan.pdf", PDF);
  assert.equal((await put("yeni.pdf", PDF, {})).status, 401);
  assert.equal((await put("yeni.pdf", PDF, { Authorization: "Bearer yanlis" })).status, 401);
  assert.equal((await fetch(`${base}/files/korunan.pdf`, { method: "DELETE" })).status, 401);
  assert.equal((await fetch(`${base}/files/korunan.pdf`)).status, 200);
});

test("içeriği uzantısına uymayan ve desteklenmeyen dosyalar reddedilir", async () => {
  assert.equal((await put("sayfa.pdf", Buffer.from("<html><script>alert(1)</script>"))).status, 415);
  assert.equal((await put("gorsel.webp", PDF)).status, 415);
  for (const key of ["sayfa.html", "resim.svg", "uzantisiz", "a.pdf.tmp"]) {
    assert.equal((await put(key, PDF)).status, 400, key);
  }
});

test("dizin dışına çıkan yollar dosyaya ulaşamaz", async () => {
  for (const path of ["/files/../../gizli.pdf", "/files/%2e%2e/gizli.pdf", "/files/a%2fb.pdf", "/files/a/..%5cb.pdf", "/files//a.pdf"]) {
    const res = await fetch(`${base}${path}`, { method: "PUT", body: PDF, headers: auth });
    assert.ok(res.status === 400 || res.status === 404, `${path}: ${res.status}`);
  }
  assert.deepEqual((await readdir(dir)).filter((name) => name.includes("gizli")), []);
});

test("sınırı aşan dosya yazılmaz", async () => {
  const big = Buffer.concat([PDF, Buffer.alloc(2048)]);
  assert.equal((await put("buyuk.pdf", big)).status, 413);
  assert.equal((await fetch(`${base}/files/buyuk.pdf`)).status, 404);
});

test("disk dolunca yazma durur, sağlık kontrolü hata verir", async () => {
  const full = createFileServer({ dir, token: TOKEN, maxBytes: 1024, minFreeBytes: Number.MAX_SAFE_INTEGER });
  await new Promise<void>((resolve) => full.listen(0, "127.0.0.1", resolve));
  const fullBase = `http://127.0.0.1:${(full.address() as AddressInfo).port}`;
  const res = await fetch(`${fullBase}/files/dolu.pdf`, { method: "PUT", body: PDF, headers: auth });
  assert.equal(res.status, 507);
  assert.equal((await fetch(`${fullBase}/healthz`)).status, 503);
  await new Promise((resolve) => full.close(resolve));
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
});
