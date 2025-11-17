declare module 'url-join' {
  /**
   * Joins URL segments, normalizing paths and handling double slashes.
   */
  function urlJoin(...parts: string[]): string;
  export = urlJoin;
}