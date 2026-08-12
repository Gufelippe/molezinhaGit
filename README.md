# molezinha

App desktop leve (estilo Discord) para o seu círculo de amigos: grupos, chat, DMs, canais de voz/vídeo, modo claro/escuro e configurações.

- **Desktop:** Tauri 2 + React + TypeScript (UI neomórfica)
- **Chat/Auth:** Supabase (Postgres + Auth + Realtime + Storage)
- **Calls:** Fastify + mediasoup na Oracle Free Tier (IP público; amigo só precisa do app)

## Estrutura

```
apps/desktop/     # UI + Tauri
apps/server/      # sinalização + mediasoup SFU
packages/shared/  # tipos TS
supabase/         # migrations SQL + RLS
```

## 1. Supabase

1. Abra o SQL Editor do projeto e rode **nesta ordem**:
   - `supabase/migrations/20260326120000_init.sql`
   - `supabase/migrations/20260326130000_group_admin_audit.sql` (admins, canais, auditoria)
   - `supabase/migrations/20260326140000_friends.sql` (amigos + DM privado)
2. Em **Authentication → Providers → Email**:
   - Deixe **Allow new users to sign up** ligado (cadastro livre)
3. Confirme o bucket `avatars` (a migration cria)

## 2. Variáveis de ambiente

### Desktop — `apps/desktop/.env`

```
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_CALLS_URL=ws://127.0.0.1:3001/ws
```

Em produção (Oracle), use o **IP público** da VM:

```
VITE_CALLS_URL=ws://SEU_IP_PUBLICO:3001/ws
```

### Server — `apps/server/.env`

```
PORT=3001
HOST=0.0.0.0
SUPABASE_URL=...
SUPABASE_SECRET_KEY=sb_secret_...   # NUNCA no client
SUPABASE_JWKS_URL=https://.../auth/v1/.well-known/jwks.json
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1    # local; na Oracle use o IP público da VM
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=40100
```

Arquivos `.env` estão no `.gitignore`.

## 3. Rodar local

```bash
npm install
npm run dev:server
npm run dev:desktop
```

- UI: http://localhost:1420  
- Calls health: http://127.0.0.1:3001/health  

Para janela nativa (precisa Rust + WebView2):

```bash
npm run tauri:dev
```

Build Windows:

```bash
npm run tauri -w @molezinha/desktop -- build
```

## Atualizações automáticas (desktop)

O botão **Verificar atualização** usa o `tauri-plugin-updater` + GitHub Releases.

Já está pronto no repo:
- chave **pública** em `apps/desktop/src-tauri/tauri.conf.json`
- chave **privada** em `%USERPROFILE%\.tauri\molezinha.key` (fora do Git)
- workflow `.github/workflows/release.yml` (dispara em tags `v*`)

### Uma vez só (depois do primeiro push no GitHub)

1. Crie o repo e faça o push. Se o path **não** for `molezinha/molezinha`, ajuste `plugins.updater.endpoints` no `tauri.conf.json`.
2. Rode `npm run updater:secret` e cole o valor em  
   **GitHub → Settings → Secrets and variables → Actions → New repository secret**  
   com o nome `TAURI_SIGNING_PRIVATE_KEY`.
3. (Opcional) `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — só se a chave tiver senha. A gerada aqui não tem.

### Cada release

1. Suba a versão em:
   - `package.json`
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/src-tauri/Cargo.toml`
2. Commit, tag e push:

```bash
git tag v0.1.1
git push origin v0.1.1
```

3. O Action publica o instalador + `latest.json`.  
   No app instalado: **Configurações → Conta → Verificar atualização**.

> Se perder a chave privada, updates assinados param de funcionar — guarde um backup do arquivo `.key`.

## 4. Oracle Cloud Free Tier (IP público)

A VM Oracle fica 24/7. Amigos **não** precisam de VPN/Tailscale — só do executável do app apontando para o IP público.

### Criar a VM
1. [cloud.oracle.com](https://cloud.oracle.com) → Compute → Create Instance
2. Shape: **VM.Standard.A1.Flex** (ARM) ou **VM.Standard.E2.1.Micro** se ARM estiver sem capacidade
3. Image: Oracle Linux / Ubuntu 22.04/24.04
4. Salve a chave SSH e anote o **IP público**

### Firewall Oracle (obrigatório)
Na Security List / NSG da subnet, liberar ingress `0.0.0.0/0` (ou só IPs de vocês):
- TCP `3001` (signaling WebSocket)
- UDP `40000–40100` (mediasoup RTP)
- TCP `40000–40100` (fallback ICE TCP)

SSH `22` só do seu IP.

Na VM (firewalld / ufw), as mesmas portas:

```bash
# Oracle Linux (firewalld)
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --permanent --add-port=40000-40100/udp
sudo firewall-cmd --permanent --add-port=40000-40100/tcp
sudo firewall-cmd --reload
```

### Na VM (roteiro)
```bash
# Node 20 + build tools (ajuste apt/dnf conforme a distro)
# ...

# App
git clone <seu-repo> molezinha
cd molezinha
npm install
cd apps/server
cp .env.example .env
# edite MEDIASOUP_ANNOUNCED_IP = IP público; cole SUPABASE_SECRET_KEY
sudo npm i -g pm2
pm2 start npm --name molezinha-calls -- start
pm2 save
pm2 startup
```

No desktop / build do amigo:

```
VITE_CALLS_URL=ws://SEU_IP_PUBLICO:3001/ws
```

Smoke: `http://SEU_IP_PUBLICO:3001/health` → `ok` com `announcedIp` público.

### Checklist
- [ ] TCP 3001 + UDP/TCP 40000–40100 abertos no Security List **e** no firewall da VM
- [ ] `MEDIASOUP_ANNOUNCED_IP` = IP público (não 127.0.0.1)
- [ ] Dois amigos (só o app) entram no mesmo canal de voz
- [ ] Reiniciar a VM e o `pm2` sobe sozinho

## Funcionalidades MVP

- Login / cadastro livre (Supabase)
- Grupos, canais texto/voz, código de convite do grupo
- Chat realtime + DMs
- Calls voz/vídeo (mediasoup)
- Presença online / em call
- Tema claro / escuro / sistema
- Configurações estilo Discord (conta, perfil, aparência, voz, notificações)

## Segurança

- Secret key só no server
- Join de voz exige JWT válido + membership do grupo
- Calls no IP público: JWT vai em `ws://` (MVP); WSS/TLS é melhoria futura
- Mídia WebRTC continua com DTLS
