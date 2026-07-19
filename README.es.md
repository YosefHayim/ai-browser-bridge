<p align="center">
  <img src="assets/hero.png" alt="chatgpt-local-bridge — controla una sesión de ChatGPT en el navegador desde tu terminal mediante un puente MCP aislado" width="640" />
</p>

# chatgpt-local-bridge

[English](README.md) · [עברית](README.he.md) · **Español** · [中文](README.zh.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-browser-2EAD33?logo=playwright&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-connector-000000)

---

> Controla una conversación real de ChatGPT en el navegador desde tu terminal y dale un conjunto reducido y aislado (sandbox) de herramientas locales del repositorio vía MCP — sin entregarle nunca una shell.

## Por qué existe

ChatGPT rinde mejor en el navegador: el estado real de la cuenta, el selector de modelos, la edición de mensajes, la regeneración y el historial de conversación se mantienen intactos. Programar rinde mejor en la terminal, donde archivos, pruebas, diffs y parches se inspeccionan y modifican directamente.

`chatgpt-local-bridge` conecta esas dos superficies. Un prompt en la terminal controla tu sesión existente de ChatGPT en el navegador, y ChatGPT puede acceder al repositorio actual mediante un pequeño conjunto de **herramientas MCP validadas** — `grep`, `read`, `apply_patch`, `run_tests`, `git_diff` — en lugar de acceso directo a la shell. Tú permaneces en un único flujo de terminal; ChatGPT conserva su interfaz real.

## Características

- **ChatGPT desde la terminal** — envía prompts y recibe respuestas sin salir de la shell; la conversación real del navegador es la fuente de verdad.
- **Herramientas locales en sandbox vía MCP** — cada operación de archivo se valida contra la raíz del repositorio seleccionado; sin shell arbitraria, solo comandos de prueba en lista blanca.
- **Acciones del navegador como comandos** — `/resume`, `/new`, `/model`, `/rewind`, `/stop`, `/context`, `/diff`, `/compact` y más.
- **Sesiones y transcripciones locales por repositorio** — cada ejecución se registra en `<repo>/.bridge/` y se exporta como Markdown, JSON o JSONL.
- **Controles de seguridad** — modos de permiso (`read-only` / `ask` / `auto`) y checkpoints automáticos de archivos alrededor de cada parche.
- **Convenciones del proyecto** — comandos personalizados además de `AGENTS.md` / `CLAUDE.md` se envían a ChatGPT en las ejecuciones de `/task`.
- **Un editor real** — historial de prompts, búsqueda inversa, cola de prompts y autocompletado de menciones `@file`.

## Arquitectura

```text
 terminal (you)
      │
      │  Ink / React CLI
      ▼
 orchestrator ──────────────┬───────────────────────────────┐
      │  browser automation │                   MCP server   │
      ▼  (Playwright + CDP) │                  (MCP SDK)      ▼
 ChatGPT browser UI         │                        local repo tools
      ▲                     │                     (grep/read/patch/test/diff)
      │                     ▼                                 │
      └───── Cloudflare Tunnel (cloudflared) ◄────────────────┘
              public https://…trycloudflare.com/mcp
```

Cuatro capas, cada una con un solo trabajo:

| Capa | Tecnología | Responsabilidad |
|------|------------|-----------------|
| **CLI** | Ink / React | Interfaz de terminal: panel de mensajes, barra de estado, menciones `@file`, comandos `/`. |
| **Navegador** | Playwright + Chrome DevTools Protocol | Controla la pestaña real de ChatGPT y captura respuestas. Los selectores están aislados en `src/browser/chatgpt-page.ts` para que los cambios de UI sean fáciles de arreglar. |
| **Servidor MCP** | MCP SDK + Effect Schema | Expone las herramientas locales del repositorio a ChatGPT como handlers validados por esquema y en sandbox. |
| **Túnel** | Cloudflare Tunnel (`cloudflared`) | Da al servidor MCP local una URL HTTPS pública temporal que el conector de ChatGPT puede alcanzar — sin despliegue. |

**¿Por qué un túnel?** El conector MCP de ChatGPT llama a las herramientas por HTTPS, pero el servidor de herramientas se ejecuta en tu máquina. En lugar de desplegar nada, el bridge levanta un túnel efímero de Cloudflare (`*.trycloudflare.com`) frente al puerto local y sincroniza esa URL `…/mcp` con la app de ChatGPT al iniciar. (ngrok resolvería el mismo problema de alcance; se usa `cloudflared` de Cloudflare porque sus túneles rápidos no requieren cuenta ni token.)

## Inicio rápido

**Requisitos previos**

- **macOS** — Chrome se inicia desde `/Applications/Google Chrome.app`, y los ayudantes de portapapeles/procesos usan `pbcopy`/`lsof`.
- **Node.js ≥ 20** y **pnpm** (el repo fija `pnpm@10.14.0`).
- **Google Chrome** — el bridge controla un perfil real de Chrome.
- **`cloudflared`** *(opcional)* — solo necesario para que ChatGPT llame a herramientas locales. Sin él la TUI igual funciona. Instala con `brew install cloudflared`.

**Instalar y construir**

```bash
git clone https://github.com/YosefHayim/chatgpt-local-bridge.git
cd chatgpt-local-bridge
pnpm install
pnpm build
```

**Inicia sesión una vez y luego ejecuta**

```bash
# Abre el perfil aislado de Chrome del bridge e inicia sesión en ChatGPT (persiste entre ejecuciones)
node dist/bridge.js login

# Lanza la interfaz de terminal sobre el repositorio donde ChatGPT trabajará
node dist/bridge.js --repo /path/to/your/project
```

¿Prefieres un comando `bridge` global? Ejecuta `pnpm link --global` tras construir, y usa `bridge`, `bridge login`, `bridge ask "…"`, etc.

## Dónde se guarda el estado

Todo el estado del bridge para un proyecto se escribe **dentro de ese proyecto**, bajo `<repo>/.bridge/`. En el primer uso, el bridge escribe `.bridge/.gitignore` con un único `*`. Eso hace que git ignore **todo** lo que hay en el directorio — incluidas las transcripciones y las cookies de inicio de sesión — de modo que nada pueda llegar a un commit, aunque viva dentro del repositorio. Tanto `git add -A` como `git add .bridge/` lo omiten; solo un `git add -f` explícito podría forzarlo. El archivo se reafirma en cada ejecución, así que borrarlo o manipularlo se cura automáticamente.

> La configuración escrita por el usuario y destinada a aplicarse a **todos** los repositorios sigue en tu directorio home: comandos personalizados en `~/.chatgpt-local-bridge/commands/*.md` y hooks de usuario en `~/.chatgpt-local-bridge/hooks.json`.

## Permisos y checkpoints

```bash
/permissions read-only   # grep_code, read_file, git_diff
/permissions auto        # también las herramientas de escritura/prueba acotadas
/permissions ask         # bloquea herramientas de escritura/prueba/proceso (confirmación interactiva pendiente)
```

`apply_patch` toma un snapshot de cada ruta tocada antes y después del cambio. Recupera con `/checkpoints`, `/restore <id>` o `/rewind --files <id>`.

## Pruebas

```bash
pnpm test          # vitest run
pnpm typecheck     # tsc --noEmit
pnpm verify:push   # typecheck + test + build (ejecutar antes de push)
```

La cobertura se centra en las rutas sensibles a la seguridad — validación de sandbox, resolución de rutas locales del repositorio, la auto-exclusión de `.bridge/`, los almacenes de sesiones/checkpoints, permisos y conteo de contexto.

## Soporte de Google Flow

El bridge también puede controlar **[Google Labs Flow](https://labs.google/fx/tools/flow)** — el estudio de vídeo con IA de Google impulsado por Veo — con el mismo patrón Playwright/CDP. Flow es distinto en esencia a los proveedores de chat: es una superficie de **generación**, así que una «respuesta» es un **clip** renderizado y los adjuntos son **ingredientes** (imágenes de referencia).

```bash
bridge chrome start --provider flow    # inicia sesión en Google; la cuenta necesita acceso a Flow (AI Pro/Ultra)
bridge ask --provider flow "a cat surfing a neon wave, cinematic, 8s"
bridge ask --provider flow "same scene, dawn light" --attach ref1.png ref2.png   # hasta 3 ingredientes
```

Más allá de generar, el bridge controla el **ciclo de vida de recursos** completo de Flow mediante los subcomandos `bridge flow` (cada uno se conecta a la pestaña de tu proyecto de Flow actual; añade `--json` para una salida legible por máquina):

```bash
bridge flow clips                        # lista los clips del proyecto actual (id + URL descargable)
bridge flow download                     # descarga el mp4 de cada clip en ./downloads/flow (o --id <clipId...>)
bridge flow reuse   --id <clipId>        # vuelve a añadir un clip al prompt como entrada ("Add to prompt")
bridge flow extend  --id <clipId>        # añade un clip a una escena ("Add to scene" de Flow)
bridge flow rename  --id <clipId> --name "hero shot"
bridge flow delete  --id <clipId> --yes  # mueve un clip a la Papelera de Flow (recuperable)
bridge flow ingredients                  # lista las imágenes de referencia adjuntas al prompt
bridge flow ingredient-remove --id <mediaId>   # desvincula un ingrediente
bridge flow ingredient-clear             # desvincula todos los ingredientes
bridge flow projects                     # lista los proyectos
bridge flow project-rename --name "Launch teaser"
bridge flow project-delete --yes         # elimina permanentemente el proyecto actual
```

Los verbos destructivos (`delete`, `project-delete`) requieren `--yes`; borrar un clip lo mueve a la Papelera recuperable de Flow.

Los agentes sin acceso a shell obtienen el mismo ciclo de vida como **herramientas MCP `flow_*`** vía `bridge serve` — `flow_list_clips`, `flow_download_clips`, `flow_reuse_clip`, `flow_extend_clip`, `flow_rename_clip`, `flow_delete_clip`, `flow_list_ingredients`, `flow_remove_ingredient`, `flow_clear_ingredients`, `flow_list_projects`, `flow_rename_project`, `flow_delete_project`. Las herramientas destructivas (`flow_delete_clip`, `flow_delete_project`) requieren `confirm: true`.

**Qué funciona en Flow**

- Prompts de tomas desde la terminal que disparan la generación de Veo
- **Ingredientes** — adjunta hasta tres imágenes de referencia a un prompt, y lista / quita / limpia las que ya están adjuntas
- Una **referencia de clip** capturada (el `src` del vídeo / el href de descarga) devuelta como respuesta, de modo que un agente obtiene un puntero al resultado
- **CRUD de recursos** — lista / descarga / renombra / elimina clips, extiende o reutiliza un clip, gestiona los ingredientes del prompt, y lista / renombra / elimina proyectos — como comandos CLI `bridge flow …` **y** herramientas MCP `flow_*` vía `bridge serve`
- Reutiliza el mismo modelo de perfil compartido del bridge / puerto de depuración que todos los proveedores

**Qué no funciona en Flow (hoy)**

- **Conector MCP**, **`/task`**, **`/connector`**, **`/mcp`** — Flow no tiene interfaz de conector, así que el servidor MCP y el túnel de Cloudflare se omiten (igual que Gemini).
- **Controles de parada / a mitad de render** — cancelar un render de Veo en curso todavía no está implementado.

Flow requiere un plan **Google AI Pro/Ultra**. Como los renders de Veo tardan minutos, `--provider flow` espera una respuesta mucho más tiempo que los proveedores de chat.

**Mantenimiento de selectores:** los selectores de Flow fueron **verificados en vivo (LIVE-VERIFIED)** contra un editor de proyecto con sesión iniciada. Si Google cambia la UI, vuelve a capturarlos con `node src/scripts/maintain/captureProviderSelectors.mjs`, luego actualiza [`src/config/index.ts`](src/config/index.ts); la generación vive en [`src/features/providers/flow/flowPage.ts`](src/features/providers/flow/flowPage.ts) y el CRUD de recursos en [`src/features/providers/flow/flowAssets.ts`](src/features/providers/flow/flowAssets.ts).

## Limitaciones

- **Solo macOS** por ahora (ruta de Chrome fija y ayudantes `pbcopy`/`lsof`).
- Los selectores del navegador de ChatGPT pueden romperse cuando cambia la UI web; los arreglos están localizados en la capa del navegador.
- El uso de contexto es una **estimación** — el navegador no expone el conteo exacto de tokens del servidor.
- El túnel de Cloudflare requiere `cloudflared` instalado.
- Local-first por diseño; no es un servicio multiusuario alojado.
- La ejecución de comandos de hooks se analiza y reporta pero aún no se ejecuta.

## Licencia

[MIT](LICENSE) © YosefHayim
