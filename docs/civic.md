# Council meetings and city events

`npm run civic` (`scripts/civic.mjs`) writes `public/data/civic.json`, which the village reads next to `items.json`. It runs unattended in the publish workflow (it's listed in `scripts/collectors.json`) and needs no keys and no home machine.

## Sources

No single official feed of council meetings exists that a script can read (see below). So the dates start from the City's published yearly schedule, and several automatic sources correct it during the year. Disagreements between sources show up as warnings in the publish run.

1. **The City's published council schedule (the baseline).** Each year the City posts a "City Council Regular Meetings Schedule" and a "Subcommittee Meeting Schedule" (PDFs on the [Council Meetings page](https://www.greensboro-nc.gov/government/city-council/council-meetings)). Their dates live in `schedules` in `data/civic-config.json`. They include moved dates the 1st-and-3rd-Tuesday rule would get wrong, such as Nov 10, 2026, which moved because Nov 3 was Election Day. For a year with no published schedule, the usual rule (`usual`) fills in, and those items are labeled "Usual schedule, check the city site". In December the run reminds you to add next year's dates.
2. **Changes reported during the year (automatic).** The City's own posts (Muse digest) and verified local news (the RSS feeds in `data/sources.json`, such as Rhino Times and News & Record) are scanned for council headlines with a date:
   - A **cancellation** ("Council cancels Dec. 1 meeting") removes that meeting, shows a "cancelled" notice, and keeps City Hall dark.
   - A **special meeting, work session or new date** on a day with nothing scheduled adds that meeting, with a link to the report.
   - A **report on a scheduled day** confirms the meeting and fixes the start time if the report gives a different one.
   - A cancellation or rescheduling headline **with no date** can't be applied safely, so it becomes a warning instead.
   - Only the City's own accounts and verified news count. Posts by individuals never change the schedule.
3. **The City's YouTube channel (automatic check).**
   - A recording titled "Greensboro City Council Meeting MM/DD/YYYY" becomes a "Watch" link, and the meeting stays listed for a week.
   - A recording for a day with no scheduled meeting is added, with a warning, because the schedule changed without us hearing.
   - A scheduled meeting with no recording 3 days later gives a warning that it may have been cancelled or moved.
   - The newest "On the Town - Week of ..." video becomes a week-long item on the town board.
   - YouTube's feeds sometimes answer 404 for a while, so the fetch retries two URLs. The last good copy is kept in the publish workflow's cache (public videos only), and "no recording" warnings are skipped when the feed is down.
4. **Hand overrides, rarely needed:** `skip` drops a date and `extra` adds one, for anything the automatic sources miss.
5. **Optional calendars:** `.ics` files in `data/civic/` and URLs in `feeds`. Nothing uses them now.

Warnings appear as `::warning` annotations and in a "Council schedule checks" section of the publish run summary.

### What doesn't work, and why

- **greensboro-nc.gov's own calendar.** The City's calendar pages sit behind an Akamai browser challenge (a JavaScript check that only a real browser passes), so no script or hosted service can read them without defeating that check, and we don't. That calendar also doesn't list regular council meetings at all. It mostly has boards and commissions.
- **Legistar** (`webapi.legistar.com/v1/greensboro`) still answers, but its last meeting is from June 2021.
- **Downtown Greensboro events (`?ical=1`)** answered 403 from our test environment.

City events beyond "On the Town" come in through the Muse digest, which already watches the City's social accounts.

## What the village shows

- Council meetings and subcommittees are at City Hall (Downtown) with a purple marker. Calendar events are placed by address with the same rules as the digest (`locate()` in `scripts/lib.mjs`).
- **Council nights:** from an hour before a council meeting until it ends, every City Hall window glows, lamps burn by the door and warm light spills onto the street. Once the meeting starts, a flag flies on the roof. The status bar says "City Council meets tonight at 5:30 PM" or "City Council is in session".
- You can preview this without waiting for a Tuesday: `?council=tonight` (lit) or `?council=session` (lit, with the flag).
