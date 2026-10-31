// Caddy site bloğunu .env'deki değerlerden üretir; alan adı değişince yeniden çalıştırılır.

const { FILES_DOMAIN: domain, FILES_MAX_MB = "10", PORT = "8090" } = process.env;
if (!domain) throw new Error("FILES_DOMAIN tanımlı değil");

console.log(`${domain} {
	request_body {
		max_size ${Number(FILES_MAX_MB) + 1}MB
	}
	reverse_proxy 127.0.0.1:${PORT}
}`);
