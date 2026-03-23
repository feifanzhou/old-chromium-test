const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const process = require("node:process");
const { By, WebDriver, until } = require("selenium-webdriver");
const http = require("selenium-webdriver/http");
const command = require("selenium-webdriver/lib/command");
const chrome = require("selenium-webdriver/chrome");

const ROOT_DIR = path.resolve(__dirname, "..");
const EXPECTED_TUBI_URL = "https://tubitv.com/?utm_source=dev";
const CHROMEDRIVER_PATH = process.env.CHROMEDRIVER_PATH || "";
const REMOTE_WEBDRIVER_URL = process.env.REMOTE_WEBDRIVER_URL || "";
const USING_REMOTE_WEBDRIVER = Boolean(REMOTE_WEBDRIVER_URL);
const CHROME_BINARY_PATH = process.env.CHROME_BINARY_PATH || (USING_REMOTE_WEBDRIVER
  ? "/opt/chromium44/chrome-linux/chrome"
  : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const BROWSER_APP_HOST = process.env.BROWSER_APP_HOST || (REMOTE_WEBDRIVER_URL ? "host.docker.internal" : "127.0.0.1");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usingLegacyChromeDriver() {
  return Boolean(CHROMEDRIVER_PATH) || USING_REMOTE_WEBDRIVER;
}

function getWebDriverEndpoint(url) {
  if (!url) {
    return "";
  }

  const parsed = new URL(url);
  if (parsed.pathname === "/wd/hub") {
    return parsed.toString();
  }

  if (parsed.pathname === "/" || parsed.pathname === "") {
    parsed.pathname = "/wd/hub";
    return parsed.toString();
  }

  return parsed.toString();
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
  const entrypoint = path.join(ROOT_DIR, "server.js");
  const serverProcess = spawn(process.execPath, [entrypoint], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "0.0.0.0",
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
  let chromeDriverService = null;
  let serviceUrl = getWebDriverEndpoint(REMOTE_WEBDRIVER_URL);

  if (!serviceUrl) {
    const serviceBuilder = CHROMEDRIVER_PATH ? new chrome.ServiceBuilder(CHROMEDRIVER_PATH) : new chrome.ServiceBuilder();
    chromeDriverService = serviceBuilder.build();
    serviceUrl = await chromeDriverService.start();
  }

  const chromeArgs = ["--disable-gpu", "--window-size=1280,800"];
  if (String(process.env.HEADLESS || "").toLowerCase() === "true") {
    chromeArgs.push("--headless");
  }

  if (usingLegacyChromeDriver()) {
    chromeArgs.push(
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--metrics-recording-only",
      "--safebrowsing-disable-auto-update",
      "--disable-component-update",
    );
  }

  const legacyDesiredCapabilities = {
    browserName: "chrome",
    loggingPrefs: { performance: "ALL" },
    chromeOptions: {
      binary: CHROME_BINARY_PATH,
      args: chromeArgs,
    },
    chrome: {
      binary: CHROME_BINARY_PATH,
    },
  };

  const executor = new http.Executor(new http.HttpClient(serviceUrl));
  if (usingLegacyChromeDriver()) {
    executor.defineCommand(command.Name.EXECUTE_SCRIPT, "POST", "/session/:sessionId/execute");
    executor.defineCommand(command.Name.EXECUTE_ASYNC_SCRIPT, "POST", "/session/:sessionId/execute_async");
  }

  const createSessionCommand = new command.Command(command.Name.NEW_SESSION);
  createSessionCommand.setParameter("desiredCapabilities", legacyDesiredCapabilities);
  createSessionCommand.setParameter("requiredCapabilities", {});

  try {
    const session = await executor.execute(createSessionCommand);
    const driver = new WebDriver(Promise.resolve(session), executor, async () => {
      if (chromeDriverService) {
        await Promise.resolve(chromeDriverService.kill());
      }
    });

    return { driver, chromeDriverService };
  } catch (error) {
    if (chromeDriverService) {
      await Promise.resolve(chromeDriverService.kill());
    }
    throw error;
  }
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
  const baseUrl = `http://${BROWSER_APP_HOST}:${port}`;
  const serverProcess = startAppServer(port);
  let driver;
  let chromeDriverService;

  try {
    await waitForServerReady();

    if (REMOTE_WEBDRIVER_URL) {
      const connectivityProbe = spawn(
        "docker",
        [
          "exec",
          "legacy44-driver",
          "bash",
          "-lc",
          `curl -s -m 5 '${baseUrl}' | head -n 5`,
        ],
        { cwd: ROOT_DIR, stdio: "inherit" },
      );
      await new Promise((resolve) => connectivityProbe.on("exit", resolve));
    }

    const browser = await createDriver();
    driver = browser.driver;
    chromeDriverService = browser.chromeDriverService;

    await driver.get(baseUrl);

    const currentUrl = await driver.getCurrentUrl();
    if (!currentUrl || currentUrl.indexOf(baseUrl) !== 0) {
      throw new Error(`Expected browser URL to start with '${baseUrl}', received '${currentUrl}'`);
    }

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

    if (chromeDriverService) {
      await Promise.resolve(chromeDriverService.kill());
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
