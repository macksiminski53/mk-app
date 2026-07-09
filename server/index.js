console.log(`[boot] entrypoint starting, node ${process.version}, pid ${process.pid}`);

// IMPORTANT: when stdout/stderr is piped (always true under Docker/Render),
// console.error() writes asynchronously -- calling process.exit() right after
// it can kill the process before that write ever flushes, which silently
// swallows the exact error message we need to see. process.stderr.write's
// callback only fires once the write has actually completed, so exiting from
// there guarantees the message makes it out first.
process.on('uncaughtException', (err) => {
  const msg = `[boot] uncaughtException: ${err && err.stack ? err.stack : err}\n`;
  process.stderr.write(msg, () => process.exit(1));
});
process.on('unhandledRejection', (err) => {
  const msg = `[boot] unhandledRejection: ${err && err.stack ? err.stack : err}\n`;
  process.stderr.write(msg, () => process.exit(1));
});

// index.js used to import everything statically, but ES module imports all
// resolve before any of the file's own code runs -- so if one of them ever
// hangs or gets killed, none of our logging/crash-handlers above get a
// chance to fire, which is exactly the silent-crash pattern we've been
// chasing on Render. Dynamic imports run in program order instead, so this
// walks through each dependency one at a time with a log in between --
// whichever step never prints its "OK" line is the one that's dying.
async function boot() {
  console.log('[boot] step 1/5: loading dotenv/config...');
  await import('dotenv/config');
  console.log('[boot] step 1/5 OK.');

  console.log('[boot] step 2/5: loading express...');
  await import('express');
  console.log('[boot] step 2/5 OK.');

  console.log('[boot] step 3/5: loading socket.io...');
  await import('socket.io');
  console.log('[boot] step 3/5 OK.');

  console.log('[boot] step 4/5: loading @libsql/client...');
  await import('@libsql/client');
  console.log('[boot] step 4/5 OK.');

  console.log('[boot] step 5/5: loading ./app.js (full server + routes)...');
  await import('./app.js');
  console.log('[boot] step 5/5 OK -- app.js is running.');
}

boot().catch((err) => {
  const msg = `[boot] boot() failed: ${err && err.stack ? err.stack : err}\n`;
  process.stderr.write(msg, () => process.exit(1));
});
