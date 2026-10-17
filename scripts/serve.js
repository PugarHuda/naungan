// Static server for the dashboard: node scripts/serve.js  →  http://localhost:5173
const http = require("http")
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..", "web")
const types = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript" }

http.createServer((req, res) => {
    const file = path.join(root, path.normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^[\\/]+$/, "index.html"))
    if (!file.startsWith(root)) return res.writeHead(403).end()
    fs.readFile(file, (err, data) => {
        if (err) return res.writeHead(404).end("not found")
        res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" })
        res.end(data)
    })
}).listen(5173, () => console.log("Naungan dashboard → http://localhost:5173"))
