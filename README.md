# naal-files

Yönetim panelinin sertifika PDF'lerini ve Instagram görsellerini sakladığı küçük dosya servisi. Node 24 ile çalışır, bağımlılığı yoktur. Dosyalar klasörde düz dosya olarak durur.

| İstek | Yetki | İş |
|---|---|---|
| `GET`, `HEAD /files/<anahtar>` | Herkese açık | Dosyayı verir |
| `PUT /files/<anahtar>` | `Authorization: Bearer <FILES_TOKEN>` | Dosyayı yazar |
| `DELETE /files/<anahtar>` | `Authorization: Bearer <FILES_TOKEN>` | Dosyayı siler |
| `GET /healthz` | Herkese açık | Disk dolmak üzereyse 503 döner |

Yalnızca `.pdf` ve `.webp` kabul edilir, içerik dosya imzasıyla doğrulanır.

## Kurulum

Alan adınızı seçin ve DNS'te sunucuya yönlendirin. Ardından Node 24, pm2 ve Caddy kurulu sunucuda:

```bash
sudo mkdir -p /opt/naal-files /var/lib/naal-files
sudo chown "$USER" /opt/naal-files /var/lib/naal-files
```

Bu klasörü `/opt/naal-files` altına kopyalayın:

```bash
cd /opt/naal-files
cp .env.example .env
openssl rand -base64 32
```

Üretilen değeri `.env` dosyasındaki `FILES_TOKEN` alanına, alan adını `FILES_DOMAIN` alanına yazın, sonra başlatın:

```bash
chmod 600 .env
pm2 start ecosystem.config.cjs
pm2 save
```

Caddy ayarını `.env` dosyasından üretin:

```bash
node --no-warnings --env-file=.env caddy.ts | sudo tee /etc/caddy/naal-files.caddy
```

`/etc/caddy/Caddyfile` dosyasının sonuna bir kez `import naal-files.caddy` satırını ekleyin, sonra Caddy'yi yeniden yükleyin:

```bash
sudo systemctl reload caddy
```

Servis yalnızca `127.0.0.1` adresini dinler; dışarıdan 8090 portu açılmaz.

Panelin Netlify ayarlarına ve `.env.local` dosyasına iki değer yazın:

```
FILES_URL=https://<alan adınız>
FILES_TOKEN=<sunucudaki değer>
```

## Deneme

```bash
curl https://<alan adınız>/healthz
```

`{"ok":true}` dönmeli.

## Alan adını değiştirme

1. Yeni adı DNS'te sunucuya yönlendirin ve `.env` içindeki `FILES_DOMAIN` değerini değiştirin.
2. Caddy ayarını yukarıdaki komutla yeniden üretip Caddy'yi yeniden yükleyin.
3. Netlify'da ve panelin `.env.local` dosyasında `FILES_URL` değerini güncelleyin ve paneli yeniden yayınlayın.

**Eski kayıtlar:** Panel her dosyanın tam adresini veritabanına yazar, bu yüzden kayıtlı bağlantılar kendiliğinden değişmez. Değişiklikten sonra `cert_pdf.pdf_link` ve `posts_instagram.image_links` içindeki eski adresleri yenisiyle değiştirin, ya da eski alan adını da Caddy'de bırakın.

## Yedek

**Sunucu tek kopyadır; disk bozulursa dosyalar gider.** Eski PDF'ler böyle kayboldu. Klasörü her gece başka bir makineye kopyalayın:

```bash
rsync -a /var/lib/naal-files/ yedek@<yedek sunucu>:naal-files/
```

`crontab -e` ile eklenecek satır:

```
0 3 * * * rsync -a /var/lib/naal-files/ yedek@<yedek sunucu>:naal-files/
```

`--delete` kullanmayın: bir dosya yanlışlıkla silinirse yedekte kalsın.

## İzleme

Uptime Robot gibi bir serviste `https://<alan adınız>/healthz` adresini izleyin. Sunucu kapalıyken PDF bağlantıları ve Instagram görselleri açılmaz, yeni yükleme de hata verir.

## Anahtar sızarsa

`.env` içindeki `FILES_TOKEN` değerini yenileyip `pm2 restart naal-files --update-env` çalıştırın, aynı değeri Netlify'da güncelleyin. Eski anahtar anında geçersiz olur.

## Test

```bash
npm test
```
