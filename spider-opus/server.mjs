// Static server for the spider demo. three.js is served from node_modules under /vendor/three/.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL(".", import.meta.url));
const threeDirectory =
  process.env.THREE_DIRECTORY || resolve(projectDirectory, "node_modules/three");
const defaultPort = Number(process.env.PORT) || 5391;
const modelRelativePath = "assets/spider.glb";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

// The page asks which model to load, so a missing GLB never shows up as a failed request.
// `?model=standin` forces the generated stand-in even when the GLB exists.
function describeModel(searchParams) {
  const wantsStandIn = searchParams.get("model") === "standin";
  const hasModelFile = existsSync(resolve(projectDirectory, modelRelativePath));
  return { model: hasModelFile && !wantsStandIn ? modelRelativePath : null };
}

function resolveRequestedFile(pathname) {
  const vendorPrefix = "/vendor/three/";
  const isVendorRequest = pathname.startsWith(vendorPrefix);
  const rootDirectory = isVendorRequest ? threeDirectory : projectDirectory;
  let relativePath = pathname.slice(1);
  if (isVendorRequest) {
    relativePath = pathname.slice(vendorPrefix.length);
  } else if (pathname === "/") {
    relativePath = "index.html";
  }
  const filePath = resolve(rootDirectory, decodeURIComponent(relativePath));
  const isInsideRoot = filePath.startsWith(resolve(rootDirectory) + sep);
  return isInsideRoot ? filePath : null;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/model-info.json") {
    response.writeHead(200, { "Content-Type": mimeTypes[".json"], "Cache-Control": "no-store" });
    response.end(JSON.stringify(describeModel(url.searchParams)));
    return;
  }
  const filePath = resolveRequestedFile(url.pathname);
  if (!filePath) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

export function startServer({ port = defaultPort, host = "127.0.0.1" } = {}) {
  const server = createServer(handleRequest);
  return new Promise((resolveServer, rejectServer) => {
    server.once("error", rejectServer);
    server.listen(port, host, () => {
      const address = server.address();
      resolveServer({
        url: `http://${host}:${address.port}`,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

const isRunDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (isRunDirectly) {
  const { url } = await startServer();
  console.log(`Steam spider running at ${url}`);
}
