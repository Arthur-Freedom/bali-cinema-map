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

## Data

The 12 theaters in [JadwalNonton's Bali listing](https://jadwalnonton.com/bioskop/di-bali/), checked 5 October 2026. This is a location snapshot and may omit independent screening venues. Showtimes, trailers and prices are linked, without a synchronization service.

Pins use OpenStreetMap cinema nodes or mall centroids; each record in `cinemas.json` links its location source. Sidewalk Jimbaran's pin is approximate and labelled accordingly. Location data © OpenStreetMap contributors, licensed under ODbL.

MapLibre GL JS displays OpenFreeMap's Positron basemap with attribution. No API key, backend or build step is required.

## Develop and publish

Serve this directory with a static server, for example `python -m http.server 8000`.

GitHub Pages publishes the `main` branch root. Update `cinemas.json` to edit locations; coordinates are `[longitude, latitude]`. Keep each source and the checked date current.
