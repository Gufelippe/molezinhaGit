/**
 * Prints the local Tauri updater private key so you can paste it into
 * GitHub → Settings → Secrets → Actions → TAURI_SIGNING_PRIVATE_KEY.
 *
 * Usage: node scripts/show-updater-secret.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const keyPath = path.join(os.homedir(), ".tauri", "molezinha.key");
const pubPath = `${keyPath}.pub`;

if (!fs.existsSync(keyPath)) {
  console.error(`Chave privada não encontrada em:\n  ${keyPath}`);
  console.error("Gere com:\n  npx @tauri-apps/cli signer generate -w %USERPROFILE%\\.tauri\\molezinha.key --ci");
  process.exit(1);
}

const privateKey = fs.readFileSync(keyPath, "utf8").trim();
const publicKey = fs.existsSync(pubPath) ? fs.readFileSync(pubPath, "utf8").trim() : "(sem .pub)";

console.log("=== GitHub Secret: TAURI_SIGNING_PRIVATE_KEY ===\n");
console.log(privateKey);
console.log("\n=== pubkey (já está no tauri.conf.json) ===\n");
console.log(publicKey);
console.log("\n=== próximos passos ===");
console.log("1. Crie o repo GitHub (ex: molezinha/molezinha) e faça o push.");
console.log("2. Em Settings → Secrets and variables → Actions, adicione:");
console.log("   - TAURI_SIGNING_PRIVATE_KEY  (cole o bloco acima)");
console.log("   - TAURI_SIGNING_PRIVATE_KEY_PASSWORD  (deixe vazio / omita — a chave atual não tem senha)");
console.log("3. Confirme que plugins.updater.endpoints no tauri.conf.json aponta para esse repo.");
console.log("4. Suba a versão, crie a tag e push:");
console.log("     git tag v0.1.1");
console.log("     git push origin v0.1.1");
console.log("5. O workflow Release publica o instalador + latest.json.");
