// server.mjs — tiny HTTP + SSE server for the live council UI.
// Run:  node --env-file=.env.local server.mjs   then open http://localhost:5050
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { runCouncil } from './council.mjs';

const PORT = process.env.PORT || 5050;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    try {
      const html = await readFile(new URL('./public/index.html', import.meta.url));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch { res.writeHead(500); res.end('missing public/index.html'); }
    return;
  }

  if (url.pathname === '/run') {
    const q = (url.searchParams.get('q') || '').trim();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const emit = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (!q) { emit({ type: 'fatal', error: 'empty query' }); res.end(); return; }
    try { await runCouncil(q, emit); }
    catch (e) { emit({ type: 'fatal', error: String(e.message) }); }
    res.end();
    return;
  }

  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log(`LLM Council UI → http://localhost:${PORT}`));
