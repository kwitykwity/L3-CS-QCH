'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PRODUCTION_REQUIRED, PLACEHOLDER_MARKER } = require('../src/config/schema');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Values that may appear on an ACTIVE (uncommented) line of .env.example.
const SAFE_ACTIVE_VALUES = {
  APP_ENV: ['development'],
  PORT: ['3000'],
};

test('.gitignore excludes .env and QCH internal data', () => {
  const lines = read('.gitignore').split(/\r?\n/).map((l) => l.trim());
  for (const entry of ['.env', 'node_modules/', 'data/private/', 'Program_Directory*.pdf']) {
    assert.ok(lines.includes(entry), `.gitignore is missing "${entry}"`);
  }
});

test('.env.example has only safe active values', () => {
  const active = read('.env.example')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  for (const line of active) {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    assert.ok(key in SAFE_ACTIVE_VALUES, `.env.example has unexpected active variable ${key}`);
    assert.ok(
      SAFE_ACTIVE_VALUES[key].includes(value),
      `.env.example has an unexpected value for ${key}`
    );
  }
});

test('.env.example documents every production variable as a commented placeholder', () => {
  const text = read('.env.example');
  for (const name of PRODUCTION_REQUIRED) {
    assert.ok(
      text.includes(`# ${name}=${PLACEHOLDER_MARKER}`),
      `.env.example is missing the commented placeholder for ${name}`
    );
  }
});

test('.gitignore covers .env variants but keeps .env.example tracked', () => {
  const lines = read('.gitignore').split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('.env.*'), '.gitignore should ignore variants such as .env.production');
  assert.ok(lines.includes('!.env.example'), '.gitignore must re-include .env.example');
});
