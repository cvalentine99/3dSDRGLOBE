# SDR Directory API Research Notes

## Confirmed Data Sources

### 1. KiwiSDR GPS Hosts JSON (CONFIRMED - HIGH PRIORITY)
- URL: http://kiwisdr.com/tdoa/files/kiwi.gps.json
- Format: JSON array
- Count: 501 receivers (GPS-active only, subset of ~945 total)
- Fields: i, id, h(host), p(port), lat, lon, lo, fm(freq max), u(users), um(max users), tc(tdoa channels), snr, v(version), mac, a(antenna), n(name)
- All have lat/lon coordinates
- Already used by tdoaService.ts

### 2. WebSDR.org (CONFIRMED - MEDIUM PRIORITY)
- URL: http://websdr.ewi.utwente.nl/org/
- Format: HTML table with receiver details
- Count: ~125 active servers
- Has: location, URL, grid locator, frequency ranges, antenna, user count
- Need to scrape HTML - no JSON API
- Has grid locators (e.g. JO32KF) which can be converted to lat/lon

### 3. sdr-list.xyz (CONFIRMED - LOW PRIORITY)
- Format: Next.js/React app with map markers
- Count: 25 receivers (NovaSDR/PhantomSDR)
- Small but unique platform type
- No obvious JSON API

### 4. rx-tx.info (NEEDS SCRAPING - MEDIUM PRIORITY)
- Format: Drupal HTML tables, paginated (50/page)
- Count: 2,495 receivers
- Has: title, band, country, city, QTH (grid), type
- Would need multi-page scraping

### 5. ReceiverBook (NO API FOUND)
- Format: HTML list, paginated
- No JSON API discovered
- Would need scraping

## Integration Strategy
1. KiwiSDR GPS JSON: Direct fetch, already have lat/lon - easiest and most valuable
2. WebSDR.org: HTML scrape, convert grid locators to lat/lon
3. Merge with existing stations.json using URL-based deduplication
4. Store in DB for periodic refresh instead of static file
