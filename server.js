const http = require('http');
const fs = require('fs');
const path = require('path');
const apiHandler = require('./api/index.js');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.exe': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsed.pathname);

  if (pathname.startsWith('/api/') || pathname === '/api.php') {
    return apiHandler(req, res);
  }

  let filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not Found');
  }
  const ext = path.extname(filePath).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (ext === '.exe') {
    headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`TUNOTOGETHER server running on http://localhost:${PORT}`);
});
