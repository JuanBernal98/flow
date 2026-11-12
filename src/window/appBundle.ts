/**
 * A minimal `Flow.app` around the Bun runtime, so the macOS Dock and app switcher show "Flow" with
 * its icon instead of "bun". macOS names a process after the bundle its executable sits in, so the
 * bundle holds a hard link to Bun (no copy, no extra disk) under the name `Flow`. It lives in the
 * user's Application Support and is rebuilt whenever Bun or the icon changes.
 */
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ICON_SOURCE = join(import.meta.dir, "..", "..", "assets", "flow.icns");

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Flow</string>
  <key>CFBundleDisplayName</key><string>Flow</string>
  <key>CFBundleIdentifier</key><string>dev.flow.window</string>
  <key>CFBundleExecutable</key><string>Flow</string>
  <key>CFBundleIconFile</key><string>flow.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;

/** True when `link` is the very same file as `target` (a hard link to it). */
function isSameFile(link: string, target: string) {
  if (!existsSync(link)) {
    return false;
  }
  const a = statSync(link);
  const b = statSync(target);
  return a.ino === b.ino && a.dev === b.dev;
}

/** Make sure the bundle is current and return the runtime to launch the window with. */
export function ensureFlowAppBundle(runtime = process.execPath) {
  const contents = join(
    homedir(),
    "Library",
    "Application Support",
    "flow",
    "Flow.app",
    "Contents",
  );
  const executable = join(contents, "MacOS", "Flow");
  const icon = join(contents, "Resources", "flow.icns");
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  mkdirSync(join(contents, "Resources"), { recursive: true });

  const plistPath = join(contents, "Info.plist");
  if (!existsSync(plistPath) || readFileSync(plistPath, "utf8") !== INFO_PLIST) {
    writeFileSync(plistPath, INFO_PLIST);
  }
  if (!existsSync(icon) || statSync(icon).size !== statSync(ICON_SOURCE).size) {
    copyFileSync(ICON_SOURCE, icon);
  }
  // After a Bun upgrade the old link still points at the old binary, so it is replaced.
  if (!isSameFile(executable, runtime)) {
    rmSync(executable, { force: true });
    try {
      linkSync(runtime, executable);
    } catch {
      // Another volume: a hard link is impossible, so fall back to Bun itself (named "bun").
      return runtime;
    }
  }
  return executable;
}
