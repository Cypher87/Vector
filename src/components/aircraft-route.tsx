'use client';

import { useEffect, useState } from 'react';
import type { Aircraft } from '../domain/aircraft';
import { loadAircraftRoute, normalizeCallsign, type AircraftRoute as AircraftRouteData, type RouteAirport } from '../data/aircraft-route';
import { translate, type Language } from '../i18n';

type AircraftRouteProps = {
  aircraft: Aircraft;
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

export function AircraftRoute({ aircraft, language }: AircraftRouteProps) {
  const callsign = normalizeCallsign(aircraft.flight);
  const [routeResult, setRouteResult] = useState<{ callsign: string; route: AircraftRouteData | null }>();
  const route = routeResult?.callsign === callsign ? routeResult.route : undefined;

  useEffect(() => {
    let current = true;
    const lookup = {
      flight: aircraft.flight,
      registration: aircraft.registration,
      latitude: aircraft.latitude,
      longitude: aircraft.longitude,
    };

    void loadAircraftRoute(lookup).then((result) => {
      if (current) setRouteResult({ callsign, route: result });
    });

    return () => {
      current = false;
    };
  }, [aircraft.flight, aircraft.latitude, aircraft.longitude, aircraft.registration, callsign]);

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
      <section className="route-card route-empty">
        <div className="route-card-heading"><span>{translate(language, 'route')}</span><small>{callsign || '—'}</small></div>
        <p>{translate(language, 'noKnownRoute')}</p>
      </section>
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
