import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../dist-demo");
const types: Record<string, string> = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/") { res.writeHead(302, { Location: "/readyspec/" }).end(); return; }
  if (!url.pathname.startsWith("/readyspec/")) { res.writeHead(404).end(); return; }
  const file = path.resolve(root, url.pathname.slice("/readyspec/".length) || "index.html");
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": `${types[path.extname(file)] ?? "application/octet-stream"}; charset=utf-8`, "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(4173, "127.0.0.1", () => console.log("Demo preview: http://127.0.0.1:4173/readyspec/"));
