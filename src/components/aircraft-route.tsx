'use client';

import { useEffect, useState } from 'react';
import type { Aircraft } from '../domain/aircraft';
import { loadAircraftRoute, normalizeCallsign, type AircraftRoute as AircraftRouteData, type RouteAirport } from '../data/aircraft-route';
import { translate, type Language } from '../i18n';

type AircraftRouteProps = {
  route: AircraftRouteData | null | undefined;
  callsign: string;
  language: Language;
};

const airportRole = (index: number, count: number, language: Language) => {
  if (index === 0) return translate(language, 'departure');
  if (index === count - 1) return translate(language, 'destination');
  return translate(language, 'stop');
};

const airportCodes = (airport: RouteAirport) => {
  const primary = airport.iata ?? airport.icao ?? '—';
  const secondary = airport.iata && airport.icao ? airport.icao : undefined;
  return { primary, secondary };
};

export function useAircraftRoute(aircraft: Aircraft | undefined) {
  const flight = aircraft?.flight;
  const registration = aircraft?.registration;
  const latitude = aircraft?.latitude;
  const longitude = aircraft?.longitude;
  const callsign = normalizeCallsign(flight ?? '');
  const [routeResult, setRouteResult] = useState<{ callsign: string; route: AircraftRouteData | null }>();

  useEffect(() => {
    if (!flight) return;
    let current = true;
    const lookup = { flight, registration, latitude, longitude };

    void loadAircraftRoute(lookup).then((result) => {
      if (current) setRouteResult({ callsign, route: result });
    });

    return () => {
      current = false;
    };
  }, [flight, latitude, longitude, registration, callsign]);

  return aircraft && routeResult?.callsign === callsign ? routeResult.route : undefined;
}

export function AircraftRouteSummary({ route, language }: Pick<AircraftRouteProps, 'route' | 'language'>) {
  if (!route) return null;

  const departure = route.airports[0];
  const destination = route.airports.at(-1)!;
  const stops = route.airports.length - 2;

  return (
    <div className="flight-route-summary" aria-label={translate(language, 'route')}>
      <div className="flight-route-path">
        <strong title={departure.name} aria-label={`${airportCodes(departure).primary}: ${departure.name}`}>{airportCodes(departure).primary}</strong>
        <span className="flight-route-arrow" aria-hidden="true">→</span>
        <strong title={destination.name} aria-label={`${airportCodes(destination).primary}: ${destination.name}`}>{airportCodes(destination).primary}</strong>
      </div>
      {stops > 0 && <small className="flight-route-stops">{stops} {stops === 1 ? translate(language, 'stop') : translate(language, 'stops')}</small>}
      {!route.plausible && <small className="flight-route-unconfirmed" title={translate(language, 'routeNotConfirmed')}>{translate(language, 'routeUnconfirmed')}</small>}
    </div>
  );
}

export function AircraftRoute({ route, callsign, language }: AircraftRouteProps) {
  if (route === undefined) {
    return (
      <section className="route-card route-loading" aria-label={translate(language, 'routeLoading')}>
        <div className="route-card-heading"><span>{translate(language, 'route')}</span><small>{callsign || '—'}</small></div>
        <div className="route-loading-line" /><div className="route-loading-line short" />
      </section>
    );
  }

  if (!route) {
    return (
      <p className="route-unavailable">{translate(language, 'noKnownRoute')}</p>
    );
  }

  return (
    <section className="route-card" aria-label={`${translate(language, 'routeKnown')} ${route.callsign}`}>
      <div className="route-card-heading">
        <span>{translate(language, 'route')}</span>
        <small>{route.airports.length > 2
          ? language === 'nl'
            ? `${route.airports.length - 2} tussenstop${route.airports.length > 3 ? 's' : ''}`
            : `${route.airports.length - 2} ${route.airports.length === 3 ? 'stop' : translate(language, 'stops')}`
          : route.callsign}</small>
      </div>
      <ol className="route-airports">
        {route.airports.map((airport, index) => {
          const codes = airportCodes(airport);
          return (
            <li key={`${codes.primary}-${index}`}>
              <span className="route-node" aria-hidden="true" />
              <div className="route-airport-copy">
                <span>{airportRole(index, route.airports.length, language)}</span>
                <strong>{codes.primary}{codes.secondary && <small>{codes.secondary}</small>}</strong>
                <p>{airport.name}</p>
                {airport.location && <em>{airport.location}{airport.countryCode ? `, ${airport.countryCode}` : ''}</em>}
              </div>
            </li>
          );
        })}
      </ol>
      {!route.plausible && <p className="route-warning">{translate(language, 'routeNotConfirmed')}</p>}
      <a className="route-source" href="https://adsb.im/" target="_blank" rel="noreferrer">{translate(language, 'routeSource')}: adsb.im ↗</a>
    </section>
  );
}
