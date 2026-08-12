import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const sep = process.platform === "win32" ? ";" : ":";
process.env.Path = `${cargoBin}${sep}${process.env.Path ?? process.env.PATH ?? ""}`;
process.env.PATH = process.env.Path;

const child = spawn("npx", ["tauri", "dev"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
  cwd: path.resolve(import.meta.dirname, ".."),
});

child.on("exit", (code) => process.exit(code ?? 0));
