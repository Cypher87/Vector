import type { Aircraft, AircraftKind } from './aircraft';
import type { Language } from '../i18n';

const helicopterTypes = new Set([
  'A109', 'A139', 'A149', 'A169', 'A189', 'AS32', 'AS50', 'AS55', 'AS65',
  'B06', 'B212', 'B412', 'EC25', 'EC35', 'EC45', 'EC55', 'EC75', 'EH10',
  'GAZL', 'H46', 'H47', 'H53', 'H60', 'H64', 'H160', 'MI24', 'NH90',
  'PUMA', 'R22', 'R44', 'R66', 'S61', 'S76', 'S92', 'TIGR', 'UH1',
]);

const gliderTypes = new Set([
  'A20J', 'A32E', 'A32P', 'A33E', 'A33P', 'A34E', 'ARCE', 'ARCP', 'AS14',
  'AS16', 'AS20', 'AS21', 'AS22', 'AS24', 'AS25', 'AS26', 'AS28', 'AS29',
  'AS30', 'AS31', 'DG1T', 'DG80', 'DISC', 'DUOD', 'GLID', 'JANU', 'LK17',
  'LK19', 'LK20', 'LS8', 'LS9', 'LS10', 'NIMB', 'PK20', 'QINT', 'S6', 'S10S',
  'S12', 'S12S', 'TS1J', 'VENT', 'VNTE',
]);

const balloonTypes = new Set(['BALL', 'SHIP']);

const heavyTypes = new Set(['C17', 'C5M', 'MD11']);
const heavyPrefixes = ['A33', 'A34', 'A35', 'A38', 'B74', 'B76', 'B77', 'B78', 'IL76'];
const businessJetPrefixes = [
  'BE4', 'C25', 'C5', 'C650', 'C68', 'C700', 'C750', 'CL3', 'CL6', 'E50P',
  'E55P', 'F2TH', 'FA50', 'FA7X', 'FA8X', 'F900', 'GLEX', 'GLF', 'H25',
  'HDJT', 'LJ', 'PRM1',
];
const turbopropPrefixes = [
  'A400', 'AT4', 'AT7', 'B350', 'BE20', 'BE30', 'C130', 'C208', 'D328',
  'DH8', 'JS3', 'JS4', 'L410', 'PC12', 'SF34', 'SW4', 'TBM',
];

export function aircraftKind(aircraft: Aircraft): AircraftKind {
  const type = aircraft.aircraftType?.toUpperCase() ?? '';
  const description = aircraft.description?.toUpperCase() ?? '';
  const category = aircraft.category?.toUpperCase() ?? '';
  const typeDescription = /^[A-Z][1-9][A-Z]$/.test(description) ? description : '';

  if (helicopterTypes.has(type) || description.includes('HELICOPTER') || category === 'A7') return 'helicopter';
  if (gliderTypes.has(type) || description.includes('GLIDER') || category === 'B1') return 'glider';
  if (balloonTypes.has(type) || description.includes('BALLOON') || description.includes('AIRSHIP') || category === 'B2') return 'balloon';
  if (category === 'B3') return 'skydiver';
  if (category === 'B4') return 'ultralight';
  if (category === 'B6') return 'uav';
  if (category.startsWith('C') || aircraft.onGround && ['GND', 'GRND', 'SERV', 'TWR'].includes(type)) return 'ground';
  if (category === 'A6') return 'high-performance';
  if (category === 'A5' || heavyTypes.has(type) || heavyPrefixes.some((prefix) => type.startsWith(prefix))) return 'heavy';
  if (businessJetPrefixes.some((prefix) => type.startsWith(prefix)) || /^(L1J|L2J)$/.test(typeDescription) && (category === 'A1' || category === 'A2')) return 'small';
  if (turbopropPrefixes.some((prefix) => type.startsWith(prefix)) || /^(L1T|L2T|A1T|A2T)$/.test(typeDescription)) return 'turboprop';
  if (category === 'A3' || category === 'A4') return 'airliner';
  if (category === 'A2') return 'small';
  if (category === 'A1') return 'light';
  if (/^(A2|A3|B3|B6|B7|B8|BCS|CRJ|E1|E2|E7|E9)/.test(type)) return 'airliner';
  if (type) return 'light';
  return 'unknown';
}

const aircraftKindLabels: Record<Language, Record<AircraftKind, string>> = {
  nl: {
    airliner: 'verkeersvliegtuig',
    balloon: 'luchtballon',
    glider: 'zweefvliegtuig',
    ground: 'grondvoertuig',
    heavy: 'zwaar vliegtuig',
    helicopter: 'helikopter',
    'high-performance': 'snel vliegtuig',
    light: 'licht vliegtuig',
    skydiver: 'parachutist',
    small: 'klein vliegtuig',
    uav: 'drone',
    ultralight: 'ultralight',
    turboprop: 'turbopropvliegtuig',
    unknown: 'onbekend luchtvaartuig',
  },
  en: {
    airliner: 'airliner',
    balloon: 'balloon',
    glider: 'glider',
    ground: 'ground vehicle',
    heavy: 'heavy aircraft',
    helicopter: 'helicopter',
    'high-performance': 'high-performance aircraft',
    light: 'light aircraft',
    skydiver: 'skydiver',
    small: 'small aircraft',
    uav: 'drone',
    ultralight: 'ultralight',
    turboprop: 'turboprop aircraft',
    unknown: 'unknown aircraft',
  },
};

export const aircraftKindLabel = (kind: AircraftKind, language: Language) => aircraftKindLabels[language][kind];
