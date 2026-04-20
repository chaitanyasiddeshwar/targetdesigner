#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');

const mode = String(process.argv[2] || 'all').toLowerCase();

const ROOT_DIR = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const STAGE_DIR = path.join(RELEASE_DIR, '.stage');
const CURVES_SOURCE_DIR = path.join(ROOT_DIR, 'src', 'target_curves');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');

function runCommand(command, args, cwd = ROOT_DIR) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function readPackageVersion() {
  const raw = await fsp.readFile(PACKAGE_JSON_PATH, 'utf8');
  const pkg = JSON.parse(raw);
  const version = String(pkg?.version || '').trim();
  if (!version) {
    throw new Error('package.json version is missing.');
  }
  return version;
}

function normalizeVersion(version) {
  const trimmed = String(version || '').trim().replace(/^v/i, '');
  const safe = trimmed.replace(/[^0-9A-Za-z._-]/g, '-');
  if (!safe) {
    throw new Error(`Invalid release version: ${version}`);
  }
  return safe;
}

function detectHostTarget() {
  const platformMap = {
    darwin: 'macos',
    linux: 'linux',
    win32: 'win',
  };

  const archMap = {
    arm64: 'arm64',
    x64: 'x64',
  };

  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];

  if (!platform || !arch) {
    console.error(`Unsupported host for pkg target mapping: ${process.platform}/${process.arch}`);
    process.exit(1);
  }

  return `node16-${platform}-${arch}`;
}

function targetsForMode(currentMode) {
  const host = detectHostTarget();
  const groups = {
    host: [host],
    mac: ['node16-macos-arm64', 'node16-macos-x64'],
    win: ['node16-win-x64'],
    linux: ['node16-linux-x64'],
    all: ['node16-macos-arm64', 'node16-macos-x64', 'node16-win-x64', 'node16-linux-x64'],
  };

  const targets = groups[currentMode];
  if (!targets) {
    console.error(`Unknown build mode "${currentMode}". Use one of: host, mac, win, linux, all.`);
    process.exit(1);
  }

  return targets;
}

async function cleanReleaseDir() {
  await fsp.rm(RELEASE_DIR, { recursive: true, force: true });
  await fsp.mkdir(STAGE_DIR, { recursive: true });
}

async function copyCurvesInto(dirPath) {
  await fsp.cp(CURVES_SOURCE_DIR, path.join(dirPath, 'target_curves'), { recursive: true });
}

async function createZipForBinary(binaryFileName, releaseVersion) {
  const packageName = path.parse(binaryFileName).name;
  const packageDir = path.join(STAGE_DIR, `${packageName}-bundle`);
  await fsp.mkdir(packageDir, { recursive: true });

  await fsp.copyFile(path.join(STAGE_DIR, binaryFileName), path.join(packageDir, binaryFileName));
  await copyCurvesInto(packageDir);

  const zipFileName = `${packageName}-v${releaseVersion}.zip`;
  const zipFilePath = path.join(RELEASE_DIR, zipFileName);
  runCommand('zip', ['-rq', zipFilePath, '.'], packageDir);

  await fsp.rm(packageDir, { recursive: true, force: true });
  return zipFileName;
}

async function packageToZip(targets, releaseVersion) {
  const targetArg = targets.join(',');
  runCommand('pkg', ['.', '--targets', targetArg, '--out-path', STAGE_DIR]);

  const entries = await fsp.readdir(STAGE_DIR, { withFileTypes: true });
  const binaries = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  if (binaries.length === 0) {
    console.error('No binaries were produced by pkg.');
    process.exit(1);
  }

  const outputZips = [];
  for (const binary of binaries) {
    const zipName = await createZipForBinary(binary, releaseVersion);
    outputZips.push(zipName);
  }

  await fsp.rm(STAGE_DIR, { recursive: true, force: true });
  return outputZips;
}

async function main() {
  const targets = targetsForMode(mode);
  const packageVersion = await readPackageVersion();
  const releaseVersion = normalizeVersion(process.env.TD_RELEASE_VERSION || packageVersion);

  runCommand(npmCommand(), ['exec', '--', 'vite', 'build']);
  await cleanReleaseDir();
  const zips = await packageToZip(targets, releaseVersion);

  console.log(`\nCreated zip artifacts for version ${releaseVersion}:`);
  zips.forEach((zipName) => {
    console.log(`- ${path.join('release', zipName)}`);
  });
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
