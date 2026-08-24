'use client';

import { useEffect, useState } from 'react';
import type { Aircraft } from '../domain/aircraft';
import { loadAircraftPhoto, type AircraftPhoto as AircraftPhotoData } from '../data/aircraft-photo';
import { translate, type Language } from '../i18n';

type AircraftPhotoProps = {
  aircraft: Aircraft;
  language: Language;
};

export function AircraftPhoto({ aircraft, language }: AircraftPhotoProps) {
  const photoKey = [aircraft.id, aircraft.registration ?? '', aircraft.aircraftType ?? ''].join(':');
  const [photoResult, setPhotoResult] = useState<{ key: string; photo: AircraftPhotoData | null }>();
  const [failedPhotoKey, setFailedPhotoKey] = useState<string>();
  const photo = photoResult?.key === photoKey ? photoResult.photo : undefined;
  const imageFailed = failedPhotoKey === photoKey;

  useEffect(() => {
    let current = true;
    const lookup = {
      id: aircraft.id,
      registration: aircraft.registration,
      aircraftType: aircraft.aircraftType,
    };

    void loadAircraftPhoto(lookup).then((result) => {
      if (current) setPhotoResult({ key: photoKey, photo: result });
    });

    return () => {
      current = false;
    };
  }, [aircraft.aircraftType, aircraft.id, aircraft.registration, photoKey]);

  if (photo === undefined) {
    return (
      <div className="aircraft-photo aircraft-photo-loading" aria-label={translate(language, 'aircraftPhotoLoading')}>
        <span />
      </div>
    );
  }

  if (!photo || imageFailed) {
    return (
      <div className="aircraft-photo aircraft-photo-empty">
        <span aria-hidden="true">▱</span>
        <p>{translate(language, 'aircraftPhotoMissing')}</p>
      </div>
    );
  }

  const identity = aircraft.registration ?? (aircraft.flight.trim() || aircraft.id.toUpperCase());
  return (
    <figure className="aircraft-photo aircraft-photo-result">
      <a href={photo.link} target="_blank" rel="noreferrer" title={translate(language, 'photoOnPlanespotters')}>
        {/* External attribution image; preserving the provider URL is intentional. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.src}
          width={photo.width}
          height={photo.height}
          alt={`${identity}, ${translate(language, 'aircraftPhotoAlt')}`}
          loading="lazy"
          onError={() => setFailedPhotoKey(photoKey)}
        />
      </a>
      <figcaption>
        <span>{translate(language, 'photo')} © {photo.photographer ?? translate(language, 'unknownPhotographer')}</span>
        <a href={photo.link} target="_blank" rel="noreferrer">Planespotters.net ↗</a>
      </figcaption>
    </figure>
  );
}
