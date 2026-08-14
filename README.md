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

1. Abra o SQL Editor do projeto e rode **todas** as migrations de `supabase/migrations/`, **em ordem de nome de arquivo** (a data no começo do nome já é a ordem):
   - `20260326120000_init.sql` — tabelas base, RLS, bucket `avatars`
   - `20260326130000_group_admin_audit.sql` — admins, canais, auditoria
   - `20260326140000_friends.sql` — amigos + DM privado
   - `20260326150000_profile_customization.sql` — banner, cores, bucket `banners`
   - `20260326160000_server_features.sql` — figurinhas, canais privados
   - `20260326170000_notifications.sql` — não lidos e menções
   - `20260326180000_user_stickers.sql`
   - `20260326190000_security_lints.sql`
   - `20260326200000_message_actions.sql` — responder, fixar, encaminhar
   - `20260326210000_phase1_attachments_search.sql` — anexos + busca
   - `20260326220000_phase2_4_social.sql` — enquetes, identidade do grupo
   - `20260326230000_bugfixes_realtime_invite.sql`
   - `20260327000000_storage_profile_media.sql` — políticas de upload de avatar/banner
   - `20260327100000_storage_stickers.sql` — políticas de upload de figurinhas
   - `20260327110000_group_moderation.sql` — expulsar e banir membros

   Pular alguma quebra features silenciosamente — o erro `new row violates row-level security policy` ao salvar o perfil é sinal de que as políticas de storage não estão aplicadas.
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

1. Crie o repo e faça o push. Se o path **não** for `Gufelippe/molezinhaGit`, ajuste `plugins.updater.endpoints` no `tauri.conf.json`.
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
git tag v0.1.2
git push origin v0.1.2
```

3. O Action publica o instalador + `latest.json`.  
   No app instalado: **Configurações → Conta → Verificar atualização**.

Credenciais do client vêm de `apps/desktop/.env.production` (URL + publishable key).  
Opcional no GitHub Secrets (sobrescrevem o `.env.production` no CI):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_CALLS_URL` — use o WebSocket do IP público da Oracle (`ws://SEU_IP:3001/ws`)

> Se o app abrir só uma tela preta depois de atualizar, o build provavelmente saiu sem essas variáveis. Feche pelo tray, reinstale o `.exe` do release mais novo, ou rode um build local com `apps/desktop/.env`.

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

### Bot de música (yt-dlp + FFmpeg)

O bot toca áudio do YouTube na call como um peer separado (“Música”), sem mutar os mics.

Na VM, instale as ferramentas do sistema:

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y ffmpeg
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# Conferir
ffmpeg -version
yt-dlp --version
```

Quando o YouTube quebrar a extração, atualize o binário:

```bash
sudo yt-dlp -U
# ou baixe de novo o release latest como acima
```

**Limites do MVP**
- Só link de vídeo único (sem playlists/`list=`)
- 1 bot por canal de voz; fila máx. ~20
- Até ~2 canais tocando ao mesmo tempo (CPU na Oracle)
- Estado da fila só em memória (some se o process reiniciar)
- Qualquer um na call enfileira; skip/parar/remover: staff do grupo **ou** quem pediu aquela faixa
- Sem busca por nome / Spotify / lyrics

Smoke: entre na call → cole um link no painel **Música** (ou mande só o URL no chat e use **Tocar na call**) → o roster mostra “Música” e o áudio chega sem travar os mics.

### Checklist
- [ ] TCP 3001 + UDP/TCP 40000–40100 abertos no Security List **e** no firewall da VM
- [ ] `MEDIASOUP_ANNOUNCED_IP` = IP público (não 127.0.0.1)
- [ ] `ffmpeg` + `yt-dlp` no PATH da VM (bot de música)
- [ ] Dois amigos (só o app) entram no mesmo canal de voz
- [ ] Reiniciar a VM e o `pm2` sobe sozinho

## Funcionalidades MVP

- Login / cadastro livre (Supabase)
- Grupos, canais texto/voz, código de convite do grupo
- Chat realtime + DMs
- Calls voz/vídeo (mediasoup)
- Bot de música na call (YouTube via yt-dlp)
- Presença online / em call
- Tema claro / escuro / sistema
- Configurações estilo Discord (conta, perfil, aparência, voz, notificações)

## Segurança

- Secret key só no server
- Join de voz exige JWT válido + membership do grupo
- Calls no IP público: JWT vai em `ws://` (MVP); WSS/TLS é melhoria futura
- Mídia WebRTC continua com DTLS
