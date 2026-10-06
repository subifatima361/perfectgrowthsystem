# perfectgrowthsystem
Tracking Meta ads for dental clinics, filled in automatically from the Meta Marketing API.

[`apps-script/Code.gs`](apps-script/Code.gs) is a Google Apps Script that runs inside a Google Sheet. Every morning it fills in the per-ad tracker you currently type by hand: Yesterday, Last 3 Days, Last 7 Days, Last 14 Days and Max, with Spend, Leads, CPL, Impressions, Link Clicks, CTR, CPC and Frequency. It covers every clinic in one sheet and keeps a daily history.

---

## What you get

| Tab | What's in it |
|---|---|
| **Config** | You fill this in: one row per clinic (name, ad account ID, target CPL, active ads only). |
| **Summary** | Spend, leads and CPL per clinic for each period. One glance across all clients. |
| **One tab per clinic** | Your current layout: a block per ad with the 5 periods × 8 metrics, plus a **Signal** column. Ads are sorted by lifetime spend. |
| **History** | One row per ad per day, added automatically and never overwritten. Use it for trend charts, monthly reports or Looker Studio. |

Colour coding on the clinic tabs:
- **CPL**: green if at or under target, yellow if up to 30% over, red if more than 30% over.
- **Freq**: yellow at 2.5 or higher (likely creative fatigue).
- **Signal** column (plain-English flags): `Spent 2x target CPL, no leads`, `CPL over target`, `High frequency`, `Low CTR` (under 0.7% with at least 1,000 impressions).

You can change these thresholds at the top of `Code.gs` (`FREQ_WARN`, `CPL_WARN_RATIO`).

---

## Setup, step by step (about 30–45 minutes, once)

### Part A: Get a permanent Meta access token (done once for the agency)

You need a **System User** token. A normal user token expires within about 60 days and breaks when that person leaves. A System User token belongs to the business and can be set to never expire.

1. **Check that you have access to the clinic ad accounts.**
   Go to [business.facebook.com](https://business.facebook.com) → **Business settings** → **Accounts → Ad accounts**. Every clinic's ad account should be listed, either owned or shared with your agency as a partner. If one is missing, ask the clinic to add your Business Portfolio as a partner on their ad account.

2. **Create a Meta app** (it's only used to issue the token).
   - Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app**.
   - Pick the use case for managing ads / Marketing API (if you're asked for an app type, choose **Business**).
   - When asked, connect it to your agency's Business Portfolio.
   - The default (basic) Marketing API access tier is enough to *read* your own clients' accounts. You don't need App Review for this.

3. **Create a System User.**
   **Business settings → Users → System users → Add**. Name it something like `Sheets Reporting`, role **Employee**.

4. **Give it read access to the ad accounts.**
   Click the system user → **Assign assets** → **Ad accounts** → select every clinic → turn on **View performance** only (read-only, so it can never edit or spend). Save.

5. **Generate the token.**
   With the system user selected, click **Generate new token** → choose the app from step 2 → set token expiry to **Never** → tick the **`ads_read`** permission → **Generate**.
   Copy the token right away; Meta only shows it once. Treat it like a password and don't paste it into the sheet, email or Slack.

### Part B: Set up the Google Sheet

6. **Create a new Google Sheet**, for example `PGS – Meta Ads Tracker`.
   Go to **File → Settings** and set the **time zone** to the one your ad accounts report in (Ads Manager → Ad account settings). Otherwise "Yesterday" in the History tab may be off by a day.

7. **Add the script.**
   **Extensions → Apps Script**. Delete the placeholder code, paste in the full contents of [`apps-script/Code.gs`](apps-script/Code.gs) and click **Save** 💾.

8. **Store the token securely.**
   In the Apps Script editor: **⚙ Project Settings → Script properties → Add script property**
   - Property: `META_TOKEN`
   - Value: the token from step 5

   Script properties aren't visible to people who only have access to the sheet, so the token stays out of the cells.

9. **Reload the Google Sheet.** A new **Meta Ads** menu appears in the top bar.

10. **Fill in the Config tab.** Click **Meta Ads → Set up Config tab**, then replace the example row with one row per clinic:

    | Clinic | Ad Account ID | Target CPL | Active ads only (TRUE/FALSE) |
    |---|---|---|---|
    | Cascade | act_1234567890 | 20 | TRUE |
    | Neighborhood | act_9876543210 | 25 | TRUE |

    - **Ad Account ID**: in Ads Manager it's the number in the URL after `act=`, or under the account name in the dropdown. With or without the `act_` prefix both work.
    - **Target CPL**: the CPL you've agreed with the clinic, used for the colours and flags. Leave it blank to turn those off.
    - **Active ads only**: `TRUE` mirrors what you track today (only live ads). Use `FALSE` to include paused ads that still spent in the window.
    - The **Clinic** name becomes that clinic's tab name.

11. **Run it once.** **Meta Ads → Refresh now**. The first time, Google asks you to authorise the script: choose your account → **Advanced** → **Go to (project name)** → **Allow**. This warning appears because it's your own unpublished script. It needs to reach `graph.facebook.com` and edit this spreadsheet.

12. **Check it against Ads Manager.** Open one ad in Ads Manager, set the date to **Last 7 days**, and add the columns **Amount spent, Leads, Impressions, Link clicks, CTR (link click-through rate), CPC (cost per link click), Frequency**. The numbers should match the sheet. (See "Why some numbers will differ from your old sheet" below.)

13. **Turn on automation.** **Meta Ads → Turn on daily auto-refresh**. The sheet now refreshes between 6 and 7am every day without anyone opening it. You can still click **Refresh now** at any time for up-to-the-minute numbers.

14. **Get emailed if it breaks** (recommended). In Apps Script → **⏰ Triggers** → click the trigger → **Failure notification settings → Notify me daily**. The most common causes are a token that was revoked or an ad account that's no longer shared.

**Adding a new clinic later** takes about a minute: share its ad account with the System User (step 4), add a row to Config, and click Refresh now.

---

## Why this setup helps

### 1. It removes about 240 hand-typed numbers a day
Your two current sheets track 6 ads × 5 periods × 8 metrics, which is **240 cells a day**. That grows with every new clinic and every new creative you test. The script fills all of them for every clinic in under a minute, before you start work. Your time goes into deciding what to do with the numbers instead of copying them.

### 2. It fixes errors that are already in the current sheets
Reading through the current trackers, there are mistakes typical of manual entry:

- **Copy-paste carryover (Cascade).** The *Testimonial Up Beat* ad's **Last 14 Days** and **Max** rows are identical to the *Take My Breath* ad above it ($335.30 / 17 leads / 17,974 impr. and $2,913.32 / 156 leads). That can't be right, because its own Last 7 Days spend is only $27.90.
- **Copy-paste carryover (Neighborhood).** The *Testimonial Style* ad shows **0 clicks yesterday** but a 1.22% CTR, $2.40 CPC and 1.13 frequency. Those are the exact numbers from the ad above it.
- **Mixed metric definitions.** For Cascade *Take My Breath* yesterday, 11 clicks ÷ 1,176 impressions = **0.94%**, but the sheet says 1.44%. Last 3 Days: 47 ÷ 3,603 = **1.30%**, but the sheet says 0.83%. The CTR and CPC columns were probably taken from a different "clicks" metric than the Clicks column (Meta has *Clicks (all)* and *Link clicks*), so the row doesn't add up.
- **Blank cells and inconsistent formats.** Some impressions are missing (Last 7 Days for two Neighborhood ads), and values are written as `1.3` vs `1.3%` or `26.9` vs `$26.90`. Stored as text, they can't be charted or summed.
- **"$0.0" CPL when there were 0 leads.** This looks like the best CPL in the sheet when it actually means *no leads at all*. The script shows "—" and flags the ad if it has spent 2× the target CPL without a lead.

The script pulls the raw counts (spend, impressions, link clicks, leads) and **calculates CPL, CTR and CPC itself**, so every row uses the same definitions and always adds up.

### 3. Better decisions for dental lead gen
- **CPL vs target in colour.** You can tell straight away which Invisalign or implant creative to scale and which to pause.
- **Frequency flags.** Local dental audiences are small (a few-mile radius), so creatives burn out fast. Cascade's lifetime frequency is already at 3.2. A flag at 2.5 tells you when to rotate in a new video *before* CPL climbs.
- **"Spent 2× target, no leads".** This catches the ads that quietly waste budget, the most common leak in small local accounts.
- **Yesterday vs 3 / 7 / 14 days side by side,** like you have now. One bad day doesn't trigger a panic change, and a real trend is visible early.
- **Leads counted consistently.** The script counts Meta's combined `lead` result (instant forms plus website leads) and falls back to form-only or pixel-only leads if that's all an ad has. Leads are never double counted.

### 4. A history you don't have today
Right now each day's numbers are overwritten, so last Tuesday is lost. The **History** tab saves one row per ad per day automatically. After a few weeks you can:
- Chart CPL per creative over time (when did *Take My Breath* start fatiguing?)
- Build monthly client reports in minutes with a pivot table, or connect the tab to **Looker Studio** for a client-facing dashboard
- Compare clinics and creatives month over month

### 5. It scales with the agency
- **One sheet for every clinic**, plus a Summary tab for a morning check across all clients
- New clinic = one row in Config. New ads appear automatically, with no new blocks to build.
- **It's secure and won't silently break:** the token is read-only, stored outside the cells, doesn't expire, and isn't tied to one employee's Facebook login.

### 6. It's free and transparent
Paid connectors (Supermetrics, Coupler.io, Porter Metrics) do something similar for roughly $50–$300+ a month and lock you into their layouts. This is about 350 lines of code you own and can change: add columns, thresholds or clinics whenever you want.

---

## Why some numbers will differ from your old sheet
- **Clicks / CTR / CPC use *link clicks*** (people who clicked through to the form or site). Those are the clicks that matter for lead gen. *Clicks (all)* also counts likes, profile taps and "see more", which inflates CTR.
- **CPL, CTR and CPC are calculated from the totals,** so they always agree with the Spend, Leads, Impressions and Clicks in the same row.
- **"Last N Days" excludes today,** the same as Ads Manager's presets.
- **Max is lifetime-to-date** for that ad (Meta keeps up to 37 months).
- Meta can revise the last ~3 days slightly as late conversions come in. The clinic tabs always show the latest numbers; History records "yesterday" as it looked that morning.

## Troubleshooting
| Error | Fix |
|---|---|
| `Add META_TOKEN under Project Settings` | Step 8 wasn't done, or the property name has a typo. |
| `Meta API: (#100) ... ad account ... does not exist / no permission` | The System User isn't assigned to that ad account (step 4), or the ID in Config is wrong. |
| `Meta API: Error validating access token` | The token was revoked or regenerated. Generate a new one (step 5) and update the script property. |
| A clinic tab says "No active ads with delivery" | Nothing is active right now. Set Active ads only to `FALSE` to see paused ads. |
| Leads show 0 but Ads Manager shows results | The campaign optimises for something other than leads (for example messages or calls). Add that action type to `LEAD_ACTION_TYPES` at the top of the script. |
