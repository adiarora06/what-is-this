export const MAX_PAGE_URL_LENGTH = 2_048;

// Keep enough headroom for a full capture and one cropped copy across three
// normal window-scoped sessions in the 10 MB chrome.storage.session budget.
// JavaScript strings may use more than one byte per character in memory, so
// this is intentionally conservative.
export const MAX_STORED_IMAGE_DATA_URL_LENGTH = 750_000;
export const MAX_STORED_IMAGE_DIMENSION = 1_600;
