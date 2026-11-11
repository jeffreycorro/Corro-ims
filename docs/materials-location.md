# Materials / Warehouse does not live in this repo

This GitHub repository (`jeffreycorro/Corro-ims`) is the company portal plus the **HR** (`hr-artifact/`) and **Motorpool** (`motorpool-artifact/`) Netlify apps. There is no `materials-artifact/`, no `app/materials/`, and no warehouse-count / TF-reconcile / returnables source here.

Procurement on this site is still a stub (“module coming soon”). Motorpool README and VRF docs also state Materials is out of scope.

**Do not invent a Materials app in this repo.** The three CCD Portal Concerns Log bugs (TF reconcile reset, Solar Light returnables, warehouse-count multi-photo) must be fixed in the Drive / Apps Script system below.

## Live backend (staff still use this)

Staff filed the 2026-09-18 bugs as **Computer, Script**. The live workbook is:

| Item | ID / URL |
| --- | --- |
| Spreadsheet **MATERIAL CONTROL / PURCHASER MONITORING** | [`1_J5OHCf1_2s8x_oR24yhaQ9vhDTcOoIrSWa2zkdfal8`](https://docs.google.com/spreadsheets/d/1_J5OHCf1_2s8x_oR24yhaQ9vhDTcOoIrSWa2zkdfal8/edit) |
| Tabs used by the bugs | `ALL MRF`, `TF Monitoring`, TF Builder / TRANSMITTAL FORM, tool tagging / returnables |
| Last seen modified | 2026-09-21 (still live) |

The Next.js Materials UI talks to this workbook through an **Apps Script web app** (`GAS_URL` `/exec`, documented as deployment prefix `AKfycb…`, version **@176** when `DEPLOY.md` was written). Bound script files named in that deploy guide (not exported as standalone Drive files):

- `Portal API.js` — role check, `wa_*` RPCs, writes the signed-in name into `by`
- `Portal Secret.js` — `PORTAL_SECRET` must match Netlify `GAS_SECRET`

Open the bound script from the spreadsheet: **Extensions → Apps Script**. Drive search does not list those two files as independent script projects.

### Standalone script projects (related, not the Next UI)

| Title | Script ID | URL |
| --- | --- | --- |
| Material Request Audit | `1zmZBa97ebGD3p5Ic-aTozaK4eAUOwK0h2q_5fMPBlHD1bYWsdShcOH8A` | [script.google.com](https://script.google.com/d/1zmZBa97ebGD3p5Ic-aTozaK4eAUOwK0h2q_5fMPBlHD1bYWsdShcOH8A/edit) |
| MRF Registry | `1k5LwtwHpikHCyKElohsiYsq1oq4TeS9jXsoAUR9QqR3ORHgJCUnScX0X` | [script.google.com](https://script.google.com/d/1k5LwtwHpikHCyKElohsiYsq1oq4TeS9jXsoAUR9QqR3ORHgJCUnScX0X/edit) |
| Material Control 2 Exams | `1pIcNZAnrME-gQ2iudiA7ZLlB3FhWVZMdJJPDsPj1Ia-aQALYWfbYn7vc` | exams only — not warehouse ops |

### `.gs` copies in My Drive (root `0AO-aQMNc9GgRUk9PVA`)

These are paste-in helpers for the same workbook. They are **not** the Next.js portal.

| File | Drive ID | Role |
| --- | --- | --- |
| `Reconcile_TF_MRF.gs` | [`1QAOCPxq0pUpokvjZWArXDHHMlHgwX9a_`](https://drive.google.com/file/d/1QAOCPxq0pUpokvjZWArXDHHMlHgwX9a_/view) | Builds TF RECON from TF Monitoring vs ALL MRF. Read-only; comments say a re-run rebuilds the dashboard (likely cause of “back to zero” if progress is only on that tab and not persisted on ALL MRF / a progress store). |
| `Sort_TF_Monitoring.gs` | [`1MQWGuTiLWij24jevjI1ogDndOxpe3iBq`](https://drive.google.com/file/d/1MQWGuTiLWij24jevjI1ogDndOxpe3iBq/view) | Sort TF Monitoring by TF number |
| `Menu.gs` | [`1RJy3qi-ixuVJPjCr8_9_bUHKdtCta-ln`](https://drive.google.com/file/d/1RJy3qi-ixuVJPjCr8_9_bUHKdtCta-ln/view) | Corro Tools menu |
| `TF_Line_Limit_13.gs` | [`1pGiAKOMqNi_jTlosViGCkvEM_2SaTl_z`](https://drive.google.com/file/d/1pGiAKOMqNi_jTlosViGCkvEM_2SaTl_z/view) | Cap 13 lines per TF |
| `Build_Transmittal_Form_2up_v5.gs` | [`1-44Z5jN1D9h6wfcCvKzmPZzz0XpjSjBD`](https://drive.google.com/file/d/1-44Z5jN1D9h6wfcCvKzmPZzz0XpjSjBD/view) | Print TF |
| `Build_Movement_Tools.gs` | [`1-6WIoOE31RbdrjMcOkhOmFan9KGbD_tY`](https://drive.google.com/file/d/1-6WIoOE31RbdrjMcOkhOmFan9KGbD_tY/view) | Movement ledger views |
| `Sort_ALL_MRF_By_MrfNo.gs` | [`1U5O4YCVcdas9V61R8oZTSLG1atqmtJBY`](https://drive.google.com/file/d/1U5O4YCVcdas9V61R8oZTSLG1atqmtJBY/view) | Sort ALL MRF |
| `Update_ALL_MRF_Matched_Names.gs` | [`1syzCc6Ql21gutxxBiEDUvGjwi9-HhyPm`](https://drive.google.com/file/d/1syzCc6Ql21gutxxBiEDUvGjwi9-HhyPm/view) | Name sync to MATERIAL DB |

Folder **Material Control Department**: [`1xd2gG5vsn7gexwSEhS-tiMqE1K0tA9tp`](https://drive.google.com/drive/folders/1xd2gG5vsn7gexwSEhS-tiMqE1K0tA9tp) (ops photos / tools monitoring, not app source).

## Next.js Materials frontend (Drive only — not GitHub)

A full Next.js app named **`corro-portal`** exists only as a Drive tree. It is **not** this `corcondev-portal` checkout. Local `.git` inside that folder has no `remote` (file-mode repo only).

| Path | Drive ID | URL |
| --- | --- | --- |
| `Claude / Projects / corro-portal` | `1Nso434vg_xnNvT4UEznsW0A4gZY39L4f` | [folder](https://drive.google.com/drive/folders/1Nso434vg_xnNvT4UEznsW0A4gZY39L4f) |
| Parent `Projects` | `1c_GSu9iE9XzELUUPeWlZJQrGXXgIKc-y` | [folder](https://drive.google.com/drive/folders/1c_GSu9iE9XzELUUPeWlZJQrGXXgIKc-y) |
| Parent `Claude` | `11pJi7GAgj4aJ9_lhip2XmE8hqcH6SswV` | [folder](https://drive.google.com/drive/folders/11pJi7GAgj4aJ9_lhip2XmE8hqcH6SswV) |
| `package.json` (`name: corro-portal`) | `1hPTAMn1jJqHkWnF4aZ7l4nWVh4aw7igN` | [file](https://drive.google.com/file/d/1hPTAMn1jJqHkWnF4aZ7l4nWVh4aw7igN/view) |
| `DEPLOY.md` | `119v8zhlrqFTKWfjv-DAvNSdk2ZrAQLr6` | [file](https://drive.google.com/file/d/119v8zhlrqFTKWfjv-DAvNSdk2ZrAQLr6/view) |
| `.env.example` | `19VwhxuQm4com0RzMW6aOrOwwrSIucvBJ` | [file](https://drive.google.com/file/d/19VwhxuQm4com0RzMW6aOrOwwrSIucvBJ/view) |
| `app/lib/gas.ts` (server → Apps Script) | `17By4TiVU5D-6vVvpg4uyPKUCkt-hj5eE` | [file](https://drive.google.com/file/d/17By4TiVU5D-6vVvpg4uyPKUCkt-hj5eE/view) |
| `app/lib/rpc.ts` | `1JMZXy959Et8Fs2QnxxlsDwpuEFcXe2vV` | [file](https://drive.google.com/file/d/1JMZXy959Et8Fs2QnxxlsDwpuEFcXe2vV/view) |
| `app/api/rpc/route.ts` | `1Y5MlzwaIWdaDnnZaERqImMjpcUaArIfF` | [file](https://drive.google.com/file/d/1Y5MlzwaIWdaDnnZaERqImMjpcUaArIfF/view) |

### Screens that match the three open bugs

| Bug | Source in Drive |
| --- | --- |
| TF reconcile persist | `app/materials/reconciliation/` — folder [`1Ugtrex4WxYv7VKLN6mqDtvWonjf4RnAo`](https://drive.google.com/drive/folders/1Ugtrex4WxYv7VKLN6mqDtvWonjf4RnAo) plus `Reconcile_TF_MRF.gs` / TF RECON tab |
| Solar Light returnables at site | `app/materials/tools/at-site/` — folder [`18OPffznmeL_6SCPgv8j9LWUPlqFCs1-A`](https://drive.google.com/drive/folders/18OPffznmeL_6SCPgv8j9LWUPlqFCs1-A) (under tools [`1_c5R3KOldfznW-n8RrkBbjWq4BPz2NG-`](https://drive.google.com/drive/folders/1_c5R3KOldfznW-n8RrkBbjWq4BPz2NG-)); also `MaterialForm.tsx` [`1for9eflukzP_UlJ1y_WlpDNiVxGFyB9f`](https://drive.google.com/file/d/1for9eflukzP_UlJ1y_WlpDNiVxGFyB9f/view) (`wa_toolsForItem` / `wa_toolUnitGap`) |
| Warehouse count multi-photo | `WarehouseCount.tsx` [`1cWlFSgOhSrUCvgLvQ4arTKrxguECcmRX`](https://drive.google.com/file/d/1cWlFSgOhSrUCvgLvQ4arTKrxguECcmRX/view) in `app/materials/inventory/count/` [`1t6N6xwBJu2a_xDxhXolGdhPTZjoc9mw3`](https://drive.google.com/drive/folders/1t6N6xwBJu2a_xDxhXolGdhPTZjoc9mw3) |

`app/materials/` root: [`1d6JibUPxZjHoWS0wZzbdTwxGeaZ9srkW`](https://drive.google.com/drive/folders/1d6JibUPxZjHoWS0wZzbdTwxGeaZ9srkW) (reconciliation, tools, inventory, receiving, monitors, forms, transmittals, requests, orf, find).

RR PDFs (e.g. RR 3487, 2026-09-21) are still being generated from this system today.

## Concerns log rows (still Open)

Spreadsheet **CCD Portal — Concerns Log**: [`1dqoToumIU4qXFXVGSeepBa4ZX_xt4GzpHrM6FivocFY`](https://docs.google.com/spreadsheets/d/1dqoToumIU4qXFXVGSeepBa4ZX_xt4GzpHrM6FivocFY/edit)

1. **2026-09-18** — John Lloyd S. Cainila — TF reconcile printed/viewed as zero after 33 not received / 8 partial the night before.
2. **2026-09-18** — John Lloyd — Solar Light 200 Watts-IP67 (SL014, SL015, SL016), RR-3280, TF-6241 at Tagbao FMR P3 tagged/on-site but missing from site returnables.
3. **2026-09-21** — Justine Omega — warehouse count allows only one photo (computer + Android).

## What Builder should do next

1. Work in Drive folder `corro-portal` (`1Nso434vg_xnNvT4UEznsW0A4gZY39L4f`) **and** the bound Apps Script on the MATERIAL CONTROL spreadsheet. Import that tree as its own repo if you want GitHub PRs; do not paste it into Corro-ims.
2. **TF reconcile:** persist counts on ALL MRF / a durable store, not only a rebuilt TF RECON tab. See `Reconcile_TF_MRF.gs`.
3. **Returnables:** include coded/tagged units (SL014–016, TF-6241) in the site list even if a filter requires a different status.
4. **Count photos:** change `WarehouseCount.tsx` (and the matching `wa_*` save) to accept multiple images.
5. Bump the Materials BUILD stamp in that Drive app (not Motorpool/HR BUILD in this repo).
6. Proposed Netlify site name from `DEPLOY.md`: `corro-portal`. Secrets stay in `.env.local` / Netlify env — do not commit them.

## Not these

- `hr-artifact/` and `motorpool-artifact/` in this repo — do not change them for these bugs.
- Costing Database Apps Script (`1etqnnamcDBa83xQgB6VuSNVHXPuNOz5y7t__i_9tLtvjxP4h39kfhdUV`) and Project Engineer Monitoring Dashboard folder (`1r9LKNQ-POouj5wh5mnFnUHONJG8E4saS`) — different apps.
- CCD-04 Check Monitoring — finance checks, not warehouse “Check monitoring” on the concerns form.
