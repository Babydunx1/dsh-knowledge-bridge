# Install & Verify — dsh-knowledge-bridge (one page)

> **Audience: everyone.** This guide works for any machine, any profile, any user.
> You install it by **pasting one link**. No editing files, no `npm install`, no configuration.
> **Works with:** DeepSeek Harness (any profile: desktop / web / headless)
> **Requires:** nothing extra — the plugin uses Node.js built-ins only (zero dependencies)

---

## 1. Install (paste the link)

1. Open DeepSeek Harness → **Plugins** → **Add plugin**
2. Paste this address into **Package name or address**:

   ```
   https://github.com/Babydunx1/dsh-knowledge-bridge
   ```

3. Click **Install**
4. **Restart DeepSeek Harness** (a host restart is required to load a fresh JavaScript module generation)

**Which address to paste (all of these pass DSH's own check):**

| Paste this into the field | Kind |
|:--|:--|
| `https://github.com/Babydunx1/dsh-knowledge-bridge` | Git repository (recommended) |
| `github:Babydunx1/dsh-knowledge-bridge` | Git shorthand |
| `https://github.com/Babydunx1/dsh-knowledge-bridge#v1.0.0` | Git, pinned to a tag/branch/commit (`#main`, `#semver:^1.0.0` also work) |
| `https://github.com/Babydunx1/dsh-knowledge-bridge/archive/refs/heads/main.tar.gz` | Tarball (works even when Git is unavailable) |
| `git@github.com:Babydunx1/dsh-knowledge-bridge.git` | Git over SSH (scp-like) |

**❌ Common mistake:** a GitHub **page** URL with extra path segments — e.g. `.../dsh-knowledge-bridge/tree/main` — is refused with
*"a URL must point at a git repository or a tarball"*. DSH only accepts `host/owner/repo`, optionally ending in `.git` and/or `#ref`.

**About the dialog (so you don't get stuck):**

| Detail | What to know |
|:--|:--|
| What the field accepts | A package name (optionally with a version), **a Git address**, a tarball, or an absolute local path |
| ⚠️ The built-in example text | The dialog ships a *template* line for Git/local-path installs. It keeps warning until you replace it with the real address — do that, don't submit the template |
| **Registry** selector | Applies to *npm package* installs only. For a **Git address** leave it at **Default registry** |
| Trust warning | Plugins run with your permissions. Install only sources you trust |
| Auto-update | Installed plugins do **not** update automatically yet |

<details>
<summary><b>Alternative — manual profile bundle (only if the GUI path is unavailable)</b></summary>

```powershell
git clone https://github.com/Babydunx1/dsh-knowledge-bridge
```

Then in `~/.dsh/profiles/<profile>/package.json` add `"dsh-knowledge-bridge"` to `dsh.profile.bundles`
and `"dsh-knowledge-bridge": "link:/absolute/path/to/dsh-knowledge-bridge"` to `dependencies`,
run `pnpm install` in that profile folder, and restart DSH.
The package declares `dsh.bundle.patch`, so `cordis.patch.yml` is applied for you.

</details>

---

## 2. Verify (3 checks, ~1 minute)

| # | Check | Pass |
|:-:|:--|:--|
| 1 | **Plugins** list shows `dsh-knowledge-bridge` | Enabled / running — **not** `pending (waiting for service: …)` |
| 2 | Host log line `Initialized with N path(s)` | **N ≥ 1** (= how many vault roots were indexed). `0 path(s)` → the vault was not found, go to §3 |
| 3 | Start a session and ask the agent to list its knowledge | The 4 tools are available: `knowledge_list`, `knowledge_search`, `knowledge_read`, `knowledge_info` |

---

## 3. Vault discovery (zero-config, per machine)

The vault is found automatically. Resolution order (first match wins, all existing candidates are indexed):

1. `knowledgePaths` — explicit config, if you set it
2. `DSH_KNOWLEDGE_PATHS` — environment variable, `;` or `,` separated
3. Built-in candidates:

```
~/.gemini/antigravity-ide/knowledge
~/.antigravity-ide/knowledge
~/.dsh/knowledge
~/.codex/knowledge
./knowledge      ./docs/knowledge      ./.knowledge
```

Notes:
- **All** existing candidates are indexed (it does not stop at the first one); duplicate folders are skipped (case-insensitive on Windows).
- ⚠️ **Setting `knowledgePaths` in the config turns OFF the built-in candidates** (only config + env var are then used). If you want to *add* a vault and keep zero-config discovery, use the **environment variable** instead.
- Supported vault layouts: structured Antigravity-style (`<item>/metadata.json` + `artifacts/*.md`) and plain markdown trees (any folder of `.md` / `.txt`).

**Point at your own vault**

```powershell
# Windows (PowerShell)
$env:DSH_KNOWLEDGE_PATHS = "D:/team-docs/knowledge;~/my-vault"
```

```bash
# macOS / Linux
export DSH_KNOWLEDGE_PATHS="$HOME/my-vault:$HOME/team-docs"
```

---

## 4. Read this before reporting "it doesn't work"

1. **Vaults outside the candidate list are not auto-discovered.** If your knowledge lives in Cursor, Claude Code, VS Code, Windsurf, JetBrains IDEs, etc., set `DSH_KNOWLEDGE_PATHS` explicitly.
2. **Discovery is per machine, by design.** Each install indexes the vault that exists on that machine. Nothing is uploaded, and machine A's vault is not visible on machine B. This is intentional — do not expect sync.

---

## 5. Upgrade / uninstall / after editing

**There is no auto-update yet, and you do not need to learn a command — ask your agent:**

> “Update the `dsh-knowledge-bridge` plugin, then tell me what to restart.”

The plugin puts this profile's exact update command into the agent's prompt, and `knowledge_info`
returns the installed version, that command, whether the published version is newer, and the
restart requirement. When the host process cannot see the profile name (DSH exports `DSH_PROFILE`
to the shells it hands the agent, not to the host itself), the command is phrased as
`$env:DSH_PROFILE` on Windows or `"$DSH_PROFILE"` elsewhere, and `updateCommandHint` says so —
that form resolves inside the same shell the agent runs it in. The registry lookup, when the agent
asks for it, is the only network call the plugin ever makes — nothing is fetched at load, and an
unreadable registry reports `null` instead of guessing.

| Task | How |
|:--|:--|
| Ask the agent | Tell it to update `dsh-knowledge-bridge`; it reads the command from the prompt or `knowledge_info` |
| Upgrade by hand | `dsh plugin --profile <profile> update dsh-knowledge-bridge`, or uninstall → **Add plugin** again |
| Uninstall | Plugins → the plugin row → Uninstall |
| Edited the plugin's own source | Restart the DSH host. Toggling the plugin off/on does **not** re-import (cordis caches the plugin function, ESM caches the module) |

---

## 6. Quick troubleshooting

| Symptom | Cause / fix |
|:--|:--|
| `Initialized with 0 path(s)` | Vault not found → set `DSH_KNOWLEDGE_PATHS` (or `knowledgePaths`) and confirm the path is a real directory |
| Entry stays **pending** | A declared service does not exist yet — check the service name and that its provider plugin is enabled |
| `Error: cannot get property "X" without inject` | Every cordis service read must be listed in `export const inject`; reads happen inside `try` |
| Safety guard never blocks anything | The guard matches `exec.name` / `exec.arguments` (not `exec.tool` / `exec.args`) |
| Behaviour unchanged after an edit | Restart the host |

---

## 7. Safety guard (default on)

Destructive shell calls are denied before they reach the disk, matched against the command string of
`bash` / `pwsh` / `cmd` / `terminal` tool calls. Defaults:

```js
['git\\s+reset\\s+--hard', 'git\\s+clean\\s+-fd', 'git\\s+restore\\s+\\.', 'rm\\s+-rf\\s+/(?!tmp)']
```

Denials are **monotonic** — no other plugin can force-allow one. A denial surfaces as
`[BLOCKED BY DSH-KNOWLEDGE-BRIDGE SAFETY POLICY] …`.

---

# 🇹🇭 ภาษาไทย — ติดตั้งและตรวจสอบ (หน้าเดียว)

> **ใช้ได้กับทุกคน ทุกเครื่อง ทุกโปรไฟล์** — ติดตั้งด้วยการ **วางลิงก์บรรทัดเดียว** ไม่ต้องแก้ไฟล์ ไม่ต้อง `npm install` ไม่ต้องตั้งค่า

## 1. ติดตั้ง (วางลิงก์)

1. เปิด DeepSeek Harness → **Plugins** → **Add plugin**
2. วางที่ช่อง **Package name or address**:

   ```
   https://github.com/Babydunx1/dsh-knowledge-bridge
   ```

3. กด **Install**
4. **รีสตาร์ท DeepSeek Harness** (ต้องรีสตาร์ท host เพื่อโหลดโมดูลชุดใหม่)

**ลิงก์ที่ใช้ได้ (ผ่านตัวตรวจของ DSH ทั้งหมด)**

| วางแบบนี้ | ประเภท |
|:--|:--|
| `https://github.com/Babydunx1/dsh-knowledge-bridge` | Git repository (แนะนำ) |
| `github:Babydunx1/dsh-knowledge-bridge` | Git shorthand |
| `https://github.com/Babydunx1/dsh-knowledge-bridge#v1.0.0` | Git + ปัก tag/branch/commit (`#main`, `#semver:^1.0.0` ก็ได้) |
| `https://github.com/Babydunx1/dsh-knowledge-bridge/archive/refs/heads/main.tar.gz` | Tarball (ใช้ได้แม้เครื่องไม่มี Git) |
| `git@github.com:Babydunx1/dsh-knowledge-bridge.git` | Git ผ่าน SSH (scp-like) |

**❌ พลาดบ่อย:** ลิงก์หน้าเว็บ GitHub ที่มี path เกิน — เช่น `.../dsh-knowledge-bridge/tree/main` — จะถูกปฏิเสธด้วยข้อความ
*"a URL must point at a git repository or a tarball"* เพราะ DSH รับเฉพาะรูปแบบ `host/owner/repo` (จะเติม `.git` และ/หรือ `#ref` ต่อท้ายก็ได้)

**เรื่องที่ต้องรู้ในหน้าต่างนี้**

| รายละเอียด | สิ่งที่ควรรู้ |
|:--|:--|
| ช่องนี้รับอะไร | ชื่อแพ็กเกจ (มีเวอร์ชันได้) · **Git address** · ไฟล์ tarball · absolute path ในเครื่อง |
| ⚠️ ข้อความตัวอย่างในกล่อง | หน้าต่างมี *เทมเพลต* สำหรับ Git/local path อยู่ และจะเตือนไปเรื่อย ๆ จนกว่าจะ**แทนที่ด้วยที่อยู่จริง** — ห้ามส่งเทมเพลต |
| **Registry** | ใช้กับกรณีติดตั้งจาก **npm** เท่านั้น ถ้าวาง **Git address** ให้ปล่อยเป็น **Default registry** |
| Trust | ปลั๊กอินรันด้วยสิทธิ์ของคุณ ติดตั้งเฉพาะแหล่งที่เชื่อถือได้ |
| อัปเดตอัตโนมัติ | **ยังไม่มี** ต้องถอนแล้วติดตั้งใหม่ |

## 2. ตรวจหลังติดตั้ง (3 ข้อ ~1 นาที)

| # | ตรวจอะไร | ผ่านเมื่อ |
|:-:|:--|:--|
| 1 | รายการ **Plugins** มี `dsh-knowledge-bridge` | Enabled/running — **ไม่ใช่** `pending (waiting for service: …)` |
| 2 | log ของ host มีบรรทัด `Initialized with N path(s)` | **N ≥ 1** (จำนวน vault ที่ index ได้) ถ้า `0 path(s)` = หา vault ไม่เจอ ไปข้อ 3 |
| 3 | เปิดเซสชันแล้วขอให้ agent list knowledge | มี tool ครบ 4 ตัว: `knowledge_list` · `knowledge_search` · `knowledge_read` · `knowledge_info` |

## 3. การค้นหา vault อัตโนมัติ (รายเครื่อง)

ลำดับการ resolve (ตัวที่มีอยู่จริงถูก index ทั้งหมด ไม่หยุดที่ตัวแรก):

1. `knowledgePaths` (config ที่ตั้งเอง)
2. `DSH_KNOWLEDGE_PATHS` (env var คั่นด้วย `;` หรือ `,`)
3. candidate มาตรฐาน: `~/.gemini/antigravity-ide/knowledge` · `~/.antigravity-ide/knowledge` · `~/.dsh/knowledge` · `~/.codex/knowledge` · `./knowledge` · `./docs/knowledge` · `./.knowledge`

- ⚠️ **ถ้าตั้ง `knowledgePaths` ใน config จะปิด candidate มาตรฐานทั้งหมด** (เหลือ config + env var) ถ้าต้องการ "เพิ่ม vault" โดยยังใช้ auto-discovery ให้ใช้ **env var** แทน
- รองรับ vault 2 แบบ: แบบมีโครงสร้าง (`<item>/metadata.json` + `artifacts/*.md`) และโฟลเดอร์ markdown ธรรมดา (`.md`/`.txt`)

```powershell
# Windows
$env:DSH_KNOWLEDGE_PATHS = "D:/team-docs/knowledge;~/my-vault"
```
```bash
# macOS / Linux
export DSH_KNOWLEDGE_PATHS="$HOME/my-vault:$HOME/team-docs"
```

## 4. อ่านก่อนแจ้งว่า "ใช้ไม่ได้"

1. **vault ที่อยู่นอก candidate ไม่ถูกค้นอัตโนมัติ** — ถ้า KI อยู่ใน Cursor / Claude Code / VS Code / Windsurf / JetBrains ต้องตั้ง `DSH_KNOWLEDGE_PATHS` เอง
2. **การค้นหาเป็นรายเครื่องโดยออกแบบ** — เครื่องใครเครื่องมัน ไม่มีการอัปโหลดและไม่มีการซิงค์ เครื่อง A ไม่เห็น vault ของเครื่อง B (เจตนา)

## 5. อัปเกรด / ถอน / หลังแก้โค้ดปลั๊กอิน

**ยังไม่มี auto-update และคุณไม่ต้องรู้คำสั่งอะไรเลย — บอก agent ตรง ๆ:**

> “อัปเดตปลั๊กอิน `dsh-knowledge-bridge` ให้หน่อย แล้วบอกว่าต้องรีสตาร์ทอะไร”

ปลั๊กอินจะใส่คำสั่งอัปเดตที่ถูกต้องของโปรไฟล์นี้ไว้ใน prompt ของ agent และ `knowledge_info`
จะคืนเวอร์ชันที่ติดตั้ง · คำสั่งนั้น · มีเวอร์ชันใหม่กว่าไหม · และต้องรีสตาร์ทหรือไม่
ถ้า process ของ host มองไม่เห็นชื่อโปรไฟล์ (DSH ส่ง `DSH_PROFILE` ให้ shell ที่ agent ใช้ ไม่ได้ส่งให้ตัว host เอง)
คำสั่งจะอยู่ในรูป `$env:DSH_PROFILE` บน Windows หรือ `"$DSH_PROFILE"` ที่อื่น พร้อม `updateCommandHint` อธิบายไว้
— รูปแบบนี้ resolve ได้ใน shell เดียวกับที่ agent รันคำสั่ง
การเช็ค registry (เมื่อ agent ขอ) เป็นการต่อเน็ตครั้งเดียวที่ปลั๊กอินนี้ทำ — ตอนโหลดไม่ยิงเน็ตเลย
และถ้าอ่าน registry ไม่ได้จะรายงาน `null` ไม่เดา

| งาน | วิธี |
|:--|:--|
| สั่ง agent | บอกให้อัปเดต `dsh-knowledge-bridge` — agent อ่านคำสั่งจาก prompt หรือ `knowledge_info` เอง |
| อัปเกรดเอง | `dsh plugin --profile <profile> update dsh-knowledge-bridge` หรือถอน → **Add plugin** ใหม่ |
| ถอน | Plugins → แถวปลั๊กอิน → Uninstall |
| แก้โค้ดปลั๊กอินเอง | ต้อง **รีสตาร์ท host** (ปิด/เปิด toggle ไม่พอ เพราะ cordis/ESM แคชไว้) |

## 6. แก้ปัญหาเร็ว

| อาการ | สาเหตุ / วิธีแก้ |
|:--|:--|
| `Initialized with 0 path(s)` | หา vault ไม่เจอ → ตั้ง `DSH_KNOWLEDGE_PATHS`/`knowledgePaths` และเช็คว่าเป็นโฟลเดอร์จริง |
| entry ค้าง **pending** | service ที่ประกาศไว้ยังไม่มีผู้ provide — เช็คชื่อ service และปลั๊กอินผู้ให้ |
| `cannot get property "X" without inject` | ทุก service ที่อ่านต้องอยู่ใน `export const inject` และอ่านใน `try` |
| guard ไม่บล็อกอะไรเลย | guard เทียบ `exec.name`/`exec.arguments` (ไม่ใช่ `exec.tool`/`exec.args`) |
| แก้แล้วพฤติกรรมไม่เปลี่ยน | รีสตาร์ท host |

## 7. Safety guard (เปิดเป็นค่าเริ่มต้น)

บล็อกคำสั่งทำลายข้อมูลก่อนถึงดิสก์ โดยเทียบกับ command string ของ `bash` / `pwsh` / `cmd` / `terminal`:

```js
['git\\s+reset\\s+--hard', 'git\\s+clean\\s+-fd', 'git\\s+restore\\s+\\.', 'rm\\s+-rf\\s+/(?!tmp)']
```

การปฏิเสธเป็นแบบ **monotonic** — ปลั๊กอินอื่นบังคับให้ผ่านไม่ได้ ข้อความที่ขึ้นต้นด้วย
`[BLOCKED BY DSH-KNOWLEDGE-BRIDGE SAFETY POLICY] …`

---

*MIT licensed. Issues and pull requests welcome — see [`CONTRIBUTING.md`](../CONTRIBUTING.md).*
