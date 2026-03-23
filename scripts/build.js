const esbuild = require("esbuild");
const babel = require("@babel/core");
const fs = require("node:fs");
const path = require("node:path");

const sourcePath = path.resolve("src/main.jsx");
const transpiledPath = path.resolve(".tmp/main.transpiled.js");

async function build() {
  fs.mkdirSync(path.dirname(transpiledPath), { recursive: true });

  const babelResult = await babel.transformFileAsync(sourcePath, {
    configFile: path.resolve("babel.config.json"),
  });

  if (!babelResult || typeof babelResult.code !== "string") {
    throw new Error("Babel failed to transpile src/main.jsx");
  }

  fs.writeFileSync(transpiledPath, babelResult.code, "utf8");

  await esbuild.build({
    entryPoints: [transpiledPath],
    bundle: true,
    outfile: "public/dist/main.js",
    format: "iife",
    target: ["chrome44"],
    sourcemap: true,
    loader: {
      ".js": "jsx",
      ".jsx": "jsx",
    },
  });
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
