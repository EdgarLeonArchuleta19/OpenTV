/*
 * App configuration: the local service it talks to.
 *
 * Movies and series come from the viewer's addons (compatible with Stremio;
 * the page reads them directly). The local service plays files, serves
 * subtitles, reads M3U lists and, on PC, runs torrents and downloads.
 */
window.OPENTV_API = {
  enabled: true,
  mode: 'addons',

  /* PC: read the addons' catalogs again every 20 minutes (false = never). */
  refresh: true,

  /* Plain HTTP address of the local service. Empty on PC (Electron uses
     IPC); scripts/build-android.cjs fills it in for the Android app. */
  devServiceUrl: '',

  /* static / catalog modes */
  useBundledCatalog: true,
  baseUrl: '',
  catalogPath: '',
  detailPath: '',
  searchPath: '',
  headers: {},
  imageBaseUrl: '',
  timeoutMs: 20000
};
