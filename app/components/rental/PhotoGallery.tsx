"use client";
import { useRef, useState } from "react";
import { approvalPhotoUrl, HandoverPhoto } from "@/lib/rentalApproval";
import { Modal } from "./Modal";

/**
 * A device's handover photos, loaded only through the approval link's
 * token-protected endpoint and only for ids that are in the snapshot.
 * Images are plain <img> tags (no image-optimisation proxy) with no referrer.
 */
export function PhotoGallery({ token, photos, deviceLabel }: { token: string; photos: HandoverPhoto[]; deviceLabel: string }) {
  const valid = photos.filter((p) => Number.isInteger(p.id) && p.id > 0);
  const [open, setOpen] = useState<number | null>(null);
  if (!valid.length) return null;

  return (
    <>
      <ul className="ra-photo-grid" aria-label={`Handover photos of ${deviceLabel}`}>
        {valid.map((photo, i) => (
          <li key={photo.id}>
            <button
              type="button"
              className="ra-photo-thumb"
              onClick={() => setOpen(i)}
              aria-label={`Enlarge photo: ${photoTitle(photo)}`}
            >
              <PhotoImage src={approvalPhotoUrl(token, photo.id)} alt={photoAlt(photo, deviceLabel)} />
            </button>
            <span className="ra-photo-label">{photoTitle(photo)}</span>
            {photo.caption && <span className="ra-photo-caption">{photo.caption}</span>}
          </li>
        ))}
      </ul>
      {open !== null && (
        <Lightbox token={token} photos={valid} index={open} onIndex={setOpen} onClose={() => setOpen(null)} deviceLabel={deviceLabel} />
      )}
    </>
  );
}

function photoTitle(photo: HandoverPhoto) {
  return photo.label || photo.kind || "Device photo";
}
function photoAlt(photo: HandoverPhoto, deviceLabel: string) {
  return `${deviceLabel} — ${photoTitle(photo)}${photo.caption ? `: ${photo.caption}` : ""}`;
}

function PhotoImage({ src, alt, large = false }: { src: string; alt: string; large?: boolean }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  return (
    <span className={`ra-photo-frame ${large ? "ra-photo-frame-large" : ""} ra-photo-${state}`}>
      {state === "loading" && <span className="ra-photo-placeholder" aria-hidden="true" />}
      {state === "error" ? (
        <span className="ra-photo-error" role="img" aria-label={`${alt} (could not be loaded)`}>
          Photo unavailable
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- token-protected backend URL; must not go through an image proxy
        <img
          src={src}
          alt={alt}
          loading={large ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
        />
      )}
    </span>
  );
}

function Lightbox({
  token,
  photos,
  index,
  onIndex,
  onClose,
  deviceLabel,
}: {
  token: string;
  photos: HandoverPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  deviceLabel: string;
}) {
  const photo = photos[index];
  const touchX = useRef<number | null>(null);
  const many = photos.length > 1;
  const go = (delta: number) => onIndex((index + delta + photos.length) % photos.length);

  return (
    <Modal title={photoTitle(photo)} description={`${deviceLabel} · photo ${index + 1} of ${photos.length}`} onClose={onClose} wide variant="media">
      <div
        className="ra-lightbox"
        onKeyDown={(e) => {
          if (!many) return;
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
          }
        }}
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          if (touchX.current == null || !many) return;
          const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1);
        }}
      >
        {/* key forces a fresh loading state per photo */}
        <PhotoImage key={photo.id} src={approvalPhotoUrl(token, photo.id)} alt={photoAlt(photo, deviceLabel)} large />
        {photo.caption && <p className="ra-lightbox-caption">{photo.caption}</p>}
        {many && (
          <div className="ra-lightbox-nav">
            <button type="button" className="ra-btn ra-btn-secondary" onClick={() => go(-1)} aria-label="Previous photo">
              ‹ Previous
            </button>
            <span aria-live="polite" className="ra-lightbox-count">
              {index + 1} / {photos.length}
            </span>
            <button type="button" className="ra-btn ra-btn-secondary" onClick={() => go(1)} aria-label="Next photo" data-autofocus>
              Next ›
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
