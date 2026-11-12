# Council meetings and city events

`npm run civic` writes `public/data/civic.json`, which the village reads next to `items.json`.

```
city calendar (.ics)  ┐
usual council schedule ├─> npm run civic -> public/data/civic.json -> City Hall lights, markers, side list
```

## Sources, in order

1. **iCalendar files you save** in `data/civic/*.ics` (git-ignored). The city's events calendar on greensboro-nc.gov can export events as `.ics`; save the file there. You can also pass files on the command line: `npm run civic -- path/to/file.ics`.
2. **iCalendar feed URLs** in `feeds` in `data/civic-config.json`, fetched on every run. Leave it empty until there's a feed that works from where the script runs. The city's site (Akamai) turns away requests from cloud servers, so a feed URL may work on your machine and fail in a hosted job.
3. **The usual council schedule** in `data/civic-config.json`: first and third Tuesdays at 5:30 PM in the Katie Dorsett Council Chamber, Melvin Municipal Office Building, 300 W. Washington St (from the city's Televised Meetings and Council FAQ pages). It covers the next 45 days and steps aside on any day a calendar lists a council meeting. Add moved or cancelled dates to `skip` and one-off meetings to `extra`. The page labels these "Usual schedule, check the city site".

The old Legistar API (`webapi.legistar.com/v1/greensboro`) still answers, but its last meeting is from June 2021, so it isn't used.

## What the village shows

- Each meeting or event is an item in its district: council and boards at City Hall (Downtown), other events placed by address with the same rules as the digest (`locate()` in `scripts/lib.mjs`). Government items have a purple marker.
- **Council nights:** from an hour before the meeting until it ends, every City Hall window glows, lamps burn by the door and warm light spills onto the street. Once the meeting starts, a flag flies on the roof. The status bar says "City Council meets tonight at 5:30 PM" or "City Council is in session".
- Crowds gather outside on the day, like any other item.
- Preview without waiting for a Tuesday: `http://localhost:8080/?council=tonight` (lit) or `?council=session` (lit plus flag).

## Kinds

`classify()` sorts calendar entries by title: `council` (City Council meetings, work sessions, briefings), `board` (boards, commissions, committees, hearings), or `event` (everything else). Cancelled entries are dropped.
