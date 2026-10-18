// Static server for the web apps: node scripts/serve.js  →  http://localhost:5173 (PORT=… to change)
const http = require("http")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "web")
const types = {
    ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript",
    ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".png": "image/png"
}

http.createServer((req, res) => {
    let rel
    try {
        rel = decodeURIComponent(req.url.split("?")[0]) // malformed escapes would otherwise crash the server
    } catch {
        return res.writeHead(400).end("bad request")
    }
    const file = path.join(root, path.normalize(rel).replace(/^[\\/]+$/, "index.html"))
    if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end() // not ../web-other
    fs.readFile(file, (err, data) => {
        if (err) return res.writeHead(404).end("not found")
        res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })
        res.end(data)
    })
}).listen(process.env.PORT || 5173, function () { console.log(`Naungan web → http://localhost:${this.address().port}`) })
