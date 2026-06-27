# chatgpt-local-bridge

[English](README.md) · **עברית** · [Español](README.es.md) · [中文](README.zh.md)

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-browser-2EAD33?logo=playwright&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-connector-000000)

<div dir="rtl">

> הפעילו שיחת ChatGPT אמיתית מהדפדפן ישירות מהטרמינל, ותנו לה גישה מצומצמת ומבוקרת (sandbox) לכלי הריפו המקומי דרך MCP — בלי למסור לה אף פעם גישת shell.

## למה זה קיים

‏ChatGPT נמצא בשיאו בדפדפן — מצב החשבון האמיתי, בורר המודלים, עריכת הודעות, רגנרציה והיסטוריית השיחה נשמרים במלואם. פיתוח קוד נמצא בשיאו בטרמינל, שם בודקים ומשנים קבצים, טסטים, diffs ו-patches ישירות.

‏`chatgpt-local-bridge` מחבר בין שני המשטחים האלה. שורת פקודה בטרמינל מפעילה את שיחת ה-ChatGPT הקיימת שלכם בדפדפן, ו-ChatGPT יכול לגשת לריפו הנוכחי דרך מספר מצומצם של **כלי MCP מאומתים** — `grep`, `read`, `apply_patch`, `run_tests`, `git_diff` — במקום גישת shell חופשית. אתם נשארים בתהליך עבודה אחד בטרמינל; ל-ChatGPT נשאר ה-UI האמיתי שלו.

## יכולות

- **הפעלת ChatGPT מהטרמינל** — שולחים פרומפטים ומקבלים תשובות בלי לעזוב את ה-shell; שיחת הדפדפן האמיתית היא מקור האמת.
- **כלים מקומיים ב-sandbox דרך MCP** — כל פעולת קובץ מאומתת מול שורש הריפו הנבחר; אין shell חופשי, רק פקודות טסט מאושרות מראש.
- **פעולות דפדפן כפקודות** — ‏`/resume`, `/new`, `/model`, `/rewind`, `/stop`, `/context`, `/diff`, `/compact` ועוד.
- **סשנים ותמלולים מקומיים לריפו** — כל הרצה נשמרת תחת `<repo>/.bridge/` וניתנת לייצוא כ-Markdown, JSON או JSONL.
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
| **דפדפן** | Playwright + Chrome DevTools Protocol | מפעיל את לשונית ה-ChatGPT האמיתית ולוכד תשובות. הסלקטורים מבודדים ב-`src/browser/chatgpt-page.ts` כך ששינויי UI קלים לתיקון. |
| **שרת MCP** | MCP SDK + Zod | חושף את כלי הריפו המקומיים ל-ChatGPT כ-handlers מאומתי-סכמה ומוגני-sandbox. |
| **מנהרה** | Cloudflare Tunnel (`cloudflared`) | מעניק לשרת ה-MCP המקומי כתובת HTTPS ציבורית זמנית שה-connector של ChatGPT יכול להגיע אליה — ללא פריסה. |

**למה בכלל מנהרה?** ה-connector של ChatGPT קורא לכלים דרך HTTPS, אבל שרת הכלים רץ על המחשב שלכם. במקום לפרוס משהו, ה-bridge מקים מנהרת Cloudflare זמנית (`*.trycloudflare.com`) מול הפורט המקומי ומסנכרן את כתובת ה-`…/mcp` הזו אל אפליקציית ChatGPT בעת ההפעלה. (‏ngrok היה פותר את אותה בעיית נגישות; נבחר `cloudflared` של Cloudflare מכיוון שמנהרות ה-quick שלו אינן דורשות חשבון או טוקן.)

## התחלה מהירה

**דרישות מקדימות**

- **macOS** — ‏Chrome מופעל מ-`/Applications/Google Chrome.app`, ועוזרי הלוח/תהליכים משתמשים ב-`pbcopy`/`lsof`.
- **Node.js ≥ 20** ו-**pnpm** (הריפו מקבע `pnpm@10.14.0`).
- **Google Chrome** — ה-bridge מפעיל פרופיל Chrome אמיתי.
- **`cloudflared`** *(אופציונלי)* — נדרש רק כדי ש-ChatGPT יקרא לכלים מקומיים. בלעדיו ה-TUI עדיין רץ. התקנה: `brew install cloudflared`.

**התקנה ובנייה**

</div>

```bash
git clone https://github.com/YosefHayim/chatgpt-local-bridge.git
cd chatgpt-local-bridge
pnpm install
pnpm build
```

<div dir="rtl">

**התחברו פעם אחת, ואז הריצו**

</div>

```bash
# פתיחת פרופיל ה-Chrome המבודד של ה-bridge והתחברות ל-ChatGPT (נשמר בין הרצות)
node dist/bridge.js login

# הפעלת ממשק הטרמינל מול הריפו שבו ChatGPT יעבוד
node dist/bridge.js --repo /path/to/your/project
```

<div dir="rtl">

מעדיפים פקודת `bridge` גלובלית? הריצו `pnpm link --global` אחרי הבנייה, ואז השתמשו ב-`bridge`, `bridge login`, `bridge ask "…"` וכו'.

## איפה נשמר המצב (state)

כל מצב ה-bridge של פרויקט נכתב **בתוך אותו פרויקט**, תחת `<repo>/.bridge/`. בשימוש הראשון נכתב `.bridge/.gitignore` המכיל `*` בודד. זה גורם ל-git להתעלם מ**כל** מה שבתיקייה — כולל התמלולים ועוגיות ההתחברות — כך ששום דבר לא יכול להיכנס ל-commit, למרות שהוא נמצא בתוך הריפו. גם `git add -A` וגם `git add .bridge/` מדלגים עליו; רק `git add -f` מפורש יכול לעקוף. הקובץ נכתב מחדש בכל הרצה, כך שמחיקה או שינוי שלו מתרפאים אוטומטית.

> תצורה שנכתבת על ידי המשתמש ומיועדת לחול על **כל** הריפואים נשמרת עדיין בתיקיית הבית: פקודות מותאמות ב-`~/.chatgpt-local-bridge/commands/*.md` ו-hooks ברמת המשתמש ב-`~/.chatgpt-local-bridge/hooks.json`.

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
pnpm verify:push   # typecheck + test + build (להריץ לפני push)
```

<div dir="rtl">

הכיסוי מתמקד בנתיבים רגישי-בטיחות — אימות sandbox, רזולוציית נתיבים מקומיים לריפו, מנגנון ההתעלמות העצמית של `.bridge/`, מאגרי הסשנים/checkpoints, הרשאות וספירת הקשר.

## מגבלות

- **macOS בלבד** כיום (נתיב Chrome קשיח ועוזרי `pbcopy`/`lsof`).
- סלקטורים של ChatGPT עלולים להישבר כשממשק הווב משתנה; התיקונים ממוקדים בשכבת הדפדפן.
- ניצול ההקשר הוא **הערכה** — הדפדפן אינו חושף ספירת טוקנים מדויקת מצד השרת.
- מנהרת Cloudflare דורשת `cloudflared` מותקן.
- מקומי-תחילה מעיצובו; אינו שירות רב-משתמשים מאוחסן.
- הרצת פקודות hook מנותחת ומדווחת אך עדיין אינה מבוצעת.

## רישיון

[MIT](LICENSE) © YosefHayim

</div>
