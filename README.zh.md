<p align="center">
  <img src="assets/hero.png" alt="chatgpt-local-bridge — 从终端驱动浏览器中的真实 ChatGPT 会话，通过隔离的 MCP 桥接访问本地仓库工具" width="640" />
</p>

# chatgpt-local-bridge

[English](README.md) · [עברית](README.he.md) · [Español](README.es.md) · **中文**

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-browser-2EAD33?logo=playwright&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-connector-000000)

---

> 从终端驱动真实的 ChatGPT 浏览器会话，并通过 MCP 给它一组受限、沙箱化的本地仓库工具——永远不交给它一个 shell。

## 为什么需要它

ChatGPT 在浏览器中表现最佳——真实的账户状态、模型选择器、消息编辑、重新生成以及会话历史都完整保留。而写代码在终端中最高效，可以直接检查和修改文件、测试、diff 与补丁。

`chatgpt-local-bridge` 把这两个界面连接起来。终端中的一个提示词驱动你现有的 ChatGPT 浏览器会话，而 ChatGPT 可以通过一小组**经过校验的 MCP 工具**——`grep`、`read`、`apply_patch`、`run_tests`、`git_diff`——访问当前仓库，而不是获得原始 shell 访问权限。你始终停留在单一的终端工作流中；ChatGPT 保留它真实的界面。

## 功能

- **终端驱动 ChatGPT** — 在 shell 内发送提示词并接收回复；真实的浏览器会话才是事实来源。
- **通过 MCP 的沙箱化本地工具** — 每个文件操作都针对所选仓库根目录进行校验；没有任意 shell，仅允许白名单内的测试命令。
- **浏览器操作即命令** — `/resume`、`/new`、`/model`、`/rewind`、`/stop`、`/context`、`/diff`、`/compact` 等。
- **仓库本地的会话与记录** — 每次运行都记录在 `<repo>/.bridge/` 下，可导出为 Markdown、JSON 或 JSONL。
- **安全控制** — 权限模式（`read-only` / `ask` / `auto`）以及每次补丁前后的自动文件检查点。
- **项目约定** — 自定义命令以及 `AGENTS.md` / `CLAUDE.md` 会在 `/task` 运行时提供给 ChatGPT。
- **真正的输入器** — 提示词历史、反向搜索、提示词排队，以及 `@file` 提及的自动补全。

## 架构

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

四个层，各司其职：

| 层 | 技术 | 职责 |
|----|------|------|
| **CLI** | Ink / React | 终端界面：消息面板、状态栏、`@file` 提及、`/` 命令。 |
| **浏览器** | Playwright + Chrome DevTools Protocol | 驱动真实的 ChatGPT 标签页并捕获响应。选择器隔离在 `src/browser/chatgpt-page.ts`，便于在 UI 变动时修复。 |
| **MCP 服务器** | MCP SDK + Zod | 将本地仓库工具以经过 schema 校验且沙箱化的处理器形式暴露给 ChatGPT。 |
| **隧道** | Cloudflare Tunnel (`cloudflared`) | 为本地 MCP 服务器提供一个临时的公共 HTTPS 地址，供 ChatGPT 连接器访问——无需部署。 |

**为什么需要隧道？** ChatGPT 的 MCP 连接器通过 HTTPS 调用工具，但工具服务器运行在你的机器上。与其部署任何东西，bridge 在本地端口前面启动一个临时的 Cloudflare 隧道（`*.trycloudflare.com`），并在启动时把该 `…/mcp` 地址同步到 ChatGPT 应用中。（ngrok 也能解决同样的可达性问题；这里使用 Cloudflare 的 `cloudflared`，因为它的快速隧道无需账户或令牌。）

## 快速开始

**前置条件**

- **macOS** — Chrome 从 `/Applications/Google Chrome.app` 启动，剪贴板/进程辅助使用 `pbcopy`/`lsof`。
- **Node.js ≥ 20** 与 **pnpm**（仓库锁定 `pnpm@10.14.0`）。
- **Google Chrome** — bridge 驱动一个真实的 Chrome 配置文件。
- **`cloudflared`** *（可选）* — 仅当需要 ChatGPT 调用本地工具时才需要。没有它 TUI 仍可运行。安装：`brew install cloudflared`。

**安装与构建**

```bash
git clone https://github.com/YosefHayim/chatgpt-local-bridge.git
cd chatgpt-local-bridge
pnpm install
pnpm build
```

**登录一次，然后运行**

```bash
# 打开 bridge 的隔离 Chrome 配置文件并登录 ChatGPT（在多次运行间保持登录）
node dist/bridge.js login

# 针对你希望 ChatGPT 操作的仓库启动终端界面
node dist/bridge.js --repo /path/to/your/project
```

想要一个全局 `bridge` 命令？构建后运行 `pnpm link --global`，然后使用 `bridge`、`bridge login`、`bridge ask "…"` 等。

## 状态保存在哪里

某个项目的所有 bridge 状态都写入**该项目内部**，位于 `<repo>/.bridge/` 下。首次使用时，bridge 会写入仅含一个 `*` 的 `.bridge/.gitignore`。这会让 git 忽略该目录中的**所有内容**——包括会话记录和登录 cookie——因此即使它位于仓库内部，也无法被提交。`git add -A` 和 `git add .bridge/` 都会跳过它；只有显式的 `git add -f` 才能覆盖。该文件在每次运行时都会重新写入，因此删除或篡改它都会自动恢复。

> 由用户编写、意在应用于**所有**仓库的配置仍保留在你的主目录中：自定义命令位于 `~/.chatgpt-local-bridge/commands/*.md`，用户级 hooks 位于 `~/.chatgpt-local-bridge/hooks.json`。

## 权限与检查点

```bash
/permissions read-only   # grep_code, read_file, git_diff
/permissions auto        # 以及受限的写入/测试工具
/permissions ask         # 阻止写入/测试/进程工具（交互式确认待实现）
```

`apply_patch` 会在变更前后对每个涉及的路径进行快照。使用 `/checkpoints`、`/restore <id>` 或 `/rewind --files <id>` 恢复。

## 测试

```bash
pnpm test          # vitest run
pnpm typecheck     # tsc --noEmit
pnpm verify:push   # typecheck + test + build（推送前运行）
```

覆盖率聚焦于安全敏感路径——沙箱校验、仓库本地路径解析、`.bridge/` 自忽略保护、会话/检查点存储、权限以及上下文计数。

## Google Flow 支持

bridge 也可以驱动 **[Google Labs Flow](https://labs.google/fx/tools/flow)**——Google 基于 Veo 的 AI 视频工作室——采用与聊天类提供商相同的 Playwright/CDP 模式。Flow 与聊天类提供商本质不同：它是一个**生成**界面，因此“回复”是一段渲染出的**片段（clip）**，而附件则是**素材（ingredients）**（参考图像）。

```bash
bridge chrome start --provider flow    # 登录 Google；账户需要 Flow 访问权限（AI Pro/Ultra）
bridge ask --provider flow "a cat surfing a neon wave, cinematic, 8s"
bridge ask --provider flow "same scene, dawn light" --attach ref1.png ref2.png   # 最多 3 个素材
```

除了生成之外，bridge 还通过 `bridge flow` 子命令驱动 Flow 完整的**素材生命周期**（每个子命令都会附着到你当前的 Flow 项目标签页；添加 `--json` 可获得机器可读的输出）：

```bash
bridge flow clips                        # 列出当前项目中的片段（id + 可获取的 URL）
bridge flow download                     # 将每个片段的 mp4 下载到 ./downloads/flow（或 --id <clipId...>）
bridge flow reuse   --id <clipId>        # 将片段作为输入重新加入提示词（"Add to prompt"）
bridge flow extend  --id <clipId>        # 将片段加入场景（Flow 的 "Add to scene"）
bridge flow rename  --id <clipId> --name "hero shot"
bridge flow delete  --id <clipId> --yes  # 将片段移入 Flow 回收站（可恢复）
bridge flow ingredients                  # 列出附加到提示词的参考图像
bridge flow ingredient-remove --id <mediaId>   # 移除单个素材
bridge flow ingredient-clear             # 移除全部素材
bridge flow projects                     # 列出项目
bridge flow project-rename --name "Launch teaser"
bridge flow project-delete --yes         # 永久删除当前项目
```

破坏性动词（`delete`、`project-delete`）需要 `--yes`；删除片段会将其移入 Flow 可恢复的回收站。

没有 shell 访问权限的智能体可以通过 `bridge serve` 以 **`flow_*` MCP 工具**的形式获得相同的生命周期——`flow_list_clips`、`flow_download_clips`、`flow_reuse_clip`、`flow_extend_clip`、`flow_rename_clip`、`flow_delete_clip`、`flow_list_ingredients`、`flow_remove_ingredient`、`flow_clear_ingredients`、`flow_list_projects`、`flow_rename_project`、`flow_delete_project`。破坏性工具（`flow_delete_clip`、`flow_delete_project`）需要 `confirm: true`。

**Flow 上可用的功能**

- 从终端驱动、触发 Veo 生成的镜头提示词
- **素材（ingredients）** — 为提示词附加最多三张参考图像，并列出 / 移除 / 清空已附加的素材
- 捕获到的**片段引用**（视频的 `src` / 下载 href）作为回复返回，因此智能体能获得指向结果的指针
- **素材 CRUD** — 列出 / 下载 / 重命名 / 删除片段，扩展或复用片段，管理提示词素材，以及列出 / 重命名 / 删除项目 — 既可作为 `bridge flow …` CLI 命令，**也可**作为通过 `bridge serve` 提供的 `flow_*` MCP 工具
- 复用与所有提供商相同的共享 bridge 配置文件 / 调试端口模型

**Flow 上尚不可用的功能（当前）**

- **MCP 连接器**、**`/task`**、**`/connector`**、**`/mcp`** — Flow 没有连接器界面，因此会跳过 MCP 服务器和 Cloudflare 隧道（与 Gemini 相同）。
- **停止 / 渲染中途控制** — 尚未接入对进行中的 Veo 渲染的取消功能。

Flow 需要 **Google AI Pro/Ultra** 套餐。由于 Veo 渲染需要数分钟，`--provider flow` 等待响应的时间远比聊天类提供商更长。

**选择器维护：** Flow 的选择器已针对已登录的项目编辑器**实时验证（LIVE-VERIFIED）**。如果 Google 更改了 UI，请使用 `node src/scripts/dev/captureProviderSelectors.mjs` 重新捕获，然后更新 [`src/config/providersConfig.ts`](src/config/providersConfig.ts)；生成逻辑位于 [`src/features/providers/flow/flowPage.ts`](src/features/providers/flow/flowPage.ts)，素材 CRUD 位于 [`src/features/providers/flow/flowAssets.ts`](src/features/providers/flow/flowAssets.ts)。

## 限制

- 目前**仅支持 macOS**（硬编码的 Chrome 路径以及 `pbcopy`/`lsof` 辅助）。
- 当网页 UI 变动时，ChatGPT 浏览器选择器可能失效；修复集中在浏览器层。
- 上下文用量是**估算值**——浏览器不暴露服务器端的精确 token 计数。
- Cloudflare 隧道需要已安装 `cloudflared`。
- 设计上以本地优先；并非托管的多用户服务。
- Hook 命令执行会被解析和报告，但尚未实际执行。

## 许可证

[MIT](LICENSE) © YosefHayim
