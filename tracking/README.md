# Cinema observations

These files are stored in GitHub for later analysis. They are excluded from the GitHub Pages package and do not add anything to the website interface.

- `snapshot.json`: the latest complete, validated scrape, including source-listed prices, showtimes, runtime, age rating, genre, source-reported release date, and explicitly supplied language/subtitle fields. Unknown details are `null`. Prices are source quotes by studio format, not verified booking totals.
- `history.json`: first/last observations for each movie and each cinema/format combination, current availability, latest venue/showtime counts, last observed offers, and the most recent successfully fetched movie details. First seen means first seen in this tracker, not the film's release date. Initialization uses the existing saved snapshot as its baseline.
- `latest.json`: the latest attempted refresh, with per-cinema source dates and outcomes, movie-detail check outcomes, and changes from the previous successful observation. It records additions, absences, returns, price changes, counts, and changed metadata fields. A failed check has `changes: null` and does not advance absence/price history.

Every successful scrape produces a new observation; Git commits preserve earlier versions of all three files. A movie or format absent from a complete current-day snapshot is marked `currentlyListed: false`, with `missingSince` set to that observation time. This records source availability, not a confirmed theatrical end date. A return preserves its original first-seen date. Counts cover all sessions present in the observed schedule, including any sessions whose start times have passed.

The scraper fetches the same movie pages already needed for trailers; metadata adds no extra requests. Language and subtitles are recorded only from explicit labeled fields, never inferred from the title, country, cast, or trailer. A failed movie-page request leaves earlier known details in the history with their original `detailsObservedAt`; the current snapshot records unknown details and the check report explains why.

The archive job also runs after a source-check failure and commits only the diagnostic report. If scraping succeeds but publication fails, the observations are still archived and the published `showtimes.json` backup stays unchanged. The run ID and timestamps are checked before saving; newer owner commits always win and no force push is used. Only this archive job has Contents write permission. The temporary transfer artifact expires after one day; committed history stays in the repository.

To inspect older observations, use GitHub's **History** button on a file, or locally:

```sh
git log --oneline -- tracking/snapshot.json
git show COMMIT:tracking/snapshot.json
git diff OLDER_COMMIT NEWER_COMMIT -- tracking/history.json
```
