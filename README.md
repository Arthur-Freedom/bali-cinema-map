# Bali Cinema Map

Find the cinemas closest to home on a light, interactive map of Bali.

**Live map: [arthur-freedom.github.io/bali-cinema-map](https://arthur-freedom.github.io/bali-cinema-map/)**

Inspired by the [Australia 462 work map](https://github.com/Arthur-Freedom/au-462-work-map).

## Use

- On phones, the map and cinema list form one continuous page. The **Cinemas & map / Compare movies** switch stays available while scrolling. Use two fingers to move the map; one finger scrolls the page.
- **Settings** beside the title opens one menu for movie alerts, owner sign-in and refresh, pricing and studio-format explanations, and about information. These controls stay out of the comparison results.

- Choose a starting point on the map, or use your current location, to sort cinemas nearest first.
- Location can use an approximate position supplied by the browser. If the device's Location setting is off or access is blocked, the page explains how to enable it and offers a retry; choosing a point on the map remains available.
- Distances are straight-line estimates in kilometres. Open **Directions** for a road route from your starting point.
- Search by cinema name, chain or area. Cinema icons use chain colors; hover or focus a pin to see its name on the map. Select a pin or list row to keep the name visible and open details.
- Your starting point has a distinct dot labelled **You**.
- The map popup also offers **Films & prices** and **Directions**, so you can open current screenings, ticket prices or a route directly beside the cinema pin.
- Selecting a cinema positions the whole popup inside the map, with room for its action buttons. On phones, the map scrolls into view. Click the map background to close the popup.
- Your starting point stays in your browser's local storage; it is not included in this public repository.
- Open **Compare movies**, pick a film, and see venues, studio formats, listed ticket prices and showtimes together. Listings sort by lowest price; filter to a studio format to compare equivalent screenings. You can also sort by name or distance after setting a starting point.
- Choose **Soonest showtime** to put the next upcoming screening first in Bali time (WITA). The next session is highlighted; started sessions are muted and rows with no remaining sessions appear last. Ordering refreshes while this view is open and uses the snapshot’s date, so old schedules never masquerade as upcoming sessions.
- The **Cinema format** dropdown above the movie picker filters both movies and venue listings. Choose Premiere, VIP, IMAX, Regular, Deluxe, Executive, or the combined Premiere/VIP/IMAX option. **Any format** shows everything. Each venue still displays its exact studio label, such as IMAX 2D.
- Open **Premiere, VIP or IMAX?** beside that filter for the format guide and source descriptions. Premiere (Cinema XXI) and VIP (Cinépolis) focus on comfort and service; IMAX focuses on the screen, projection and sound.
- Play the compact trailer beside the movie title to watch the same YouTube video linked by JadwalNonton. It does not autoplay and stops when switching films or returning to the map. On narrow screens it sits below the title. There is no separate external YouTube link.
- Trailers use the standard `youtube.com` player so YouTube can recognize an existing Premium sign-in when browser cookie settings allow it. Premium viewers need to be signed in to YouTube in the same browser; [YouTube’s embedded-player troubleshooting](https://support.google.com/youtube/answer/7437519?hl=en) explains cookie and account requirements.
- **Show on map** opens that cinema’s pin; **Check listing** opens its source schedule. Movie selections can be shared with the `?movie=YEAR/SLUG` URL parameter. The `experience` and `sort` parameters preserve the movie-type filter and sorting choice.

## Data

**New-movie alerts:** a compact notice lists films first discovered after the visitor's last acknowledgement. It is remembered only in that browser and does not announce the existing catalogue on first use. Personal phone alerts are available under **New-movie alerts** after owner sign-in. On Android, allow notifications in Chrome, then use **Send test** to verify delivery. Alerts are grouped after successful refreshes, continue with the site closed, and can be disabled per device. The private push subscription is stored in Cloudflare KV Free, never in the public repository. Only movie discovery timestamps are added to public listings; the full tracking archive remains excluded. See [notification setup](owner-service/README.md#personal-movie-notifications).

Code pushes may publish interface changes using the last valid saved snapshot when the source has not yet updated its schedule (for example, just after midnight). Its original date is preserved and the site shows the existing stale-date warning. These runs archive the source diagnostics and check notification configuration without sending movie alerts. Manual and scheduled refreshes still fail without publication when any source is invalid or outdated.

The 12 theaters in [JadwalNonton's Bali listing](https://jadwalnonton.com/bioskop/di-bali/), checked 5 October 2026. This is a location snapshot and may omit independent screening venues.

Movie comparisons load `showtimes.json`, a dated snapshot of those cinema schedules. Each studio format keeps its own price and showtimes. JadwalNonton warns that listed prices may follow the first showtime, and later sessions may differ; they are not a guaranteed final booking total. An absent listing is not proof that a film is unavailable.

The scraper also checks each movie’s source page for its trailer, with at most three requests in parallel. It saves only validated YouTube video IDs, never embedded HTML. Missing or unavailable trailers do not block schedule updates. Saved offline movie pages can be placed under `DIRECTORY/movies/YEAR--SLUG.html` when using `--source-dir`.

GitHub Actions refreshes all 12 schedules and publishes the site on pushes and twice daily (scheduled for 07:17 and 13:17 WITA; runs can be delayed). Every source must have the current Bali date and a valid schedule before publication. A failed refresh leaves the previously published site in place. The UI warns when the snapshot is from another day. After successful publication, the workflow commits the actual `showtimes.json` snapshot back to `main`. These regular data updates maintain repository activity, preventing GitHub's 60-day inactivity shutdown while refreshes are succeeding, and keep the local-development backup current. Only the final archive job has Contents write permission; it writes only the snapshot and the three tracking JSON files, skips newer commits/data, and never force-pushes. Its built-in `GITHUB_TOKEN` does not trigger another push workflow, so there is no refresh loop. The small transfer artifact expires after one day. Browsing movie data needs no API key or backend.

Extra observations are stored only in [tracking/](tracking/README.md), outside the Pages package: runtime, age rating, genre, source-reported release date, explicit language/subtitle fields (otherwise unknown), movie and cinema/format first/last observations, availability counts, price changes, and source-check outcomes. Git retains their history. A failed scrape archives diagnostics without changing the last successful snapshot or treating missing data as a movie's disappearance. This adds no website controls and no new requests beyond the movie pages already fetched for trailers.

For a manual refresh, use **Refresh movie data → Sign in with GitHub** on the site, then **Refresh movie data**. The new snapshot loads automatically when the run finishes. The workflow permits manual refresh builds only when the actor is the repository owner. You can also open **About this map → run a refresh on GitHub** and choose **Run workflow** on `main`; reload the website afterward. Reloading the page alone does not rebuild the data. Movies are added and removed according to that day's source listings, with no fixed expiry in the app.

Optional onsite owner controls are implemented in `owner-refresh.js`, with a small Cloudflare Workers Free service under `owner-service/`. Once configured, **Refresh movie data** offers GitHub owner sign-in, progress, and automatic loading of the published snapshot while preserving movie selection and sorting. The controls stay hidden until `owner-refresh-config.json` has a service URL. See [service setup and security](owner-service/README.md); credentials must never be published in the static site.

Pins use OpenStreetMap cinema nodes or mall centroids; each record in `cinemas.json` links its location source. Sidewalk Jimbaran's pin is approximate and labelled accordingly. Location data © OpenStreetMap contributors, licensed under ODbL.

MapLibre GL JS displays OpenFreeMap's Positron basemap with attribution. No API key, backend or build step is required.

If the vector map fails or takes over 12 seconds to load, the page switches to OpenStreetMap's standard raster tiles, with visible attribution and normal browser caching. It only loads the visible map; there is no offline tile cache or bulk download. This avoids a missing font request leaving Android's map blank. A retry button appears if the backup also cannot connect.

The push test reports **Test reached this browser** only after its service worker receives the message and creates the notification. This cannot prove an OS banner appeared: Windows may disable Chrome notifications, and Android's Chrome site channel may have banners off. The status includes instructions for those settings. Each test uses a unique tag so another test doesn't silently replace the first.

## Develop and publish

Serve this directory with a static server, for example `python -m http.server 8000`.

GitHub Pages uses the **GitHub Actions** publishing source and `.github/workflows/pages.yml`. Update `cinemas.json` to edit locations; coordinates are `[longitude, latitude]`. Keep each source and the checked date current.

To refresh listings locally, install `beautifulsoup4==4.13.3` and run `python scripts/refresh_showtimes.py`. Run parser checks with `python -m unittest discover -s scripts -p 'test_*.py'` and time/format checks with `node --test scripts/test_showtime_utils.cjs`. For saved source verification, the refresh script also accepts `--source-dir DIRECTORY --date YYYY-MM-DD`.
