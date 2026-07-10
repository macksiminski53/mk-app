import fs from 'fs';

// console.log() to a piped, non-TTY stdout (exactly how Docker/Render/
// Railway capture container output) is ASYNCHRONOUS in Node on Linux -- if
// the process exits even a few milliseconds later, a pending console.log
// write can be silently dropped and never appear in the logs at all. Every
// local test of this file used a real file redirect, which is always
// synchronous, so that possibility never got ruled out. fs.writeSync writes
// directly to the fd and blocks until the OS confirms it's done, so nothing
// can be lost this way, no matter how fast the process dies afterward.
function log(msg) {
  fs.writeSync(1, `${msg}\n`);
}
function errlog(msg) {
  fs.writeSync(2, `${msg}\n`);
}

log(`[boot] entrypoint starting, node ${process.version}, pid ${process.pid}`);

// Diagnostic-only escape hatch: set MINIMAL_BOOT=1 in the Render dashboard
// to skip Socket.io/Turso/Stripe entirely and boot a bare Express server
// with just a health check. If THIS boots fine, the crash is caused by
// memory/resource pressure from the full dependency set and we can add
// pieces back one at a time. If even this dies silently, the problem isn't
// our code at all -- it's this specific Render service/instance.
if (process.env.MINIMAL_BOOT === '1') {
  log('[boot] MINIMAL_BOOT=1 -- starting bare Express server only.');
  // Heartbeat proves whether the process is alive at all in the seconds
  // before "Application exited early" shows up -- if even this never ticks,
  // the process is being killed (not crashing on its own), which points at
  // something external (OOM/resource limit) rather than our code.
  let tick = 0;
  setInterval(() => {
    tick += 1;
    log(`[boot] heartbeat #${tick} at ${new Date().toISOString()}, uptime ${process.uptime().toFixed(1)}s`);
  }, 500);
  const { default: express } = await import('express');
  const app = express();
  app.get('/api/health', (req, res) => res.json({ ok: true, minimal: true }));
  const PORT = process.env.PORT || 4000;
  // Explicitly bind 0.0.0.0 -- Node defaults to this when no host is given,
  // but making it explicit rules out any ambiguity about that default.
  app.listen(PORT, '0.0.0.0', () => log(`[boot] MINIMAL_BOOT server listening on 0.0.0.0:${PORT}`));
} else {

process.on('uncaughtException', (err) => {
  errlog(`[boot] uncaughtException: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  errlog(`[boot] unhandledRejection: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});

// index.js used to import everything statically, but ES module imports all
// resolve before any of the file's own code runs -- so if one of them ever
// hangs or gets killed, none of our logging/crash-handlers above get a
// chance to fire, which is exactly the silent-crash pattern we've been
// chasing. Dynamic imports run in program order instead, so this walks
// through each dependency one at a time with a log in between -- whichever
// step never prints its "OK" line is the one that's dying.
async function boot() {
  log('[boot] step 1/5: loading dotenv/config...');
  await import('dotenv/config');
  log('[boot] step 1/5 OK.');

  log('[boot] step 2/5: loading express...');
  await import('express');
  log('[boot] step 2/5 OK.');

  log('[boot] step 3/5: loading socket.io...');
  await import('socket.io');
  log('[boot] step 3/5 OK.');

  log('[boot] step 4/5: loading @libsql/client...');
  await import('@libsql/client');
  log('[boot] step 4/5 OK.');

  log('[boot] step 5/5: loading ./app.js (full server + routes)...');
  await import('./app.js');
  log('[boot] step 5/5 OK -- app.js is running.');
}

boot().catch((err) => {
  errlog(`[boot] boot() failed: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});

} // end of normal (non-MINIMAL_BOOT) boot path
