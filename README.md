# Bali Cinema Map

Find the cinemas closest to home on a light, interactive map of Bali.

**Live map: [arthur-freedom.github.io/bali-cinema-map](https://arthur-freedom.github.io/bali-cinema-map/)**

Inspired by the [Australia 462 work map](https://github.com/Arthur-Freedom/au-462-work-map).

## Use

- Choose a starting point on the map, or use your current location, to sort cinemas nearest first.
- Distances are straight-line estimates in kilometres. Open **Directions** for a road route from your starting point.
- Search by cinema name, chain or area. Cinema icons use chain colors; hover or focus a pin to see its name on the map. Select a pin or list row to keep the name visible and open details.
- Your starting point has a distinct dot labelled **You**.
- The map popup also offers **Films & prices** and **Directions**, so you can open current screenings, ticket prices or a route directly beside the cinema pin.
- Cinema details stay in the map popup; selecting a pin keeps the left panel and its scroll position steady. Click the map background to close the popup.
- Your starting point stays in your browser's local storage; it is not included in this public repository.
- Open **Compare movies**, pick a film, and see venues, studio formats, listed ticket prices and showtimes together. Listings sort by lowest price; filter to a studio format to compare equivalent screenings. You can also sort by name or distance after setting a starting point.
- Choose **Soonest showtime** to put the next upcoming screening first in Bali time (WITA). The next session is highlighted; started sessions are muted and rows with no remaining sessions appear last. Ordering refreshes while this view is open and uses the snapshot’s date, so old schedules never masquerade as upcoming sessions.
- Use **Find movies with** before picking a movie to discover films listed in Premiere, VIP or IMAX. The movie picker and venue overview both show only matching listings. Choose **Any studio format** to browse everything again.
- Open **Premiere, VIP or IMAX?** beside that filter for the format guide and source descriptions. Premiere (Cinema XXI) and VIP (Cinépolis) focus on comfort and service; IMAX focuses on the screen, projection and sound.
- Play the compact trailer beside the movie title to watch the same YouTube video linked by JadwalNonton. It does not autoplay and stops when switching films or returning to the map. On narrow screens it sits below the title. There is no separate external YouTube link.
- Trailers use the standard `youtube.com` player so YouTube can recognize an existing Premium sign-in when browser cookie settings allow it. Premium viewers need to be signed in to YouTube in the same browser; [YouTube’s embedded-player troubleshooting](https://support.google.com/youtube/answer/7437519?hl=en) explains cookie and account requirements.
- **Show on map** opens that cinema’s pin; **Check listing** opens its source schedule. Movie selections can be shared with the `?movie=YEAR/SLUG` URL parameter. The `experience` and `sort` parameters preserve the movie-type filter and sorting choice.

## Data

The 12 theaters in [JadwalNonton's Bali listing](https://jadwalnonton.com/bioskop/di-bali/), checked 5 October 2026. This is a location snapshot and may omit independent screening venues.

Movie comparisons load `showtimes.json`, a dated snapshot of those cinema schedules. Each studio format keeps its own price and showtimes. JadwalNonton warns that listed prices may follow the first showtime, and later sessions may differ; they are not a guaranteed final booking total. An absent listing is not proof that a film is unavailable.

The scraper also checks each movie’s source page for its trailer, with at most three requests in parallel. It saves only validated YouTube video IDs, never embedded HTML. Missing or unavailable trailers do not block schedule updates. Saved offline movie pages can be placed under `DIRECTORY/movies/YEAR--SLUG.html` when using `--source-dir`.

GitHub Actions refreshes all 12 schedules and publishes the site on pushes and twice daily (scheduled for 07:17 and 13:17 WITA; runs can be delayed). Every source must have the current Bali date and a valid schedule before publication. A failed refresh leaves the previously published site in place. The UI warns when the snapshot is from another day. Scheduled snapshots are published as Pages artifacts; the committed JSON is a fallback for local development. Browsing movie data needs no API key or backend.

For a manual refresh, open **About this map → Refresh listings (owner)**, sign into the repository owner's GitHub account, and choose **Run workflow** on `main`. GitHub requires repository write access, and the workflow permits manual refresh builds only when the actor is the repository owner. Recent complete runs took 45–75 seconds, excluding any queue delay. Reload the website after a successful run to load the new snapshot; reloading the page itself does not rebuild the data. Movies are added and removed according to that day's source listings, with no fixed expiry in the app.

Optional onsite owner controls are implemented in `owner-refresh.js`, with a small Cloudflare Workers Free service under `owner-service/`. Once configured, **Refresh movie data** offers GitHub owner sign-in, progress, and automatic loading of the published snapshot while preserving movie selection and sorting. The controls stay hidden until `owner-refresh-config.json` has a service URL. See [service setup and security](owner-service/README.md); credentials must never be published in the static site.

Pins use OpenStreetMap cinema nodes or mall centroids; each record in `cinemas.json` links its location source. Sidewalk Jimbaran's pin is approximate and labelled accordingly. Location data © OpenStreetMap contributors, licensed under ODbL.

MapLibre GL JS displays OpenFreeMap's Positron basemap with attribution. No API key, backend or build step is required.

## Develop and publish

Serve this directory with a static server, for example `python -m http.server 8000`.

GitHub Pages uses the **GitHub Actions** publishing source and `.github/workflows/pages.yml`. Update `cinemas.json` to edit locations; coordinates are `[longitude, latitude]`. Keep each source and the checked date current.

To refresh listings locally, install `beautifulsoup4==4.13.3` and run `python scripts/refresh_showtimes.py`. Run parser checks with `python -m unittest discover -s scripts -p 'test_*.py'` and time/format checks with `node --test scripts/test_showtime_utils.cjs`. For saved source verification, the refresh script also accepts `--source-dir DIRECTORY --date YYYY-MM-DD`.
