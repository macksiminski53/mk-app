#!/usr/bin/env node
// MK Music Reporter (Windows)
// Runs on your PC, reads what's currently playing via Windows' System Media
// Transport Controls (the same system that feeds the "now playing" widget in
// the volume flyout — Apple Music, Spotify, etc. all report to it), and pushes
// it to your MK account's status so friends see it in the app.

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PS_SCRIPT_PATH = path.join(__dirname, 'now-playing.ps1');

const CONFIG_PATH = path.join(os.homedir(), '.mk-music-reporter.json');
const POLL_INTERVAL_MS = 15_000;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

const KEY_ENTER = ['\n', '\r'];
const KEY_CTRL_C = '\x03';
const KEY_BACKSPACE = ['\x7f', '\b'];

async function askHidden(question) {
  // Simple hidden-input prompt for the password.
  process.stdout.write(question);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode?.(true);
    let value = '';
    const onData = (chunk) => {
      const char = chunk.toString('utf8');
      if (KEY_ENTER.includes(char)) {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (char === KEY_CTRL_C) {
        process.exit(1);
      } else if (KEY_BACKSPACE.includes(char)) {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function setup() {
  console.log('MK Music Reporter — first-time setup\n');
  const apiUrl = (await ask('MK backend URL (e.g. https://mk-app-dd6m.onrender.com): ')).trim().replace(/\/$/, '');
  const username = (await ask('MK username: ')).trim();
  const password = await askHidden('MK password: ');

  const res = await fetch(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`\nLogin failed: ${data.error || res.statusText}`);
    process.exit(1);
  }

  const config = { apiUrl, token: data.token, username };
  saveConfig(config);
  console.log(`\nSaved. You're logged in as ${username}. Starting the reporter…\n`);
  return config;
}

// Ask Windows (via PowerShell + the WinRT media-control API) what's currently playing.
// Returns { track, artist } or null if nothing is playing / nothing is registered.
async function getCurrentTrack() {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_SCRIPT_PATH}"`,
      { windowsHide: true }
    );
    const result = stdout.trim();
    if (result === 'NOT_RUNNING' || result === 'NOT_PLAYING' || !result) return null;
    const [track, artist] = result.split('||');
    return { track: track?.trim(), artist: (artist || '').trim() };
  } catch (err) {
    // PowerShell not available, script errored, or nothing playing.
    return null;
  }
}

async function reportStatus(config, statusText) {
  const res = await fetch(`${config.apiUrl}/api/auth/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    // source: 'music' is what tells the client this is a real detected
    // song (vs. a hand-typed status) -- only that source renders the
    // "Playing" card in the UI.
    body: JSON.stringify({ statusText, source: 'music' }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
}

async function main() {
  let config = loadConfig();
  if (!config || !config.apiUrl || !config.token) {
    config = await setup();
  }

  console.log(`Watching for now-playing media, reporting to ${config.apiUrl} as ${config.username}.`);
  console.log('Press Ctrl+C to stop.\n');

  let lastStatus; // undefined = unknown yet, null = cleared, string = set

  async function tick() {
    const current = await getCurrentTrack();
    const statusText = current ? `${current.track} - ${current.artist}` : null;

    if (statusText !== lastStatus) {
      try {
        await reportStatus(config, statusText);
        lastStatus = statusText;
        console.log(statusText ? `Now playing: ${statusText}` : 'Cleared status (nothing playing).');
      } catch (err) {
        console.error('Failed to update status:', err.message);
      }
    }
  }

  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
