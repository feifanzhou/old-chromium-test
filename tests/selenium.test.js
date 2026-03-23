const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const process = require("node:process");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

const ROOT_DIR = path.resolve(__dirname, "..");
const EXPECTED_TUBI_URL = "https://tubitv.com/?utm_source=dev";
const CHROME_BINARY_PATH = process.env.CHROME_BINARY_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROMEDRIVER_PATH = process.env.CHROMEDRIVER_PATH || "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequestUrlFromEntry(entry) {
  try {
    const message = JSON.parse(entry.message).message;
    if (message.method !== "Network.requestWillBeSent") {
      return null;
    }
    return message.params?.request?.url || null;
  } catch {
    return null;
  }
}

async function waitForServerReady() {
  const baseUrl = `http://127.0.0.1:${globalThis.__APP_PORT__}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        const html = await response.text();
        if (html.includes("React Selenium Demo") && html.includes("/dist/main.js")) {
          return;
        }
      }
    } catch {
      // Server may still be starting.
    }
    await sleep(250);
  }

  throw new Error("Timed out waiting for the app server to be ready");
}

async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve available port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function startAppServer(port) {
  const serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
    },
  });

  return serverProcess;
}

async function runBuild() {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const buildProcess = spawn(npmExecutable, ["run", "build"], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: process.env,
  });

  await new Promise((resolve, reject) => {
    buildProcess.on("error", reject);
    buildProcess.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Build failed with exit code ${code}`));
    });
  });
}

async function stopServer(serverProcess) {
  if (!serverProcess || serverProcess.killed) {
    return;
  }

  serverProcess.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => serverProcess.once("exit", resolve)),
    sleep(2_000),
  ]);

  if (!serverProcess.killed) {
    serverProcess.kill("SIGKILL");
  }
}

async function createDriver() {
  const options = new chrome.Options();
  options.addArguments("--disable-gpu", "--window-size=1280,800");

  if (String(process.env.HEADLESS || "").toLowerCase() === "true") {
    options.addArguments("--headless");
  }

  options.setChromeBinaryPath(CHROME_BINARY_PATH);
  options.setLoggingPrefs({ performance: "ALL" });

  const serviceBuilder = CHROMEDRIVER_PATH ? new chrome.ServiceBuilder(CHROMEDRIVER_PATH) : new chrome.ServiceBuilder();

  return new Builder().forBrowser("chrome").setChromeOptions(options).setChromeService(serviceBuilder).build();
}

async function waitForTubiRequest(driver) {
  const networkDeadline = Date.now() + 15_000;
  while (Date.now() < networkDeadline) {
    try {
      const entries = await driver.manage().logs().get("performance");
      for (const entry of entries) {
        const requestUrl = getRequestUrlFromEntry(entry);
        if (requestUrl && requestUrl.indexOf(EXPECTED_TUBI_URL) === 0) {
          return;
        }
      }
    } catch {
      // Old ChromeDriver versions may not expose performance logs reliably.
    }

    const requestState = await driver.executeScript(
      "var req = window.__demoTubiRequest; return req ? { attempted: !!req.attempted, url: req.url || '' } : null;",
    );
    if (requestState && requestState.attempted && requestState.url === EXPECTED_TUBI_URL) {
      return;
    }

    await sleep(250);
  }

  throw new Error(`Did not observe request attempt to '${EXPECTED_TUBI_URL}'`);
}

async function runTests() {
  await runBuild();
  const port = await findAvailablePort();
  globalThis.__APP_PORT__ = port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = startAppServer(port);
  let driver;

  try {
    await waitForServerReady();
    driver = await createDriver();

    await driver.get(baseUrl);

    const heading = await driver.wait(until.elementLocated(By.xpath("//*[contains(text(), 'Hello World')]")), 10_000);
    const headingText = await heading.getText();
    if (!headingText.includes("Hello World")) {
      throw new Error(`Expected page text to include 'Hello World', received '${headingText}'`);
    }
    console.log("✓ Test 1 passed: page contains 'Hello World'");

    const titleBeforeClick = await driver.findElement(By.css('[data-testid="tubi-title"]')).getText();
    if (!titleBeforeClick.includes("Not loaded yet")) {
      throw new Error(`Expected title state before click to be 'Not loaded yet', received '${titleBeforeClick}'`);
    }

    const fetchButton = await driver.findElement(By.css('[data-testid="fetch-tubi-button"]'));
    await fetchButton.click();

    await waitForTubiRequest(driver);
    console.log("✓ Test 2 passed: click triggered request to tubitv.com with utm_source=dev");

    await driver.wait(async () => {
      const titleText = await driver.findElement(By.css('[data-testid="tubi-title"]')).getText();
      return titleText.includes("Watch Free Movies and TV Shows Online");
    }, 15_000);
    console.log("✓ Test 3 passed: page rendered the fetched Tubi title");
  } finally {
    if (driver) {
      await driver.quit();
    }

    await stopServer(serverProcess);
  }
}

runTests()
  .then(() => {
    console.log("All Selenium tests passed.");
  })
  .catch((error) => {
    console.error("Selenium tests failed.");
    console.error(error);
    process.exit(1);
  });
