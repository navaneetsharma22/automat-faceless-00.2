import styles from "../Dashboard.module.css";

export type DemoProgress = { label: string; detail: string; value: number };

export function ProgressPanel({ items }: { items: DemoProgress[] }) {
  return (
    <section
      className={`${styles.panel} ${styles.progressPanel}`}
      aria-labelledby="progress-title"
    >
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.kicker}>EXAMPLE STATUS</p>
          <h2 id="progress-title">Batch overview</h2>
        </div>
        <span className={styles.demoBadge}>DEMO</span>
      </div>
      <p className={styles.muted}>
        Illustrative progress only. No provider work is running.
      </p>
      <div className={styles.progressList}>
        {items.map((item) => (
          <article className={styles.progressCard} key={item.label}>
            <div className={styles.progressMeta}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
            <div
              className={styles.progressTrack}
              role="img"
              aria-label={`${item.value}% example progress`}
            >
              <span style={{ width: `${item.value}%` }} />
            </div>
            <span className={styles.progressValue}>{item.value}% example</span>
          </article>
        ))}
      </div>
    </section>
  );
}
