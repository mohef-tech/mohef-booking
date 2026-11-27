# Workspace Rules - mohef-booking

Before auditing, designing, writing UI/copy, or editing any code in this project, always read and follow `.agents/skills/mohef-skills/SKILL.md`, `.agents/skills/ui-ux-pro-max-skill/SKILL.md`, and `.agents/skills/modern-web-guidance/SKILL.md` first.

## Mandatory Defaults
- Follow the `Communication Rules` in `.agents/skills/mohef-skills/SKILL.md`: respond in Indonesian, execute strictly 1 step at a time and wait for user confirmation before continuing, and do not write post-task summaries unless explicitly asked.
- For UI work: if `docs/DESIGN_DIRECTION.md` does not exist yet, discuss and establish the visual direction with the user first and save the approved result to `docs/DESIGN_DIRECTION.md` before writing any frontend UI code. If it already exists, read and follow it strictly.
- Maintain strict separation in this Decoupled Monorepo: `backend/` (NestJS + PostgreSQL) and `frontend/` (Next.js + TypeScript) communicate only via REST API contracts.
- Do not touch database schema, backend logic, or role access rules outside the active step unless explicitly requested.

## Source of Truth & Documentation (`docs/`)
- Wajib membaca dan mematuhi `docs/PRD_v0.2.md` sebagai source of truth untuk seluruh batasan fitur V1, aturan bisnis (grid 30 menit, DP 50%, tenggang 15 menit, timer pegang stik, pelepasan slot sisa >= 30 menit, 4 matriks tarif), serta kesiapan skema multi-tenant V2 sebelum membuat file atau menulis kode.
- Baca `docs/PROGRESS.md` HANYA jika kehilangan konteks proyek atau diminta secara eksplisit. Namun, WAJIB memperbarui `docs/PROGRESS.md` secara mandiri setiap kali berhasil menyelesaikan suatu langkah besar atau fitur.