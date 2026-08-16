/**
 * `sjl dev` — a static server with live reload.
 *
 * Zero dependencies, which is the point: the engine has none, so its dev server
 * cannot have any either. It is about 150 lines of `node:http` plus an
 * EventSource endpoint that pushes a reload when a watched file changes.
 *
 * Scene edits reload without a full page refresh where possible, so tweaking a
 * level does not cost you the game state you were testing.
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { resolveRoot, readConfig, rel, c } from '../util.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Injected into every HTML response. Reconnects on its own if the server restarts. */
const LIVE_RELOAD_SCRIPT = `
<script>
(() => {
  let retry = 0;
  const connect = () => {
    const source = new EventSource('/__sjl/reload');
    source.onopen = () => { retry = 0; };
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'reload') location.reload();
      if (data.type === 'scene' && window.game?.reloadScene) {
        // Re-fetch the scene and swap it without losing the page — much faster
        // than a reload, and it keeps the console and devtools state.
        fetch(data.path + '?t=' + Date.now())
          .then((r) => r.json())
          .then((scene) => window.game.loadScene(scene))
          .then(() => console.info('[sjl] reloaded ' + data.path))
          .catch(() => location.reload());
      }
    };
    source.onerror = () => {
      source.close();
      retry = Math.min(retry + 1, 10);
      setTimeout(connect, 200 * retry);
    };
  };
  connect();
})();
</script>
`;

export async function run({ options }) {
  const root = resolveRoot(options);

  // Check the root up front. Without this, the first request produces a raw
  // ENOENT from deep inside the file handler, which reads like a server bug
  // rather than "that directory does not exist".
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo?.isDirectory()) {
    throw new Error(`${root} is not a directory. Pass --root <dir> to point at your project.`);
  }

  const config = await readConfig(root);
  const port = Number(options.port ?? 5173);
  const host = String(options.host ?? 'localhost');

  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === '/__sjl/reload') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }

    if (url.pathname === '/__sjl/status') {
      send(response, 200, 'application/json', JSON.stringify({ ok: true, root, config }, null, 2));
      return;
    }

    await serveFile(root, url.pathname, response);
  });

  const watcher = watchProject(root, (event) => {
    const message = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(message);
    console.log(
      `${c.dim(new Date().toLocaleTimeString())} ${c.blue(event.type)} ${event.path ?? ''}`,
    );
  });

  await new Promise((resolve, reject) => {
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Pass --port <n> to pick another.`));
      } else {
        reject(error);
      }
    });
    server.listen(port, host, resolve);
  });

  const url = `http://${host}:${port}/`;
  console.log('');
  console.log(`  ${c.bold('sjl dev')}  ${c.dim(rel(root))}`);
  console.log(`  ${c.green('->')} ${url}`);
  console.log(c.dim('  live reload is on; edit a scene and the page updates'));
  console.log(c.dim('  ctrl-c to stop'));
  console.log('');

  if (options.open) await openBrowser(url);

  // Keep the process alive until interrupted.
  await new Promise((resolve) => {
    const shutdown = () => {
      watcher.close();
      server.close();
      for (const client of clients) client.end();
      console.log('\nstopped');
      resolve();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

  return 0;
}

async function serveFile(root, pathname, response) {
  let filePath = path.join(root, decodeURIComponent(pathname));

  // Contain the request inside the project root; `..` in a URL must not escape.
  if (!filePath.startsWith(root)) {
    send(response, 403, 'text/plain', 'Forbidden');
    return;
  }

  try {
    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info) {
      send(response, 404, 'text/plain', `Not found: ${pathname}`);
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const type = MIME[extension] ?? 'application/octet-stream';

    if (extension === '.html') {
      const html = await readFile(filePath, 'utf8');
      const injected = html.includes('</body>')
        ? html.replace('</body>', `${LIVE_RELOAD_SCRIPT}</body>`)
        : html + LIVE_RELOAD_SCRIPT;
      send(response, 200, type, injected);
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      // Never cache during development, or scene edits appear not to apply.
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch (error) {
    send(response, 500, 'text/plain', `Error reading ${pathname}: ${error.message}`);
  }
}

function send(response, status, type, body) {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(body);
}

/**
 * Watch the project tree, debouncing bursts.
 *
 * A save often produces several events (write, rename, chmod); without the
 * debounce the page reloads three times per keystroke in some editors.
 */
function watchProject(root, onChange) {
  let timer = null;
  let pending = null;

  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const normalized = filename.split(path.sep).join('/');
    if (
      normalized.includes('node_modules/') ||
      normalized.includes('.git/') ||
      normalized.startsWith('dist/') ||
      normalized.endsWith('~')
    ) {
      return;
    }

    // A scene edit can hot-swap; anything else needs a full reload.
    const isScene = normalized.endsWith('.json') && normalized.includes('scene');
    const event = isScene ? { type: 'scene', path: `/${normalized}` } : { type: 'reload', path: normalized };
    // A full reload always wins over a scene swap in the same burst.
    if (!pending || pending.type === 'scene') pending = event;

    clearTimeout(timer);
    timer = setTimeout(() => {
      onChange(pending);
      pending = null;
    }, 60);
  });

  return watcher;
}

async function openBrowser(url) {
  const { spawn } = await import('node:child_process');
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // No browser to open (a container, a CI box). The URL is printed anyway.
  }
}
