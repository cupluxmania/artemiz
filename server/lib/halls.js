// Determines which physical "booth plot" (set of halls) an event uses, based on its title.
//
// Rule:
//  - If the event title contains "Int'l" or "International" (case-insensitive) it is treated
//    as an international show and uses the full multi-hall convention center layout:
//    Hall 5, Hall 6, Hall 7, Hall 8, Hall 9, Hall 10, Ambulance.
//  - Otherwise it uses the standard/local layout: Convention, Foyer, Exhibition, Ambulance.

const INTERNATIONAL_HALLS = ['Hall 5', 'Hall 6', 'Hall 7', 'Hall 8', 'Hall 9', 'Hall 10', 'Ambulance'];
const DOMESTIC_HALLS = ['Convention', 'Foyer', 'Exhibition', 'Ambulance'];

// Icon shown on each hall's card in the "Halls & Booths" view.
const HALL_ICON_MAP = {
  'Hall 5': '🏟️', 'Hall 6': '🏬', 'Hall 7': '🏢', 'Hall 8': '🏛️', 'Hall 9': '🏫', 'Hall 10': '🏭',
  'Ambulance': '🚑', 'Convention': '🏛️', 'Foyer': '🚪', 'Exhibition': '🖼️',
};

// Default number of booth slots generated per hall when seeding/auto-generating inventory.
const HALL_SLOT_COUNTS = {
  'Hall 5': 160, 'Hall 6': 160, 'Hall 7': 160, 'Hall 8': 160, 'Hall 9': 160, 'Hall 10': 160,
  'Ambulance': 40, 'Convention': 200, 'Foyer': 120, 'Exhibition': 250,
};

// Short booth-number prefix used when auto-generating slots for a hall.
const HALL_CODE_MAP = {
  'Hall 5': 'H5', 'Hall 6': 'H6', 'Hall 7': 'H7', 'Hall 8': 'H8', 'Hall 9': 'H9', 'Hall 10': 'H10',
  'Ambulance': 'AMB', 'Convention': 'CONV', 'Foyer': 'FOY', 'Exhibition': 'EXH',
};

function hallCode(hall) {
  return HALL_CODE_MAP[hall] || String(hall || '').replace(/\s+/g, '').slice(0, 4).toUpperCase();
}

function isInternationalEvent(eventName) {
  return /international|int(?:'|\u2019)?l\b/i.test(eventName || '');
}

function getHallsForEvent(eventName) {
  return isInternationalEvent(eventName) ? INTERNATIONAL_HALLS : DOMESTIC_HALLS;
}

module.exports = {
  INTERNATIONAL_HALLS,
  DOMESTIC_HALLS,
  HALL_ICON_MAP,
  HALL_SLOT_COUNTS,
  HALL_CODE_MAP,
  hallCode,
  isInternationalEvent,
  getHallsForEvent,
};
