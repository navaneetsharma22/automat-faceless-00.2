import type { SelectedTargetRecord } from "../../../storage/db";
import type { VideoDestination } from "../../../domain/batches/types";
import { SettingsConfirmation } from "../../components/SettingsConfirmation";
import styles from "./Destination.module.css";

export type DestinationProps = {
  destination: VideoDestination;
  onSelectDestination: (destination: VideoDestination) => void;
  connectedTarget?: SelectedTargetRecord;
  targetLoading?: boolean;
  declaredDuration: string;
  onDeclaredDurationChange: (duration: string) => void;
  confirmed: boolean;
  onConfirmationChange: (confirmed: boolean) => void;
  disabled?: boolean;
};

export function Destination({
  destination,
  onSelectDestination,
  connectedTarget,
  targetLoading = false,
  declaredDuration,
  onDeclaredDurationChange,
  confirmed,
  onConfirmationChange,
  disabled = false,
}: DestinationProps) {
  const isTargetVerified =
    connectedTarget?.verification === "verified" &&
    connectedTarget?.connectionState === "verified";

  const safeDuration = declaredDuration ?? "";
  const parsedDuration = Number(safeDuration);
  const isDurationValid =
    safeDuration.trim() !== "" &&
    Number.isInteger(parsedDuration) &&
    parsedDuration > 0 &&
    parsedDuration <= 3600;

  const targetProject =
    destination === "Flow"
      ? connectedTarget?.verificationBinding?.projectId ?? "Unbound project"
      : connectedTarget?.canonicalTarget ?? "Unbound document";

  return (
    <div className={styles.destinationSection}>
      <fieldset className={styles.destinationGroup} disabled={disabled}>
        <legend>Video destination</legend>
        <div className={styles.destinationOptions}>
          {(["Flow", "Vids"] as const).map((item) => (
            <label
              className={`${styles.destinationOption} ${destination === item ? styles.destinationSelected : ""} motion-card`}
              key={item}
            >
              <input
                type="radio"
                name="video-destination"
                value={item}
                checked={destination === item}
                onChange={() => {
                  if (destination !== item) {
                    onSelectDestination(item);
                  }
                }}
              />
              <span>
                <strong>{item}</strong>
                <small>See Connections for current project status.</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.targetCard}>
        <div className={styles.targetHeader}>
          <h4 className={styles.targetTitle}>{destination} Connected Target</h4>
          <span
            className={
              isTargetVerified
                ? styles.targetBadgeVerified
                : styles.targetBadgeUnverified
            }
          >
            {targetLoading
              ? "Checking..."
              : isTargetVerified
                ? "Verified connection"
                : "Not connected / Unverified"}
          </span>
        </div>
        {isTargetVerified && connectedTarget ? (
          <p className={styles.targetDetails}>
            Tab {connectedTarget.tabId} — {targetProject} (
            {connectedTarget.canonicalTarget})
          </p>
        ) : (
          <p className={styles.targetError}>
            Connect and verify a {destination} project in Connections before
            preparing.
          </p>
        )}
      </div>

      <div className={styles.durationField}>
        <label className={styles.durationLabel} htmlFor="batch-duration-input">
          Manual batch duration (seconds)
        </label>
        <input
          id="batch-duration-input"
          className={styles.durationInput}
          type="number"
          min="1"
          max="3600"
          step="1"
          placeholder="e.g. 6 or 8"
          value={declaredDuration}
          onChange={(event) => {
            onDeclaredDurationChange(event.target.value);
          }}
          disabled={disabled}
        />
        <p className={styles.durationHint}>
          User-declared batch duration for tracking metadata. Automat Faceless
          does not alter or inspect provider settings.
        </p>
      </div>

      <SettingsConfirmation
        id="video-settings-confirm"
        provider={destination}
        contextLabel="this batch"
        checked={confirmed}
        onChange={onConfirmationChange}
        disabled={disabled || !isTargetVerified || !isDurationValid}
        hint={
          !isTargetVerified
            ? `Connect and verify ${destination} in Connections before confirming.`
            : !isDurationValid
              ? "Enter a valid duration in seconds (e.g. 6 or 8) before confirming."
              : undefined
        }
      />
    </div>
  );
}
