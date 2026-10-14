#!/usr/bin/env node
import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { packAddon, readArchive } from "./addons/archive.mjs";
import { readSourcePackage, readStarterIdentity, validateCompatibility } from "./addons/manifest.mjs";

function usage() {
  return `Usage:
  node scripts/addons.mjs pack <source-directory> <output.zip>
  node scripts/addons.mjs validate <archive-or-source>`;
}

function exactArgs(args, count, command) {
  if (args.length !== count) throw new Error(`${command} expects ${count} argument${count === 1 ? "" : "s"}`);
}

async function validate(input) {
  const path = resolve(input);
  const status = lstatSync(path);
  const value = status.isDirectory() ? readSourcePackage(path) : await readArchive(path);
  const starter = readStarterIdentity();
  validateCompatibility(value.manifest, starter);
  return value.manifest;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "pack") {
    exactArgs(args, 2, command);
    const result = await packAddon(args[0], args[1]);
    process.stdout.write(`Packed ${result.id}@${result.version} ${result.sha256}\n`);
    return;
  }
  if (command === "validate") {
    exactArgs(args, 1, command);
    const manifest = await validate(args[0]);
    process.stdout.write(`Valid ${manifest.id}@${manifest.version}\n`);
    return;
  }
  throw new Error(command ? `Unknown add-on command: ${command}\n${usage()}` : usage());
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
