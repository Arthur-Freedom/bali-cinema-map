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
- **Show on map** opens that cinema’s pin; **Check listing** opens its source schedule. Movie selections can be shared with the `?movie=YEAR/SLUG` URL parameter.

## Data

The 12 theaters in [JadwalNonton's Bali listing](https://jadwalnonton.com/bioskop/di-bali/), checked 5 October 2026. This is a location snapshot and may omit independent screening venues.

Movie comparisons load `showtimes.json`, a dated snapshot of those cinema schedules. Each studio format keeps its own price and showtimes. JadwalNonton warns that listed prices may follow the first showtime, and later sessions may differ; they are not a guaranteed final booking total. An absent listing is not proof that a film is unavailable.

GitHub Actions refreshes all 12 schedules and publishes the site on pushes and twice daily (scheduled for 07:17 and 13:17 WITA; runs can be delayed). Every source must have the current Bali date and a valid schedule before publication. A failed refresh leaves the previously published site in place. The UI warns when the snapshot is from another day. Scheduled snapshots are published as Pages artifacts; the committed JSON is a fallback for local development. No browser scraping, API key or persistent backend is needed.

Pins use OpenStreetMap cinema nodes or mall centroids; each record in `cinemas.json` links its location source. Sidewalk Jimbaran's pin is approximate and labelled accordingly. Location data © OpenStreetMap contributors, licensed under ODbL.

MapLibre GL JS displays OpenFreeMap's Positron basemap with attribution. No API key, backend or build step is required.

## Develop and publish

Serve this directory with a static server, for example `python -m http.server 8000`.

GitHub Pages uses the **GitHub Actions** publishing source and `.github/workflows/pages.yml`. Update `cinemas.json` to edit locations; coordinates are `[longitude, latitude]`. Keep each source and the checked date current.

To refresh listings locally, install `beautifulsoup4==4.13.3` and run `python scripts/refresh_showtimes.py`. Run parser checks with `python -m unittest discover -s scripts -p 'test_*.py'`. For saved source verification, the refresh script also accepts `--source-dir DIRECTORY --date YYYY-MM-DD`.
