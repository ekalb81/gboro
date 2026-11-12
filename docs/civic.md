# Council meetings and city events

`npm run civic` (`scripts/civic.mjs`) writes `public/data/civic.json`, which the village reads next to `items.json`. It runs unattended in the publish workflow (it's listed in `scripts/collectors.json`) and needs no keys and no home machine.

## Sources

1. **The City's published council schedule.** Each year the City posts a "City Council Regular Meetings Schedule" and a "Subcommittee Meeting Schedule" (PDFs on the [Council Meetings page](https://www.greensboro-nc.gov/government/city-council/council-meetings)). Their dates live in `schedules` in `data/civic-config.json`. They include moved dates the 1st-and-3rd-Tuesday rule would get wrong, such as Nov 10, 2026, which moved because Nov 3 was Election Day. When the City posts next year's schedule, add a new year block to the config. That's a once-a-year edit. Until then, the run prints a notice in December and falls back to the usual rule.
2. **The usual rule** (`usual`): first and third Tuesdays at 5:30 PM. It is used only for years with no published schedule, and those items are labeled "Usual schedule, check the city site".
3. **The City's YouTube channel** (public Atom feed, no key). Videos titled "Greensboro City Council Meeting MM/DD/YYYY" become a "Watch" link on that meeting, and the meeting stays listed for a week after it ends. The newest "On the Town - Week of ..." video (GTN's weekly roundup of things to do) becomes a week-long item on the town board.
4. **Optional calendars:** `.ics` files in `data/civic/` and URLs in `feeds`. Nothing uses them now.

`skip` drops a date the City cancels after publishing. `extra` adds a one-off meeting, for example `{ "date": "2026-12-08", "time": "14:00", "title": "City Council special meeting" }`.

### What doesn't work, and why

- **greensboro-nc.gov's own calendar.** The City's calendar pages sit behind an Akamai browser challenge (a JavaScript check that only a real browser passes), so no script or hosted service can read them without defeating that check, and we don't. That calendar also doesn't list regular council meetings at all. It mostly has boards and commissions.
- **Legistar** (`webapi.legistar.com/v1/greensboro`) still answers, but its last meeting is from June 2021.
- **Downtown Greensboro events (`?ical=1`)** answered 403 from our test environment.

City events beyond "On the Town" come in through the Muse digest, which already watches the City's social accounts.

## What the village shows

- Council meetings and subcommittees are at City Hall (Downtown) with a purple marker. Calendar events are placed by address with the same rules as the digest (`locate()` in `scripts/lib.mjs`).
- **Council nights:** from an hour before a council meeting until it ends, every City Hall window glows, lamps burn by the door and warm light spills onto the street. Once the meeting starts, a flag flies on the roof. The status bar says "City Council meets tonight at 5:30 PM" or "City Council is in session".
- You can preview this without waiting for a Tuesday: `?council=tonight` (lit) or `?council=session` (lit, with the flag).
