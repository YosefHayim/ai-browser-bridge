<p align="center">
  <img src="assets/hero.png" alt="ai-browser-bridge — drive ChatGPT, Gemini, Claude, DeepSeek, Grok, Perplexity, and Flow from your terminal through Chrome" width="640" />
</p>

# ai-browser-bridge

[English](README.md) · **עברית** · [Español](README.es.md) · [中文](README.zh.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-browser-2EAD33?logo=playwright&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-connector-000000)

<div dir="rtl">

> הפעילו שיחות ChatGPT או Gemini אמיתיות מהדפדפן ישירות מהטרמינל, ותנו ל-ChatGPT גישה מצומצמת ומבוקרת לכלי הריפו המקומי דרך MCP — בלי למסור לו גישת shell.

## למה זה קיים

‏ChatGPT נמצא בשיאו בדפדפן — מצב החשבון האמיתי, בורר המודלים, עריכת הודעות, רגנרציה והיסטוריית השיחה נשמרים במלואם. פיתוח קוד נמצא בשיאו בטרמינל, שם בודקים ומשנים קבצים, טסטים, diffs ו-patches ישירות.

‏`ai-browser-bridge` מחבר בין שני המשטחים האלה. שורת פקודה בטרמינל מפעילה את שיחת הספק הקיימת בדפדפן, ו-ChatGPT יכול לגשת לריפו הנוכחי דרך מספר מצומצם של **כלי MCP מאומתים** — `grep`, `read`, `apply_patch`, `run_tests`, `git_diff` — במקום גישת shell חופשית. אתם נשארים בתהליך עבודה אחד בטרמינל; לספק נשאר ה-UI האמיתי שלו.

## יכולות

- **תשעה ספקים, פקודה אחת** — ChatGPT, Gemini, Claude, DeepSeek, Grok, Perplexity, Duck.ai, Arena ו-Google Flow. בוחרים ספק עם `--provider` או שולחים לכמה ספקים במקביל.
- **בנוי לסוכנים** — ‏`bridge ask … --json` מספק ממשק לא-אינטראקטיבי יציב, ו-`bridge serve` חושף כלי MCP יוצאים.
- **כלים מקומיים ב-sandbox דרך MCP** — כל פעולת קובץ מאומתת מול שורש הריפו הנבחר; אין shell חופשי, רק פקודות טסט מאושרות מראש.
- **פעולות דפדפן כפקודות** — ‏`/resume`, `/new`, `/model`, `/rewind`, `/stop`, `/context`, `/diff`, `/compact` ועוד.
- **סשנים, תמלולים והורדות בשורש הריפו** — הרצות מתמשכות משתמשות תמיד ב-`<repo>/.bridge/`, גם כשהן מופעלות מתיקיית משנה.
- **בקרות בטיחות** — מצבי הרשאה (`read-only` / `ask` / `auto`) ו-checkpoints אוטומטיים של קבצים סביב כל patch.
- **מוסכמות פרויקט** — פקודות מותאמות אישית וגם `AGENTS.md` / `CLAUDE.md` מוזנים ל-ChatGPT בהרצות `/task`.
- **קומפוזר אמיתי** — היסטוריית פרומפטים, חיפוש לאחור, תור פרומפטים, והשלמה אוטומטית לאזכורי `@file`.

## ארכיטקטורה

</div>

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

<div dir="rtl">

ארבע שכבות, לכל אחת תפקיד אחד:

| שכבה | טכנולוגיה | אחריות |
|------|-----------|--------|
| **CLI** | Ink / React | ממשק טרמינל: חלונית הודעות, שורת סטטוס, אזכורי `@file`, פקודות `/`. |
| **דפדפן** | Playwright + Chrome DevTools Protocol | מתחבר ל-Chrome דרך פורט הדיבוג ומשתמש בפרופיל bridge משותף יחיד. מתאמי הספקים נמצאים ב-`src/features/providers/`. |
| **שרת MCP** | MCP SDK + Effect Schema | חושף כלים מקומיים מאומתים ומוגני-sandbox ל-ChatGPT, Claude ו-Grok. |
| **מנהרה** | Cloudflare Tunnel (`cloudflared`) | מעניק לשרת ה-MCP המקומי כתובת HTTPS ציבורית זמנית שה-connector של ChatGPT יכול להגיע אליה — ללא פריסה. |

**למה בכלל מנהרה?** ה-connector של ChatGPT קורא לכלים דרך HTTPS, אבל שרת הכלים רץ על המחשב שלכם. במקום לפרוס משהו, ה-bridge מקים מנהרת Cloudflare זמנית (`*.trycloudflare.com`) מול הפורט המקומי ומסנכרן את כתובת ה-`…/mcp` הזו אל אפליקציית ChatGPT בעת ההפעלה. (‏ngrok היה פותר את אותה בעיית נגישות; נבחר `cloudflared` של Cloudflare מכיוון שמנהרות ה-quick שלו אינן דורשות חשבון או טוקן.)

## התחלה מהירה

**דרישות מקדימות**

- **macOS** — ‏Chrome מופעל מ-`/Applications/Google Chrome.app`, ועוזרי הלוח/תהליכים משתמשים ב-`pbcopy`/`lsof`.
- **Node.js ≥ 22** ו-**pnpm** (הריפו מקבע `pnpm@10.14.0`).
- **Google Chrome או Chrome for Testing** — ה-bridge משתמש בפרופיל גלובלי משותף ב-`~/.ai-browser-bridge/chrome-profile`.
- **`cloudflared`** *(אופציונלי)* — נדרש כדי ש-ChatGPT, Claude או Grok יקראו לכלים מקומיים. בלעדיו ה-TUI עדיין רץ. התקנה: `brew install cloudflared`.

**התקנה ובנייה**

</div>

```bash
git clone https://github.com/YosefHayim/ai-browser-bridge.git
cd ai-browser-bridge
pnpm install
pnpm build
```

<div dir="rtl">

**הפעילו את Chrome פעם אחת, ואז הריצו**

</div>

```bash
# פתיחת פרופיל ה-Chrome המשותף של ה-bridge; התחברו אם צריך
node dist/bridge.js chrome start

# הפעלת ממשק הטרמינל מול הריפו שבו ChatGPT יעבוד
node dist/bridge.js --repo /path/to/your/project
```

<div dir="rtl">

מעדיפים פקודת `bridge` גלובלית? הריצו `pnpm link --global` אחרי הבנייה, ואז השתמשו ב-`bridge`, `bridge chrome start`, `bridge ask "…"` וכו'.

## סוכנים וספקים

‏`bridge ask` יכול לפנות לספק יחיד או לשלוח את אותה שאלה לכמה ספקים. התשובות מוחזרות לפי ספק, וכשל חלקי אינו מוחק תוצאות תקינות.

</div>

```bash
bridge ask --provider claude --json "summarize this repo"
bridge ask --provider claude,deepseek,grok --json "compare these approaches"
bridge serve
```

<div dir="rtl">

‏`bridge serve` חושף את `ask` ואת `search_conversations` דרך MCP stdio. ‏ChatGPT, Claude ו-Grok יכולים להשתמש ב-connector נכנס; Gemini, DeepSeek, Perplexity, Duck.ai ו-Arena פועלים כשיחות web, ו-Flow פועל כממשק יצירת וידאו.

## איפה נשמר המצב (state)

כל מצב ה-bridge של פרויקט נכתב תחת `<repo>/.bridge/` בשורש הקנוני של עץ העבודה של Git. גם הפעלה מתיקיית משנה משתמשת באותו שורש יחיד; תיקייה מפורשת שאינה חלק מ-Git נשארת השורש של עצמה. ה-bridge אינו יוצר או מנהל `.bridge/.gitignore`; מדיניות ההתעלמות שייכת לריפו היעד.

> תצורה שנכתבת על ידי המשתמש ומיועדת לחול על **כל** הריפואים נשמרת בתיקיית הבית: פקודות מותאמות ב-`~/.ai-browser-bridge/commands/*.md` ו-hooks ברמת המשתמש ב-`~/.ai-browser-bridge/hooks.json`.

## הרשאות ו-checkpoints

</div>

```bash
/permissions read-only   # grep_code, read_file, git_diff
/permissions auto        # גם כלי הכתיבה/טסט המצומצמים
/permissions ask         # חוסם כלי כתיבה/טסט/תהליך (אישור אינטראקטיבי בהמשך)
```

<div dir="rtl">

‏`apply_patch` שומר snapshot של כל נתיב שנגעו בו לפני ואחרי השינוי. שחזור עם `/checkpoints`, `/restore <id>` או `/rewind --files <id>`.

## בדיקות

</div>

```bash
pnpm test          # vitest run
pnpm typecheck     # tsc --noEmit
pnpm verify:push   # Biome + typecheck + tests + build + בדיקות מבנה
```

<div dir="rtl">

הכיסוי מתמקד בנתיבים רגישי-בטיחות — אימות sandbox, זיהוי השורש הקנוני של הריפו, מאגרי הסשנים/checkpoints, הרשאות וספירת הקשר.

## תמיכה ב-Google Flow

ה-bridge יכול להפעיל גם את **[Google Labs Flow](https://labs.google/fx/tools/flow)** — סטודיו הווידאו מבוסס-Veo של Google — עם אותה תבנית Playwright/CDP. ‏Flow שונה במהותו מספקי הצ'אט: זהו משטח **יצירה (generation)**, כך ש"תשובה" היא **קליפ** מרונדר וקבצים מצורפים הם **מרכיבים (ingredients)** (תמונות ייחוס).

</div>

```bash
bridge chrome start --provider flow    # התחברו ל-Google; החשבון צריך גישה ל-Flow (AI Pro/Ultra)
bridge ask --provider flow "a cat surfing a neon wave, cinematic, 8s"
bridge ask --provider flow "same scene, dawn light" --attach ref1.png ref2.png   # עד 3 מרכיבים
```

<div dir="rtl">

מעבר ליצירה, ה-bridge מפעיל את **מחזור החיים המלא של הנכסים (assets)** ב-Flow דרך תת-פקודות `bridge flow` (כל אחת מתחברת ללשונית פרויקט ה-Flow הנוכחית שלכם; הוסיפו `--json` לפלט קריא למכונה):

</div>

```bash
bridge flow clips                        # הצגת הקליפים בפרויקט הנוכחי (id + כתובת ניתנת-להורדה)
bridge flow download                     # הורדת הקליפים אל <repo>/.bridge/downloads/flow
bridge flow reuse   --id <clipId>        # הוספת קליפ בחזרה לפרומפט כקלט ("Add to prompt")
bridge flow extend  --id <clipId>        # הוספת קליפ לסצנה ("Add to scene" של Flow)
bridge flow rename  --id <clipId> --name "hero shot"
bridge flow delete  --id <clipId> --yes  # העברת קליפ לאשפת Flow (ניתן לשחזור)
bridge flow ingredients                  # הצגת תמונות הייחוס המצורפות לפרומפט
bridge flow ingredient-remove --id <mediaId>   # ניתוק מרכיב יחיד
bridge flow ingredient-clear             # ניתוק כל המרכיבים
bridge flow projects                     # הצגת הפרויקטים
bridge flow project-rename --name "Launch teaser"
bridge flow project-delete --yes         # מחיקה לצמיתות של הפרויקט הנוכחי
```

<div dir="rtl">

פעלים הרסניים (`delete`, `project-delete`) דורשים `--yes`; מחיקת קליפ מעבירה אותו לאשפה הניתנת-לשחזור של Flow.

סוכנים ללא גישת shell מקבלים את אותו מחזור חיים בתור **כלי MCP מסוג `flow_*`** דרך `bridge serve` — ‏`flow_list_clips`, `flow_download_clips`, `flow_reuse_clip`, `flow_extend_clip`, `flow_rename_clip`, `flow_delete_clip`, `flow_list_ingredients`, `flow_remove_ingredient`, `flow_clear_ingredients`, `flow_list_projects`, `flow_rename_project`, `flow_delete_project`. כלים הרסניים (`flow_delete_clip`, `flow_delete_project`) דורשים `confirm: true`.

**מה עובד ב-Flow**

- פרומפטים לצילומי שוט מהטרמינל שמפעילים יצירת Veo
- **מרכיבים (ingredients)** — צירוף של עד שלוש תמונות ייחוס לפרומפט, והצגה / הסרה / ניקוי של אלה שכבר מצורפות
- **הפניה לקליפ** שנלכדה (ה-`src` של הווידאו / קישור ההורדה) מוחזרת כתשובה, כך שהסוכן מקבל מצביע לתוצאה
- **CRUD של נכסים** — הצגה / הורדה / שינוי שם / מחיקה של קליפים, הרחבה או שימוש חוזר בקליפ, ניהול מרכיבי הפרומפט, והצגה / שינוי שם / מחיקה של פרויקטים — כפקודות CLI מסוג `bridge flow …` **וגם** ככלי MCP מסוג `flow_*` דרך `bridge serve`
- משתמש שוב באותו מודל של פרופיל bridge משותף / פורט דיבוג כמו כל ספק

**מה לא עובד ב-Flow (כרגע)**

- **connector של MCP**, **`/task`**, **`/connector`**, **`/mcp`** — ל-Flow אין ממשק connector, ולכן שרת ה-MCP ומנהרת ה-Cloudflare מדולגים (בדיוק כמו ב-Gemini).
- **בקרות עצירה / באמצע-רינדור** — ביטול רינדור של Veo תוך כדי ריצה עדיין לא מחובר.

‏Flow דורש תוכנית **Google AI Pro/Ultra**. מכיוון שרינדור ב-Veo אורך דקות, `--provider flow` ממתין לתשובה הרבה יותר זמן מספקי הצ'אט.

**תחזוקת סלקטורים:** הסלקטורים של Flow **אומתו בזמן אמת (LIVE-VERIFIED)** מול עורך פרויקט מחובר. אם Google משנה את ה-UI, בצעו לכידה מחדש עם `node src/scripts/maintain/captureProviderSelectors.mjs`, ואז עדכנו את [`src/config/index.ts`](src/config/index.ts); היצירה נמצאת ב-[`src/features/providers/flow/flowPage.ts`](src/features/providers/flow/flowPage.ts) וה-CRUD של הנכסים ב-[`src/features/providers/flow/flowAssets.ts`](src/features/providers/flow/flowAssets.ts).

## מגבלות

- **macOS בלבד** כיום (נתיב Chrome קשיח ועוזרי `pbcopy`/`lsof`).
- סלקטורים של ספקים עלולים להישבר כשממשקי הווב משתנים; התיקונים ממוקדים במתאמים שלהם.
- ניצול ההקשר הוא **הערכה** — הדפדפן אינו חושף ספירת טוקנים מדויקת מצד השרת.
- מנהרת Cloudflare דורשת `cloudflared` מותקן.
- מקומי-תחילה מעיצובו; אינו שירות רב-משתמשים מאוחסן.
- הרצת פקודות hook מנותחת ומדווחת אך עדיין אינה מבוצעת.

## רישיון

[MIT](LICENSE) © YosefHayim

</div>
