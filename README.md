# Legacy Chromium 44 Selenium Demo

This repository is a **legacy-only** demo for running a React app and Selenium tests against:

- Chromium `44.0.2403.0`
- ChromeDriver `2.19`
- JSON Wire Protocol session flow (for old ChromeDriver compatibility)

The test flow validates:

1. The page renders `Hello World`.
2. Clicking the button attempts a request to `https://tubitv.com/?utm_source=dev`.
3. The fetched Tubi title is rendered in the page.

## Why Docker

Running Chromium 44 directly on modern macOS (especially Apple Silicon) is unstable. The supported setup in this repo runs old Chromium inside a `linux/amd64` Docker container, while the app server and Node test runner stay on the host.

## Prerequisites

- Node.js `18+` (Node must provide global `fetch` for server/test code)
- npm
- Docker Desktop (or Docker Engine with `linux/amd64` emulation support)

## Install Project Dependencies

```bash
npm install
```

## Recreate the Legacy Docker Image

This builds the same `legacy44:jessie-ch44` image used by the current setup.

```bash
docker run --name legacy44-setup --platform linux/amd64 debian:jessie bash -lc '
set -e
printf "deb [trusted=yes] http://archive.debian.org/debian jessie main\n" > /etc/apt/sources.list
printf "deb [trusted=yes] http://archive.debian.org/debian-security jessie/updates main\n" >> /etc/apt/sources.list
printf "Acquire::Check-Valid-Until \"0\";\nAcquire::AllowInsecureRepositories \"1\";\nAcquire::AllowDowngradeToInsecureRepositories \"1\";\n" > /etc/apt/apt.conf.d/99archive

export DEBIAN_FRONTEND=noninteractive
apt-get update >/dev/null

apt-get install -y --allow-unauthenticated --no-install-recommends \
  curl unzip ca-certificates xvfb xauth libglib2.0-0 libnss3 libx11-6 \
  libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 \
  libxi6 libxrandr2 libxrender1 libxss1 libxtst6 libasound2 libatk1.0-0 \
  libatk-bridge2.0-0 libgtk-3-0 libgtk2.0-0 libdrm2 libgbm1 libpango-1.0-0 \
  libcairo2 libfontconfig1 libgdk-pixbuf2.0-0 libgconf-2-4 procps >/dev/null

mkdir -p /opt/chromium44
curl -sSL -o /opt/chromium44/chrome-linux.zip https://commondatastorage.googleapis.com/chromium-browser-snapshots/Linux_x64/330230/chrome-linux.zip
unzip -q /opt/chromium44/chrome-linux.zip -d /opt/chromium44

curl -sSL -o /opt/chromium44/chromedriver_linux64.zip https://chromedriver.storage.googleapis.com/2.19/chromedriver_linux64.zip
unzip -q /opt/chromium44/chromedriver_linux64.zip -d /opt/chromium44

chmod +x /opt/chromium44/chromedriver /opt/chromium44/chrome-linux/chrome
'

docker commit legacy44-setup legacy44:jessie-ch44
docker rm legacy44-setup
```

## Start the Legacy ChromeDriver Container

```bash
docker run -d --name legacy44-driver --platform linux/amd64 -p 9515:9515 \
  --add-host=host.docker.internal:host-gateway legacy44:jessie-ch44 bash -lc '
set -e
Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
export DISPLAY=:99
exec /opt/chromium44/chromedriver --port=9515 --verbose --url-base=/wd/hub --whitelisted-ips=
'
```

## Verify What Is Running On `127.0.0.1:9515`

Show actual browser/driver versions from inside the running container:

```bash
docker exec legacy44-driver bash -lc '/opt/chromium44/chrome-linux/chrome --version && /opt/chromium44/chromedriver --version | head -n 1'
```

Check driver endpoint health:

```bash
curl -s http://127.0.0.1:9515/wd/hub/status
```

## Run The Selenium Suite (Recommended Path)

```bash
REMOTE_WEBDRIVER_URL=http://127.0.0.1:9515 npm test
```

Expected output includes:

```text
✓ Test 1 passed: page contains 'Hello World'
✓ Test 2 passed: click triggered request to tubitv.com with utm_source=dev
✓ Test 3 passed: page rendered the fetched Tubi title
All Selenium tests passed.
```

Notes:

- `tests/selenium.test.js` auto-normalizes `REMOTE_WEBDRIVER_URL` to `/wd/hub` if omitted.
- In remote mode, browser host defaults to `host.docker.internal`.
- The test harness builds the app (`npm run build`) and starts/stops the Express server automatically.

## Run App Without Selenium

Build + start server:

```bash
npm start
```

Then open `http://127.0.0.1:3000` in a browser.

## Useful Docker Commands

Stop and remove driver container:

```bash
docker rm -f legacy44-driver
```

View driver logs:

```bash
docker logs -f legacy44-driver
```

List the legacy image:

```bash
docker images legacy44:jessie-ch44
```

Remove image:

```bash
docker rmi legacy44:jessie-ch44
```

## Implementation Notes

- Browser code is transpiled for Chrome 44 with Babel (`@babel/preset-env` target `chrome: 44`).
- `Object.assign` polyfill is loaded before React to avoid runtime failure in Chromium 44.
- Build pipeline uses Babel first, then esbuild bundle output to `public/dist/main.js`.
- Selenium uses manual JSON Wire `desiredCapabilities` session creation for ChromeDriver 2.19 compatibility.
- Selenium executor overrides script endpoints to legacy paths (`/execute`, `/execute_async`) because old ChromeDriver does not support W3C `/execute/sync`.

---

Built with Amp: [thread 1](https://github.com/feifanzhou/old-chromium-test), [thread 2](https://ampcode.com/threads/T-019d1c00-4524-7030-8de2-095c557dde72)
